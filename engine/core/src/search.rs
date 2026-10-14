//! Alpha-beta search: iterative deepening with aspiration windows, principal variation search, a
//! transposition table, quiescence search, null-move pruning, futility and late-move pruning,
//! late-move reductions and check extensions, with MultiPV.
//!
//! Deterministic: single-threaded, a fixed-size table cleared by new_game(), and limits in depth and
//! nodes, never time, so both sides of a battle get exactly the same search on any device.
//!
//! It plays the game's battle rules, not plain chess: at the move limit, and when neither side can
//! mate (insufficient material), the side ahead on points wins (src/rules/battle.ts).

use crate::eval::{evaluate, material, value};
use crate::position::{Move, NO_PROMOTION, Position, cell_type};
use crate::tables::{MAX_SQUARES, NO_SQUARE};

/// Mate in `n` plies scores MATE - n.
pub const MATE: i32 = 30_000;
const INF: i32 = 32_000;
/// Scores beyond this are mates.
const MATE_BOUND: i32 = MATE - 1_000;
/// A win on points (at the move limit, or with insufficient material) in `n` plies scores POINTS_WIN - n:
/// as good as any mate the search can't see, but below the mates it can.
const POINTS_WIN: i32 = 20_000;
const MAX_PLY: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Bound {
    Exact,
    Lower,
    Upper,
}

#[derive(Clone, Copy)]
struct Entry {
    key: u64,
    mv: Move,
    score: i16,
    depth: i8,
    bound: Bound,
}

const NO_MOVE: Move = Move { from: NO_SQUARE, to: NO_SQUARE, promo: NO_PROMOTION };
const EMPTY_ENTRY: Entry = Entry { key: 0, mv: NO_MOVE, score: 0, depth: -1, bound: Bound::Upper };

/// How far to search: full plies, and a node budget (0 = none). The deepest iteration that
/// finished within the budget is used.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub depth: u32,
    pub nodes: u64,
}

/// One root move and its score for the side to move (centipawns, or ±(MATE - plies)).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Line {
    pub mv: Move,
    pub score: i32,
}

pub struct Searcher {
    tt: Vec<Entry>,
    killers: [[Move; 2]; MAX_PLY + 1],
    history: Vec<i32>,
    nodes: u64,
    node_limit: u64,
    aborted: bool,
    /// Root moves already chosen as earlier lines in this iteration (MultiPV).
    excluded: Vec<Move>,
    /// The best move found at the root by the last root search.
    root_best: Move,
    /// Move lists per ply, reused so the search doesn't allocate.
    moves: Vec<Vec<Move>>,
    scored: Vec<Vec<(i32, Move)>>,
    /// The battle's move limit, counted in plies from the position the game started from.
    ply_limit: Option<usize>,
    /// The deepest iteration the last search finished.
    completed: u32,
    /// Whether the node limit may stop the search yet: not before depth 1 is done, so there is
    /// always a move.
    may_stop: bool,
    /// The last position tested for check (its hash) and the answer: a move's check test is reused by
    /// the search of the position it leads to.
    last_check: (u64, bool),
}

impl Default for Searcher {
    fn default() -> Self {
        Self::new(18)
    }
}

/// Pruning margins, in centipawns per ply of remaining depth.
const REVERSE_FUTILITY: i32 = 120;
const FUTILITY: i32 = 150;
/// A capture that can't lift the score to within this of alpha isn't searched in quiescence.
const DELTA: i32 = 200;
/// The first aspiration window, either side of the last iteration's score.
const ASPIRATION: i32 = 40;
/// Quiescence plies before it stops and takes the static evaluation: crowded fairy boards (cannons
/// above all) otherwise have capture sequences without end.
const QUIESCENCE_PLIES: u32 = 8;
/// Other root moves search_picks tests against the margin, most promising first.
const MAX_ALTERNATIVES: usize = 12;

