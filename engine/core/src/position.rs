//! A position and its rules: FEN, legal moves, make/unmake, check, and the draw rules.
//!
//! Matches Fairy-Stockfish's behaviour for the game's variants (checked move for move against ffish by
//! scripts/check/perft.ts): no castling; promotion to Q, R, B or N on the last rank; a pawn's or
//! Berolina pawn's double step only from its own second rank; en passant by pawns only. In the
//! two-kings rules (an Heir on the board) a side with two kings has no royal piece, and its last king
//! is royal.

use crate::betza::Kind;
use crate::pieces::{self, BISHOP, HEIR, KNIGHT, PAWN, PIECE_COUNT, PIECES, PROMOTIONS, PieceType};
use crate::tables::{MAX_SQUARES, NO_SQUARE, OPPOSITE, Square, Tables, tables};

pub type Color = u8;
pub const WHITE: Color = 0;
pub const BLACK: Color = 1;

/// A board cell: 0 when empty, else 1 + type * 2 + color.
pub type Cell = u8;
pub const EMPTY: Cell = 0;

pub fn cell(ty: PieceType, color: Color) -> Cell {
    1 + ty * 2 + color
}
pub fn cell_type(c: Cell) -> PieceType {
    (c - 1) >> 1
}
pub fn cell_color(c: Cell) -> Color {
    (c - 1) & 1
}

/// A move: from, to, and the promotion piece type (or NO_PROMOTION).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Move {
    pub from: Square,
    pub to: Square,
    pub promo: PieceType,
}

pub const NO_PROMOTION: PieceType = u8::MAX;

/// En passant state after a double step: the square passed over, and the piece that can be taken.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EnPassant {
    pub square: Square,
    pub victim: Square,
}

#[derive(Clone, Copy)]
struct Undo {
    mv: Move,
    moved: Cell,
    captured: Cell,
    captured_at: Square,
    ep: Option<EnPassant>,
    halfmove: u16,
    hash: u64,
    /// The incremental scores before the move, restored as they were rather than worked out again.
    score: (i32, i32),
    phase: i32,
    pawn_hash: u64,
}

#[derive(Clone)]
pub struct Position {
    t: &'static Tables,
    board: [Cell; MAX_SQUARES],
    side: Color,
    ep: Option<EnPassant>,
    halfmove: u16,
    fullmove: u16,
    /// The two-kings rules (Fairy-Stockfish's `accNk2` variants).
    two_kings: bool,
    hash: u64,
    history: Vec<Undo>,
    /// Each side's king squares (King and Heirs: up to three with the Dynasty perk), kept up to date
    /// by make/unmake so check tests don't scan the board.
    kings: [[Square; MAX_KINGS]; 2],
    king_count: [u8; 2],
    /// Piece-square values (middlegame, endgame) per cell and square: eval::psq_table.
    psq: &'static [(i32, i32)],
    /// White's piece-square sum minus black's, (middlegame, endgame), kept up to date by make/unmake.
    score: (i32, i32),
    /// Non-pawn material on the board, for the evaluation's middlegame/endgame blend (eval::phase).
    phase: i32,
    /// A hash of the pawn-like pieces alone (the evaluation caches its pawn terms by it).
    pawn_hash: u64,
    /// How many pieces of each type each side has.
    counts: [[u8; PIECE_COUNT]; 2],
    /// Each side's piece types on the board, one bit per type (counts above zero): attack tests skip
    /// the moves of pieces a side doesn't have.
    present: [u32; 2],
}

const MAX_KINGS: usize = 4;

/// The king-like and the pawn-like piece types, one bit per type.
const KING_TYPES: u32 = type_mask(true);
const PAWN_TYPES: u32 = type_mask(false);

const fn type_mask(kings: bool) -> u32 {
    let mut m = 0;
    let mut i = 0;
    while i < PIECE_COUNT {
        if (kings && PIECES[i].king) || (!kings && PIECES[i].pawn) {
            m |= 1 << i;
        }
        i += 1;
    }
    m
}

// ---- Zobrist keys (fixed, so hashes are the same in every build) ----

const fn splitmix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

const CELLS: usize = 1 + 2 * PIECE_COUNT;