impl Searcher {
    /// A searcher with a transposition table of 2^`tt_bits` entries.
    pub fn new(tt_bits: u32) -> Searcher {
        Searcher {
            tt: vec![EMPTY_ENTRY; 1 << tt_bits],
            killers: [[NO_MOVE; 2]; MAX_PLY + 1],
            history: vec![0; MAX_SQUARES * MAX_SQUARES],
            nodes: 0,
            node_limit: 0,
            aborted: false,
            excluded: Vec::new(),
            root_best: NO_MOVE,
            moves: (0..MAX_PLY + 2).map(|_| Vec::with_capacity(128)).collect(),
            scored: (0..MAX_PLY + 2).map(|_| Vec::with_capacity(128)).collect(),
            ply_limit: None,
            completed: 0,
            may_stop: true,
            last_check: (0, false),
        }
    }

    /// Forgets everything learned (call at the start of each battle, for determinism).
    pub fn new_game(&mut self) {
        self.tt.fill(EMPTY_ENTRY);
        self.killers = [[NO_MOVE; 2]; MAX_PLY + 1];
        self.history.fill(0);
    }

    /// The battle ends on points after this many plies from the Position's start (None: no limit, as in
    /// games the player plays themselves). Set it with new_game().
    pub fn set_ply_limit(&mut self, limit: Option<usize>) {
        self.ply_limit = limit;
    }

    /// The quiescence search's score for the side to move (captures resolved), for tuning: a position
    /// whose score matches its static evaluation is quiet.
    /// None if it needs more than `max_nodes` (a tactical tangle: not quiet either).
    pub fn qsearch_score(&mut self, pos: &mut Position, max_nodes: u64) -> Option<i32> {
        self.nodes = 0;
        self.node_limit = max_nodes;
        self.aborted = false;
        self.may_stop = true;
        let score = self.quiesce(pos, -INF, INF, 0, 0);
        (!self.aborted).then_some(score)
    }

    /// The deepest iteration the last search finished within its limits.
    pub fn completed_depth(&self) -> u32 {
        self.completed
    }

    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// The best `multipv` root moves with their scores, best first. Empty if there are no legal moves.
    pub fn search(&mut self, pos: &mut Position, limits: Limits, multipv: usize) -> Vec<Line> {
        self.nodes = 0;
        self.node_limit = limits.nodes;
        self.aborted = false;
        self.completed = 0;
        self.may_stop = false;
        let root_moves = pos.legal_moves().len();
        let want = multipv.min(root_moves);
        let mut best: Vec<Line> = Vec::new();
        for depth in 1..=limits.depth.max(1) as i32 {
            let mut lines: Vec<Line> = Vec::with_capacity(want);
            self.excluded.clear();
            for k in 0..want {
                let previous = best.get(k).map(|l| l.score);
                let score = self.aspirate(pos, depth, previous);
                if self.aborted || self.root_best == NO_MOVE {
                    break;
                }
                lines.push(Line { mv: self.root_best, score });
                self.excluded.push(self.root_best);
            }
            self.excluded.clear();
            if self.aborted && depth > 1 {
                break;
            }
            lines.sort_by_key(|l| std::cmp::Reverse(l.score));
            best = lines;
            self.completed = depth as u32;
            self.may_stop = true;
            if self.aborted {
                break;
            }
            // A mate within this depth is the shortest there is: deeper iterations can't change it.
            if best.first().is_some_and(|l| l.score.abs() >= MATE - depth) {
                break;
            }
        }
        best
    }

    /// The best move and up to `count - 1` others scoring within `margin` of it: what the game's move
    /// picker needs (src/engine/pick.ts picks at random among moves within its margin of the best).
    /// Cheaper than exact MultiPV: one principal line, then a zero-window test of the most promising other
    /// moves against `best - margin`, with a quarter of the node budget on top. Those moves are reported
    /// at `best - margin`, a lower bound of their score.
    pub fn search_picks(&mut self, pos: &mut Position, limits: Limits, count: usize, margin: i32) -> Vec<Line> {
        let mut lines = self.search(pos, limits, 1);
        let Some(&best) = lines.first() else { return lines };
        let depth = self.completed.max(1) as i32;
        let threshold = best.score - margin;
        self.aborted = false;
        self.node_limit = if limits.nodes > 0 { self.nodes + limits.nodes / 4 } else { 0 };
        let mut others: Vec<(i32, Move)> = pos
            .legal_moves()
            .into_iter()
            .filter(|&m| m != best.mv)
            .map(|m| (self.order_score(pos, m, NO_MOVE, 0), m))
            .collect();
        others.sort_by_key(|&(s, m)| (std::cmp::Reverse(s), m));
        for (_, m) in others.into_iter().take(MAX_ALTERNATIVES) {
            if lines.len() >= count {
                break;
            }
            pos.make(m);
            let s = -self.negamax(pos, depth - 1, -threshold, -threshold + 1, 1, true);
            pos.unmake();
            if self.aborted {
                break;
            }
            if s >= threshold {
                lines.push(Line { mv: m, score: threshold });
            }
        }
        lines
    }

    /// A root search in a window around the last iteration's score, widened until the score lands
    /// inside it.
    fn aspirate(&mut self, pos: &mut Position, depth: i32, previous: Option<i32>) -> i32 {
        let (mut alpha, mut beta) = (-INF, INF);
        let mut delta = ASPIRATION;
        if let Some(p) = previous
            && depth >= 5
            && p.abs() < MATE_BOUND
        {
            (alpha, beta) = (p - delta, p + delta);
        }
        loop {
            self.root_best = NO_MOVE;
            let score = self.negamax(pos, depth, alpha, beta, 0, true);
            if self.aborted {
                return score;
            }
            if score <= alpha && alpha > -INF {
                alpha = (score - delta).max(-INF);
            } else if score >= beta && beta < INF {
                beta = (score + delta).min(INF);
            } else {
                return score;
            }
            delta *= 3;
            if delta > 1_000 {
                (alpha, beta) = (-INF, INF);
            }
        }
    }

    /// The position's table key. Near the move limit the same position is worth different things at
    /// different distances from it, so the plies left (up to 48, beyond any search's reach) are part of it.
    fn key(&self, pos: &Position) -> u64 {
        match self.ply_limit {
            Some(limit) => {
                let left = limit.saturating_sub(pos.ply()).min(48) as u64;
                pos.hash() ^ left.wrapping_mul(0x9E37_79B9_7F4A_7C15)
            }
            None => pos.hash(),
        }
    }

    /// The result on points for the side to move, `ply` plies from the root.
    fn points(&self, pos: &Position, ply: usize) -> i32 {
        match material(pos, pos.side()).signum() {
            1 => POINTS_WIN - ply as i32,
            -1 => -POINTS_WIN + ply as i32,
            _ => 0,
        }
    }

    /// Whether the side to move has a legal move.
    fn has_legal_move(&mut self, pos: &mut Position, ply: usize) -> bool {
        let mut moves = std::mem::take(&mut self.moves[ply]);
        moves.clear();
        pos.pseudo_moves(&mut moves);
        let us = pos.side();
        let found = moves.iter().any(|&m| {
            pos.make(m);
            let ok = !pos.royal_attacked(us);
            pos.unmake();
            ok
        });
        self.moves[ply] = moves;
        found
    }

    /// Whether the side to move is in check, reusing the last answer for the same position.
    fn in_check(&mut self, pos: &Position) -> bool {
        let h = pos.hash();
        if self.last_check.0 != h {
            self.last_check = (h, pos.in_check());
        }
        self.last_check.1
    }

    fn index(&self, key: u64) -> usize {
        (key as usize) & (self.tt.len() - 1)
    }

    fn probe(&self, key: u64) -> Option<Entry> {
        let e = self.tt[self.index(key)];
        (e.key == key && e.depth >= 0).then_some(e)
    }