/// piece_key for every cell and square, worked out at compile time. An Heir hashes as a King: in the
/// two-kings rules they're the same piece, and Fairy-Stockfish counts a position with them swapped as
/// a repetition.
static PIECE_KEYS: [[u64; MAX_SQUARES]; CELLS] = {
    let mut keys = [[0; MAX_SQUARES]; CELLS];
    let mut c = 0;
    while c < CELLS {
        let hashed = if c > 0 && (c - 1) >> 1 == HEIR as usize { c - 2 } else { c };
        let mut sq = 0;
        while sq < MAX_SQUARES {
            keys[c][sq] = splitmix((hashed as u64) << 8 | sq as u64);
            sq += 1;
        }
        c += 1;
    }
    keys
};

static EP_KEYS: [u64; MAX_SQUARES] = {
    let mut keys = [0; MAX_SQUARES];
    let mut sq = 0;
    while sq < MAX_SQUARES {
        keys[sq] = splitmix(0xE9_0000 | sq as u64);
        sq += 1;
    }
    keys
};

fn piece_key(c: Cell, sq: Square) -> u64 {
    PIECE_KEYS[c as usize][sq as usize]
}
fn ep_key(sq: Square) -> u64 {
    EP_KEYS[sq as usize]
}
const SIDE_KEY: u64 = splitmix(0x51DE);

#[derive(Debug, PartialEq, Eq)]
pub enum FenError {
    Size,
    Placement(String),
    Side,
    EnPassant,
    Counter,
}

pub fn opponent(c: Color) -> Color {
    c ^ 1
}

impl Position {
    /// Parses a FEN for an n×n board. `two_kings` selects the two-kings rules.
    pub fn from_fen(size: u8, fen: &str, two_kings: bool) -> Result<Position, FenError> {
        if !(2..=9).contains(&size) {
            return Err(FenError::Size);
        }
        let t = tables(size);
        let mut parts = fen.split_whitespace();
        let placement = parts.next().ok_or(FenError::Placement("empty".into()))?;
        let mut board = [EMPTY; MAX_SQUARES];
        let rows: Vec<&str> = placement.split('/').collect();
        if rows.len() != t.ranks as usize {
            return Err(FenError::Placement(format!("{} ranks", rows.len())));
        }
        for (i, row) in rows.iter().enumerate() {
            let rank = t.ranks as i32 - 1 - i as i32;
            let mut file = 0i32;
            for ch in row.bytes() {
                if ch.is_ascii_digit() {
                    file += (ch - b'0') as i32;
                    continue;
                }
                let ty = pieces::piece_type(ch).ok_or(FenError::Placement(format!("piece '{}'", ch as char)))?;
                let sq = t.square(file, rank).ok_or(FenError::Placement(format!("rank {row} too long")))?;
                board[sq as usize] = cell(ty, if ch.is_ascii_uppercase() { WHITE } else { BLACK });
                file += 1;
            }
            if file != t.files as i32 {
                return Err(FenError::Placement(format!("rank {row} has {file} files")));
            }
        }
        let side = match parts.next().unwrap_or("w") {
            "w" => WHITE,
            "b" => BLACK,
            _ => return Err(FenError::Side),
        };
        let _castling = parts.next();
        let ep_field = parts.next().unwrap_or("-");
        let halfmove = parts.next().unwrap_or("0").parse().map_err(|_| FenError::Counter)?;
        let fullmove = parts.next().unwrap_or("1").parse().map_err(|_| FenError::Counter)?;
        let mut pos = Position {
            t,
            board: [EMPTY; MAX_SQUARES],
            side,
            ep: None,
            halfmove,
            fullmove,
            two_kings,
            hash: 0,
            history: Vec::new(),
            kings: [[NO_SQUARE; MAX_KINGS]; 2],
            king_count: [0; 2],
            psq: crate::eval::psq_table(size),
            score: (0, 0),
            phase: 0,
            pawn_hash: 0,
            counts: [[0; PIECE_COUNT]; 2],
            present: [0; 2],
        };
        for (sq, &c) in board.iter().enumerate().take(t.squares) {
            if c != EMPTY {
                if PIECES[cell_type(c) as usize].king && pos.king_count[cell_color(c) as usize] as usize == MAX_KINGS {
                    return Err(FenError::Placement("too many kings".into()));
                }
                pos.put(sq as Square, c);
            }
        }
        if ep_field != "-" {
            let first = pos.parse_square(&ep_field[..2]).ok_or(FenError::EnPassant)?;
            // Two squares after a Berolina pawn's double step: the empty one is the square passed.
            let (square, victim) = if ep_field.len() > 2 {
                let second = pos.parse_square(&ep_field[2..]).ok_or(FenError::EnPassant)?;
                if board[first as usize] == EMPTY { (first, second) } else { (second, first) }
            } else {
                let square = first;
                let dir = if side == WHITE { -1 } else { 1 };
                (square, t.square(t.file(square), t.rank(square) + dir).ok_or(FenError::EnPassant)?)
            };
            pos.ep = Some(EnPassant { square, victim });
        }
        pos.hash = pos.compute_hash();
        Ok(pos)
    }