    fn store(&mut self, key: u64, mv: Move, score: i32, depth: i32, bound: Bound, ply: usize) {
        // Mate scores are stored relative to this node, not the root.
        let s = if score > MATE_BOUND {
            score + ply as i32
        } else if score < -MATE_BOUND {
            score - ply as i32
        } else {
            score
        };
        let i = self.index(key);
        let old = self.tt[i];
        // Keep a deeper entry for the same position, unless this one has a move and that one doesn't.
        if old.key == key && old.depth > depth as i8 && !(old.mv == NO_MOVE && mv != NO_MOVE) {
            return;
        }
        self.tt[i] = Entry { key, mv, score: s as i16, depth: depth.clamp(0, 127) as i8, bound };
    }

    fn tick(&mut self) -> bool {
        self.nodes += 1;
        if self.may_stop && self.node_limit > 0 && self.nodes >= self.node_limit {
            self.aborted = true;
        }
        self.aborted
    }

    /// The game is drawn here by repetition (a position repeated since the last irreversible move) or the
    /// 50-move rule.
    fn is_draw(&self, pos: &Position) -> bool {
        if pos.halfmove() >= 100 {
            return true;
        }
        let end = (pos.halfmove() as usize).min(pos.ply());
        let mut i = 4;
        while i <= end {
            if pos.earlier_hash(i) == pos.hash() {
                return true;
            }
            i += 2;
        }
        false
    }

    fn order_score(&self, pos: &Position, m: Move, tt_move: Move, ply: usize) -> i32 {
        if m == tt_move {
            return 1 << 30;
        }
        let mut s = 0;
        if let Some(victim) = pos.captured_type(m) {
            let attacker = cell_type(pos.at(m.from));
            s += (1 << 28) + value(victim) * 16 - value(attacker);
        }
        if m.promo != NO_PROMOTION {
            s += (1 << 27) + value(m.promo);
        }
        if s > 0 {
            return s;
        }
        if self.killers[ply][0] == m {
            return 1 << 26;
        }
        if self.killers[ply][1] == m {
            return (1 << 26) - 1;
        }
        self.history[m.from as usize * MAX_SQUARES + m.to as usize]
    }