    pub fn fen(&self) -> String {
        let t = self.t;
        let mut s = String::new();
        for rank in (0..t.ranks as i32).rev() {
            let mut empty = 0;
            for file in 0..t.files as i32 {
                let c = self.board[t.square(file, rank).unwrap() as usize];
                if c == EMPTY {
                    empty += 1;
                    continue;
                }
                if empty > 0 {
                    s.push((b'0' + empty) as char);
                    empty = 0;
                }
                let letter = PIECES[cell_type(c) as usize].letter;
                s.push(if cell_color(c) == WHITE { letter } else { letter.to_ascii_lowercase() } as char);
            }
            if empty > 0 {
                s.push((b'0' + empty) as char);
            }
            if rank > 0 {
                s.push('/');
            }
        }
        s.push_str(if self.side == WHITE { " w - " } else { " b - " });
        match self.ep {
            None => s.push('-'),
            // After a Berolina pawn's diagonal double step Fairy-Stockfish lists both the square passed
            // and the pawn's square, in board order.
            Some(ep) if !self.victim_straight_ahead(ep) => {
                let (a, b) = (ep.square.min(ep.victim), ep.square.max(ep.victim));
                s.push_str(&self.square_name(a));
                s.push_str(&self.square_name(b));
            }
            Some(ep) => s.push_str(&self.square_name(ep.square)),
        }
        s.push_str(&format!(" {} {}", self.halfmove, self.fullmove));
        s
    }

    fn victim_straight_ahead(&self, ep: EnPassant) -> bool {
        self.t.file(ep.square) == self.t.file(ep.victim)
    }

    pub fn square_name(&self, sq: Square) -> String {
        format!("{}{}", (b'a' + self.t.file(sq) as u8) as char, self.t.rank(sq) + 1)
    }

    pub fn parse_square(&self, s: &str) -> Option<Square> {
        let b = s.as_bytes();
        if b.len() < 2 || !b[0].is_ascii_lowercase() {
            return None;
        }
        let rank: i32 = s[1..].parse().ok()?;
        self.t.square((b[0] - b'a') as i32, rank - 1)
    }

    pub fn move_name(&self, m: Move) -> String {
        let mut s = format!("{}{}", self.square_name(m.from), self.square_name(m.to));
        if m.promo != NO_PROMOTION {
            s.push(PIECES[m.promo as usize].letter.to_ascii_lowercase() as char);
        }
        s
    }

    /// The legal move with this UCI name, if any.
    pub fn parse_move(&mut self, uci: &str) -> Option<Move> {
        self.legal_moves().into_iter().find(|&m| self.move_name(m) == uci)
    }