    fn negamax(
        &mut self,
        pos: &mut Position,
        mut depth: i32,
        mut alpha: i32,
        beta: i32,
        ply: usize,
        can_null: bool,
    ) -> i32 {
        let root = ply == 0;
        if !root {
            if self.tick() {
                return 0;
            }
            if let Some(score) = self.battle_over(pos, ply) {
                return score;
            }
            if ply >= MAX_PLY {
                return evaluate(pos);
            }
        }
        let in_check = self.in_check(pos);
        if in_check && ply < MAX_PLY / 2 {
            depth += 1;
        }
        if depth <= 0 {
            return self.quiesce(pos, alpha, beta, ply, 0);
        }

        let key = self.key(pos);
        let mut tt_move = NO_MOVE;
        if let Some(e) = self.probe(key) {
            tt_move = e.mv;
            if !root && e.depth as i32 >= depth {
                let s = e.score as i32;
                let s = if s > MATE_BOUND {
                    s - ply as i32
                } else if s < -MATE_BOUND {
                    s + ply as i32
                } else {
                    s
                };
                match e.bound {
                    Bound::Exact => return s,
                    Bound::Lower if s >= beta => return s,
                    Bound::Upper if s <= alpha => return s,
                    _ => {}
                }
            }
        }
        if root && self.excluded.contains(&tt_move) {
            tt_move = NO_MOVE;
        }

        let us = pos.side();
        let static_eval = if in_check { -INF } else { evaluate(pos) };
        let pv_node = beta - alpha > 1;
        if !root && !in_check && !pv_node && beta.abs() < MATE_BOUND {
            // Reverse futility: far enough above beta that a quiet move won't fall back below it.
            if depth <= 3 && static_eval - REVERSE_FUTILITY * depth >= beta {
                return static_eval;
            }
            // Null move: if passing still beats beta, a real move will too (not in zugzwang-prone positions).
            if can_null && depth >= 3 && static_eval >= beta && pos.has_pieces(us) {
                let r = 2 + depth / 4;
                pos.make_null();
                let s = -self.negamax(pos, depth - 1 - r, -beta, -beta + 1, ply + 1, false);
                pos.unmake();
                if self.aborted {
                    return 0;
                }
                if s >= beta {
                    return beta;
                }
            }
        }
        // Futility: this far below alpha, only captures, promotions and checks can help.
        let futile =
            !root && !in_check && depth <= 2 && alpha.abs() < MATE_BOUND && static_eval + FUTILITY * depth <= alpha;

        let mut moves = std::mem::take(&mut self.moves[ply]);
        let mut scored = std::mem::take(&mut self.scored[ply]);
        moves.clear();
        scored.clear();
        pos.pseudo_moves(&mut moves);
        scored.extend(moves.iter().map(|&m| (self.order_score(pos, m, tt_move, ply), m)));

        let original_alpha = alpha;
        let mut best = -INF;
        let mut best_move = NO_MOVE;
        let mut legal = 0;
        for i in 0..scored.len() {
            // Selection sort: most moves are never reached after a cutoff.
            let j = (i..scored.len()).max_by_key(|&k| (scored[k].0, std::cmp::Reverse(k))).unwrap();
            scored.swap(i, j);
            let m = scored[i].1;
            if root && self.excluded.contains(&m) {
                continue;
            }
            let quiet = pos.captured_type(m).is_none() && m.promo == NO_PROMOTION;
            pos.make(m);
            if pos.royal_attacked(us) {
                pos.unmake();
                continue;
            }
            legal += 1;
            let gives_check = self.in_check(pos);
            // Futility and late-move pruning of quiet moves that don't give check.
            if quiet && !gives_check && legal > 1 && best > -MATE_BOUND {
                let late = !root && !in_check && !pv_node && depth <= 3 && legal > 3 + 2 * depth * depth;
                if futile || late {
                    pos.unmake();
                    continue;
                }
            }
            let score = if legal == 1 {
                -self.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true)
            } else {
                let r = if depth >= 3 && legal > 3 && quiet && !in_check && !gives_check {
                    1 + (legal > 8) as i32 + (!pv_node && depth >= 6) as i32
                } else {
                    0
                };
                let mut s = -self.negamax(pos, depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
                if s > alpha && r > 0 {
                    s = -self.negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
                }
                if s > alpha && s < beta {
                    s = -self.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
                }
                s
            };
            pos.unmake();
            if self.aborted {
                break;
            }
            if score > best {
                best = score;
                best_move = m;
                if root {
                    self.root_best = m;
                }
            }
            if score > alpha {
                alpha = score;
            }
            if alpha >= beta {
                if quiet {
                    if self.killers[ply][0] != m {
                        self.killers[ply][1] = self.killers[ply][0];
                        self.killers[ply][0] = m;
                    }
                    let h = &mut self.history[m.from as usize * MAX_SQUARES + m.to as usize];
                    *h = (*h + depth * depth).min(1 << 20);
                }
                break;
            }
        }
        self.moves[ply] = moves;
        self.scored[ply] = scored;
        if self.aborted {
            return 0;
        }
        if legal == 0 {
            // Checkmate or stalemate (at the root with every move excluded, nothing is left to say).
            if root && !self.excluded.is_empty() {
                return -INF;
            }
            return if in_check { -MATE + ply as i32 } else { 0 };
        }
        let bound = if best >= beta {
            Bound::Lower
        } else if best > original_alpha {
            Bound::Exact
        } else {
            Bound::Upper
        };
        // At the root with moves excluded (a later MultiPV line) the result isn't the position's value.
        if !(root && !self.excluded.is_empty()) {
            self.store(key, best_move, best, depth, bound, ply);
        }
        best
    }

    /// The battle's result here if it's over by the battle rules (other than checkmate and stalemate,
    /// which the move loop finds), in the order src/rules/battle.ts decides them.
    fn battle_over(&mut self, pos: &mut Position, ply: usize) -> Option<i32> {
        let at_limit = self.ply_limit.is_some_and(|l| pos.ply() >= l);
        if (at_limit || pos.insufficient_material()) && !self.has_legal_move(pos, ply) {
            return Some(if pos.in_check() { -MATE + ply as i32 } else { 0 });
        }
        if pos.insufficient_material() {
            return Some(self.points(pos, ply));
        }
        if self.is_draw(pos) {
            return Some(0);
        }
        at_limit.then(|| self.points(pos, ply))
    }

    fn quiesce(&mut self, pos: &mut Position, mut alpha: i32, beta: i32, ply: usize, qply: u32) -> i32 {
        if self.tick() {
            return 0;
        }
        // Captures can reach the end of the battle too.
        if (self.ply_limit.is_some_and(|l| pos.ply() >= l) || pos.insufficient_material())
            && let Some(score) = self.battle_over(pos, ply)
        {
            return score;
        }
        if ply >= MAX_PLY {
            return evaluate(pos);
        }
        let in_check = self.in_check(pos);
        if qply >= QUIESCENCE_PLIES {
            return evaluate(pos);
        }
        let mut best = -INF;
        let mut stand = -INF;
        if !in_check {
            stand = evaluate(pos);
            if stand >= beta {
                return stand;
            }
            best = stand;
            alpha = alpha.max(stand);
        }
        let them = pos.side() ^ 1;
        let mut moves = std::mem::take(&mut self.moves[ply]);
        let mut scored = std::mem::take(&mut self.scored[ply]);
        moves.clear();
        scored.clear();
        pos.pseudo_moves(&mut moves);
        for &m in &moves {
            let victim = pos.captured_type(m);
            if !in_check && victim.is_none() && m.promo == NO_PROMOTION {
                continue;
            }
            // Delta pruning: even winning this piece outright wouldn't reach alpha.
            if !in_check && m.promo == NO_PROMOTION && stand + victim.map_or(0, value) + DELTA < alpha {
                continue;
            }
            let attacker = cell_type(pos.at(m.from));
            // A losing capture: a more valuable piece taking a defended one.
            if !in_check
                && m.promo == NO_PROMOTION
                && victim.is_some_and(|v| value(attacker) > value(v))
                && pos.attacked(m.to, them)
            {
                continue;
            }
            let s = victim.map_or(0, |v| value(v) * 16 - value(attacker))
                + if m.promo != NO_PROMOTION { value(m.promo) } else { 0 };
            scored.push((s, m));
        }
        scored.sort_by_key(|&(s, m)| (std::cmp::Reverse(s), m));
        let us = pos.side();
        let mut legal = 0;
        for &(_, m) in &scored {
            pos.make(m);
            if pos.royal_attacked(us) {
                pos.unmake();
                continue;
            }
            legal += 1;
            let score = -self.quiesce(pos, -beta, -alpha, ply + 1, qply + 1);
            pos.unmake();
            if self.aborted {
                break;
            }
            if score > best {
                best = score;
            }
            if score > alpha {
                alpha = score;
                if alpha >= beta {
                    break;
                }
            }
        }
        self.moves[ply] = moves;
        self.scored[ply] = scored;
        if self.aborted {
            return 0;
        }
        if in_check && legal == 0 {
            return -MATE + ply as i32;
        }
        best
    }
}

/// A score as the game's move picker (src/engine/pick.ts) reads it: centipawns, or for a mate in
/// n moves ±(100000 - n·100), the way it parses a UCI `score mate n`.
pub fn game_score(score: i32) -> i32 {
    if score > MATE_BOUND {
        let moves = (MATE - score + 1) / 2;
        100_000 - moves * 100
    } else if score < -MATE_BOUND {
        let moves = (MATE + score) / 2;
        -100_000 + moves * 100
    } else {
        score
    }
}

/// UCI's `score` field for a search score: `cp N` or `mate N` (moves; negative when being mated).
pub fn uci_score(score: i32) -> String {
    if score > MATE_BOUND {
        format!("mate {}", (MATE - score + 1) / 2)
    } else if score < -MATE_BOUND {
        format!("mate -{}", (MATE + score) / 2)
    } else {
        format!("cp {score}")
    }
}