    pub fn side(&self) -> Color {
        self.side
    }
    pub fn halfmove(&self) -> u16 {
        self.halfmove
    }
    pub fn hash(&self) -> u64 {
        self.hash
    }
    pub fn tables(&self) -> &'static Tables {
        self.t
    }
    pub fn at(&self, sq: Square) -> Cell {
        self.board[sq as usize]
    }

    fn compute_hash(&self) -> u64 {
        let mut h = 0;
        for sq in 0..self.t.squares {
            if self.board[sq] != EMPTY {
                h ^= piece_key(self.board[sq], sq as Square);
            }
        }
        if self.side == BLACK {
            h ^= SIDE_KEY;
        }
        if let Some(ep) = self.ep {
            h ^= ep_key(ep.square);
        }
        h
    }

    // ---- attacks and check ----

    /// Whether `by` attacks `sq` (could capture a piece standing there).
    pub fn attacked(&self, sq: Square, by: Color) -> bool {
        let t = self.t;
        let a = &t.attacks[by as usize];
        let have = self.present[by as usize];
        let (f, r) = (t.file(sq), t.rank(sq));
        let is = |s: Square, mask: u32| {
            let c = self.board[s as usize];
            c != EMPTY && cell_color(c) == by && mask & (1 << cell_type(c)) != 0
        };
        for &(dx, dy, mask) in &a.leaps {
            if mask & have != 0
                && let Some(s) = t.square(f - dx as i32, r - dy as i32)
                && is(s, mask)
            {
                return true;
            }
        }
        for (d, &back) in OPPOSITE.iter().enumerate() {
            // A piece capturing along DIRS[d] stands in the opposite direction.
            let ray = &t.rays[sq as usize][back];
            let (ride, hop, grass) = (a.ride[d] & have, a.hop[d] & have, a.grass[d] & have);
            if ride | hop | grass == 0 {
                continue;
            }
            let mut i = 0;
            // First piece: a rider.
            while i < ray.len() && self.board[ray[i] as usize] == EMPTY {
                i += 1;
            }
            if i == ray.len() {
                continue;
            }
            if is(ray[i], ride) {
                return true;
            }
            // A grasshopper lands right past its hurdle: the hurdle is adjacent to sq (i == 0),
            // and the grasshopper is the next piece behind it.
            let hurdle = i;
            i += 1;
            while i < ray.len() && self.board[ray[i] as usize] == EMPTY {
                i += 1;
            }
            if i < ray.len() && (is(ray[i], hop) || (hurdle == 0 && is(ray[i], grass))) {
                return true;
            }
        }
        false
    }

    /// Places a piece on an empty square, keeping the hash, scores, counts and kings up to date.
    fn put(&mut self, sq: Square, c: Cell) {
        self.board[sq as usize] = c;
        self.hash ^= piece_key(c, sq);
        let color = cell_color(c);
        let ty = cell_type(c);
        let (mg, eg) = self.psq[(c as usize - 1) * MAX_SQUARES + sq as usize];
        let sign = if color == WHITE { 1 } else { -1 };
        self.score = (self.score.0 + sign * mg, self.score.1 + sign * eg);
        self.phase += crate::eval::phase_points(c);
        if PIECES[ty as usize].pawn {
            self.pawn_hash ^= piece_key(c, sq);
        }
        self.counts[color as usize][ty as usize] += 1;
        self.present[color as usize] |= 1 << ty;
        if PIECES[ty as usize].king {
            self.add_king(color, sq);
        }
    }

    /// Removes the piece on `sq` (the reverse of put) and returns it.
    fn take(&mut self, sq: Square) -> Cell {
        let c = self.board[sq as usize];
        self.board[sq as usize] = EMPTY;
        self.hash ^= piece_key(c, sq);
        let color = cell_color(c);
        let ty = cell_type(c);
        let (mg, eg) = self.psq[(c as usize - 1) * MAX_SQUARES + sq as usize];
        let sign = if color == WHITE { 1 } else { -1 };
        self.score = (self.score.0 - sign * mg, self.score.1 - sign * eg);
        self.phase -= crate::eval::phase_points(c);
        if PIECES[ty as usize].pawn {
            self.pawn_hash ^= piece_key(c, sq);
        }
        self.counts[color as usize][ty as usize] -= 1;
        if self.counts[color as usize][ty as usize] == 0 {
            self.present[color as usize] &= !(1 << ty);
        }
        if PIECES[ty as usize].king {
            self.remove_king(color, sq);
        }
        c
    }

    /// White's piece-square sum minus black's: (middlegame, endgame).
    pub fn psq_score(&self) -> (i32, i32) {
        self.score
    }

    /// A hash of where the pawn-like pieces stand.
    pub fn pawn_hash(&self) -> u64 {
        self.pawn_hash
    }

    /// Non-pawn material on the board in battle points (both sides).
    pub fn phase_points(&self) -> i32 {
        self.phase
    }

    /// `color`'s royal king's square, if it has one (its only king).
    pub fn royal_square(&self, color: Color) -> Option<Square> {
        self.royal(color)
    }

    /// How many pieces of type `ty` `color` has.
    pub fn count(&self, color: Color, ty: PieceType) -> u8 {
        self.counts[color as usize][ty as usize]
    }

    fn add_king(&mut self, color: Color, sq: Square) {
        let c = color as usize;
        self.kings[c][self.king_count[c] as usize] = sq;
        self.king_count[c] += 1;
    }

    fn remove_king(&mut self, color: Color, sq: Square) {
        let c = color as usize;
        let n = self.king_count[c] as usize;
        let i = self.kings[c][..n].iter().position(|&k| k == sq).expect("a king on its square");
        self.kings[c][i] = self.kings[c][n - 1];
        self.kings[c][n - 1] = NO_SQUARE;
        self.king_count[c] -= 1;
    }

    /// The square of `color`'s royal king: its only king (with two kings, neither is royal).
    fn royal(&self, color: Color) -> Option<Square> {
        let n = self.king_count[color as usize];
        if n == 1 || (!self.two_kings && n >= 1) { Some(self.kings[color as usize][0]) } else { None }
    }

    /// Whether `color`'s royal king (if it has one) is attacked: after `color` moved, the move was illegal.
    pub fn royal_attacked(&self, color: Color) -> bool {
        self.royal(color).is_some_and(|k| self.attacked(k, opponent(color)))
    }

    /// For a quiet move (no capture, no promotion): whether it's legal and whether it gives check, as
    /// make() then royal_attacked() and in_check() would answer, but without making it (search
    /// prunes many such moves unplayed). None when it can't tell cheaply (a king moving among several).
    pub fn quiet_check(&mut self, m: Move) -> Option<(bool, bool)> {
        let us = self.side;
        let them = opponent(us);
        let moved = self.board[m.from as usize];
        let mut royal = self.royal(us);
        if PIECES[cell_type(moved) as usize].king {
            if self.king_count[us as usize] != 1 {
                return None;
            }
            royal = Some(m.to);
        }
        // Moving the piece is all that matters to attacks: no capture, and the side's piece types stay.
        self.board[m.to as usize] = moved;
        self.board[m.from as usize] = EMPTY;
        let legal = !royal.is_some_and(|k| self.attacked(k, them));
        let check = legal && self.royal(them).is_some_and(|k| self.attacked(k, us));
        self.board[m.from as usize] = moved;
        self.board[m.to as usize] = EMPTY;
        Some((legal, check))
    }

    /// The type of the piece `m` captures, if any (en passant included).
    pub fn captured_type(&self, m: Move) -> Option<PieceType> {
        let target = self.board[m.to as usize];
        if target != EMPTY {
            return Some(cell_type(target));
        }
        let moved = self.board[m.from as usize];
        let ep = self.ep?;
        (cell_type(moved) == PAWN && ep.square == m.to && self.t.file(m.from) != self.t.file(m.to))
            .then(|| cell_type(self.board[ep.victim as usize]))
    }

    /// Whether `color` has a piece other than kings and pawn-like pieces (null-move pruning is unsafe
    /// without one: zugzwang).
    pub fn has_pieces(&self, color: Color) -> bool {
        self.present[color as usize] & !(KING_TYPES | PAWN_TYPES) != 0
    }

    pub fn two_kings(&self) -> bool {
        self.two_kings
    }

    /// Whether the side to move's royal king is attacked.
    pub fn in_check(&self) -> bool {
        self.royal(self.side).is_some_and(|k| self.attacked(k, opponent(self.side)))
    }

    // ---- move generation ----

    fn in_double_step_region(&self, sq: Square, color: Color) -> bool {
        let r = self.t.rank(sq);
        if color == WHITE { r == 1 } else { r == self.t.ranks as i32 - 2 }
    }

    fn last_rank(&self, sq: Square, color: Color) -> bool {
        let r = self.t.rank(sq);
        if color == WHITE { r == self.t.ranks as i32 - 1 } else { r == 0 }
    }

    fn push_move(&self, out: &mut Vec<Move>, ty: PieceType, from: Square, to: Square) {
        if PIECES[ty as usize].pawn && self.last_rank(to, self.side) {
            for p in PROMOTIONS {
                out.push(Move { from, to, promo: p });
            }
        } else {
            out.push(Move { from, to, promo: NO_PROMOTION });
        }
    }

    /// Moves that follow the pieces' movement, ignoring whether they leave a royal king attacked.
    pub fn pseudo_moves(&self, out: &mut Vec<Move>) {
        self.generate::<false>(out);
    }

    /// The captures (en passant included) and promotions among pseudo_moves, in the same order: what
    /// the quiescence search looks at.
    pub fn noisy_moves(&self, out: &mut Vec<Move>) {
        self.generate::<true>(out);
    }

    /// pseudo_moves, or with NOISY only the captures and promotions.
    fn generate<const NOISY: bool>(&self, out: &mut Vec<Move>) {
        let t = self.t;
        let us = self.side;
        for from in 0..t.squares as Square {
            let c = self.board[from as usize];
            if c == EMPTY || cell_color(c) != us {
                continue;
            }
            let ty = cell_type(c);
            let pm = &t.moves[us as usize][ty as usize];
            let start = out.len();
            let region = self.in_double_step_region(from, us);
            // A move to an empty square: wanted unless only noisy moves are, and it doesn't promote.
            let pawn = PIECES[ty as usize].pawn;
            let quiet_ok = |to: Square| !NOISY || (pawn && self.last_rank(to, us));
            for l in &pm.leaps[from as usize] {
                if l.initial && !region {
                    continue;
                }
                if l.via != NO_SQUARE && self.board[l.via as usize] != EMPTY {
                    continue;
                }
                let target = self.board[l.to as usize];
                if target == EMPTY {
                    // A pawn's capture onto the square an enemy double step passed is en passant.
                    if (l.mode.moves() && quiet_ok(l.to)) || (ty == PAWN && self.ep.is_some_and(|ep| ep.square == l.to))
                    {
                        self.push_move(out, ty, from, l.to);
                    }
                } else if cell_color(target) != us && l.mode.captures() {
                    self.push_move(out, ty, from, l.to);
                }
            }
            for l in &pm.lines {
                if l.initial && !region {
                    continue;
                }
                let ray = &t.rays[from as usize][l.dir as usize];
                let n = if l.max == 0 { ray.len() } else { ray.len().min(l.max as usize) };
                match l.kind {
                    Kind::Ride => {
                        for &to in &ray[..n] {
                            let target = self.board[to as usize];
                            if target == EMPTY {
                                if l.mode.moves() && quiet_ok(to) {
                                    self.push_move(out, ty, from, to);
                                }
                                continue;
                            }
                            if cell_color(target) != us && l.mode.captures() {
                                self.push_move(out, ty, from, to);
                            }
                            break;
                        }
                    }
                    Kind::Hop => {
                        let mut screen = false;
                        for &to in &ray[..n] {
                            let target = self.board[to as usize];
                            if !screen {
                                screen = target != EMPTY;
                                continue;
                            }
                            if target == EMPTY {
                                if l.mode.moves() && quiet_ok(to) {
                                    self.push_move(out, ty, from, to);
                                }
                                continue;
                            }
                            if cell_color(target) != us && l.mode.captures() {
                                self.push_move(out, ty, from, to);
                            }
                            break;
                        }
                    }
                    Kind::Grass => {
                        if let Some(h) = ray[..n].iter().position(|&s| self.board[s as usize] != EMPTY)
                            && h + 1 < n
                        {
                            let to = ray[h + 1];
                            let target = self.board[to as usize];
                            if (target == EMPTY && l.mode.moves() && quiet_ok(to))
                                || (target != EMPTY && cell_color(target) != us && l.mode.captures())
                            {
                                self.push_move(out, ty, from, to);
                            }
                        }
                    }
                    Kind::Leap => unreachable!(),
                }
            }
            if pm.overlaps {
                let added = &mut out[start..];
                added.sort_unstable();
                let mut keep = start;
                for i in start..out.len() {
                    if i == start || out[i] != out[keep - 1] {
                        out[keep] = out[i];
                        keep += 1;
                    }
                }
                out.truncate(keep);
            }
        }
    }

    pub fn legal_moves(&mut self) -> Vec<Move> {
        let mut moves = Vec::with_capacity(64);
        self.pseudo_moves(&mut moves);
        moves.retain(|&m| self.is_legal_after(m));
        moves
    }

    /// Plays `m` and checks that it doesn't leave the mover's royal king attacked, then takes it back.
    fn is_legal_after(&mut self, m: Move) -> bool {
        let us = self.side;
        self.make(m);
        let ok = !self.royal_attacked(us);
        self.unmake();
        ok
    }

    // ---- make / unmake ----

    pub fn make(&mut self, m: Move) {
        let us = self.side;
        let moved = self.board[m.from as usize];
        let ty = cell_type(moved);
        let mut captured_at = m.to;
        let mut captured = self.board[m.to as usize];
        // En passant: a pawn's diagonal capture onto the square passed over (a straight move there is
        // an ordinary move, possible after a Berolina pawn's diagonal double step).
        if ty == PAWN
            && captured == EMPTY
            && self.t.file(m.from) != self.t.file(m.to)
            && let Some(ep) = self.ep
            && ep.square == m.to
        {
            captured_at = ep.victim;
            captured = self.board[ep.victim as usize];
        }
        self.history.push(Undo {
            mv: m,
            moved,
            captured,
            captured_at,
            ep: self.ep,
            halfmove: self.halfmove,
            hash: self.hash,
            score: self.score,
            phase: self.phase,
            pawn_hash: self.pawn_hash,
        });

        if let Some(ep) = self.ep.take() {
            self.hash ^= ep_key(ep.square);
        }
        if captured != EMPTY {
            self.take(captured_at);
        }
        self.take(m.from);
        self.put(m.to, if m.promo != NO_PROMOTION { cell(m.promo, us) } else { moved });

        // A pawn's move, a capture or a promotion resets the 50-move count (a Berolina pawn's other
        // moves don't, as in Fairy-Stockfish).
        let resets = ty == PAWN || captured != EMPTY || m.promo != NO_PROMOTION;
        self.halfmove = if resets { 0 } else { self.halfmove + 1 };
        if PIECES[ty as usize].pawn {
            self.ep = self.double_step(m, ty);
            if let Some(ep) = self.ep {
                self.hash ^= ep_key(ep.square);
            }
        }
        if us == BLACK {
            self.fullmove += 1;
        }
        self.side = opponent(us);
        self.hash ^= SIDE_KEY;
    }

    /// The en passant state a pawn-like piece's two-square move leaves. As in Fairy-Stockfish, a pawn's
    /// double step only counts when an enemy pawn could take it; a Berolina pawn's always does.
    fn double_step(&self, m: Move, ty: PieceType) -> Option<EnPassant> {
        let t = self.t;
        let (df, dr) = (t.file(m.to) - t.file(m.from), t.rank(m.to) - t.rank(m.from));
        if dr.abs() != 2 || (df != 0 && df.abs() != 2) {
            return None;
        }
        let square = t.square(t.file(m.from) + df / 2, t.rank(m.from) + dr / 2).unwrap();
        let ep = EnPassant { square, victim: m.to };
        if ty != PAWN {
            return Some(ep);
        }
        let them = opponent(self.side);
        let pawn = cell(PAWN, them);
        // An enemy pawn takes onto `square` from one rank past it (towards its own side), one file over.
        let r = t.rank(square) + dr.signum();
        let takers = [t.square(t.file(square) - 1, r), t.square(t.file(square) + 1, r)];
        takers.into_iter().flatten().any(|s| self.board[s as usize] == pawn).then_some(ep)
    }

    pub fn unmake(&mut self) {
        let u = self.history.pop().expect("a move to take back");
        self.side = opponent(self.side);
        if u.mv.from == NO_SQUARE {
            // A null move.
            self.ep = u.ep;
            self.halfmove = u.halfmove;
            self.hash = u.hash;
            return;
        }
        if self.side == BLACK {
            self.fullmove -= 1;
        }
        self.lift(u.mv.to);
        self.place(u.mv.from, u.moved);
        if u.captured != EMPTY {
            self.place(u.captured_at, u.captured);
        }
        self.ep = u.ep;
        self.halfmove = u.halfmove;
        self.hash = u.hash;
        self.score = u.score;
        self.phase = u.phase;
        self.pawn_hash = u.pawn_hash;
    }

    /// put() for unmake: the board, counts and kings only (it restores the hash and scores itself).
    fn place(&mut self, sq: Square, c: Cell) {
        self.board[sq as usize] = c;
        let (color, ty) = (cell_color(c) as usize, cell_type(c));
        self.counts[color][ty as usize] += 1;
        self.present[color] |= 1 << ty;
        if PIECES[ty as usize].king {
            self.add_king(color as Color, sq);
        }
    }

    /// take() for unmake, as place() is put().
    fn lift(&mut self, sq: Square) {
        let c = self.board[sq as usize];
        self.board[sq as usize] = EMPTY;
        let (color, ty) = (cell_color(c) as usize, cell_type(c));
        self.counts[color][ty as usize] -= 1;
        if self.counts[color][ty as usize] == 0 {
            self.present[color] &= !(1 << ty);
        }
        if PIECES[ty as usize].king {
            self.remove_king(color as Color, sq);
        }
    }

    /// Passes the move (for null-move pruning in search). Undo with unmake().
    pub fn make_null(&mut self) {
        let none = Move { from: NO_SQUARE, to: NO_SQUARE, promo: NO_PROMOTION };
        self.history.push(Undo {
            mv: none,
            moved: EMPTY,
            captured: EMPTY,
            captured_at: NO_SQUARE,
            ep: self.ep,
            halfmove: self.halfmove,
            hash: self.hash,
            score: self.score,
            phase: self.phase,
            pawn_hash: self.pawn_hash,
        });
        if let Some(ep) = self.ep.take() {
            self.hash ^= ep_key(ep.square);
        }
        self.halfmove += 1;
        self.side = opponent(self.side);
        self.hash ^= SIDE_KEY;
    }

    /// The hash of the position `plies_ago` plies back (1 = before the last move).
    pub fn earlier_hash(&self, plies_ago: usize) -> u64 {
        self.history[self.history.len() - plies_ago].hash
    }

    /// Plies played since this position was set up.
    pub fn ply(&self) -> usize {
        self.history.len()
    }

    // ---- draws ----

    /// The current position has occurred three times (since the last pawn move or capture), as
    /// Fairy-Stockfish claims it.
    pub fn is_threefold(&self) -> bool {
        let end = (self.halfmove as usize).min(self.history.len());
        let mut count = 0;
        let mut i = 4;
        while i <= end {
            if self.history[self.history.len() - i].hash == self.hash {
                count += 1;
                if count == 2 {
                    return true;
                }
            }
            i += 2;
        }
        false
    }

    /// Neither side can mate. Never in the two-kings rules, as in Fairy-Stockfish.
    pub fn insufficient_material(&self) -> bool {
        if self.two_kings {
            return false;
        }
        // Anything but kings, knights and bishops can mate (cheap test first: this runs in search).
        let only_minors = (self.present[0] | self.present[1]) & !(KING_TYPES | 1 << KNIGHT | 1 << BISHOP) == 0;
        if !only_minors {
            return false;
        }
        let mut knights = 0;
        let mut bishops = [false; 2];
        for sq in 0..self.t.squares as Square {
            let c = self.board[sq as usize];
            if c == EMPTY {
                continue;
            }
            match cell_type(c) {
                ty if PIECES[ty as usize].king => {}
                KNIGHT => knights += 1,
                BISHOP => bishops[((self.t.file(sq) + self.t.rank(sq)) % 2) as usize] = true,
                _ => return false,
            }
        }
        match knights {
            0 => !(bishops[0] && bishops[1]),
            1 => !bishops[0] && !bishops[1],
            _ => false,
        }
    }
}

/// Counts the leaf nodes of the legal move tree to `depth`.
pub fn perft(pos: &mut Position, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let moves = pos.legal_moves();
    if depth == 1 {
        return moves.len() as u64;
    }
    let mut n = 0;
    for m in moves {
        pos.make(m);
        n += perft(pos, depth - 1);
        pos.unmake();
    }
    n
}
