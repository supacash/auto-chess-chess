//! Static evaluation in centipawns, from the side to move's point of view. Integer-only.
//!
//! A sum of terms, each a feature of the position (white's minus black's) times a weight, with a
//! middlegame and an endgame weight blended by how much material is left. The weights are tuned on
//! self-play (`acc tune`, written to params.rs). Material, centralisation and advancement are kept
//! summed by Position as moves are made (piece-square tables); passed pawns and king shelter are
//! counted here.

use crate::pieces::{PIECE_COUNT, PIECES, PieceType};
use crate::position::{BLACK, Cell, Color, EMPTY, Position, WHITE, cell_color, cell_type};
use crate::tables::{MAX_SIZE, MAX_SQUARES, Square, Tables, tables};
use std::sync::OnceLock;

/// Piece values in centipawns: the game's point values (src/rules/pieces.ts) × 100. These decide
/// battles on points; the evaluation's own (tuned) piece values are separate. Kings are 0.
pub const VALUES: [i32; PIECE_COUNT] = {
    // K J Q R B N P E F W M L G X T A C Z D H U S Y
    let points = [0, 0, 9, 5, 3, 3, 1, 1, 1, 1, 3, 2, 1, 3, 6, 7, 8, 12, 6, 6, 6, 6, 9];
    let mut v = [0; PIECE_COUNT];
    let mut i = 0;
    while i < PIECE_COUNT {
        v[i] = points[i] * 100;
        i += 1;
    }
    v
};

/// The battle-points value of a piece type (for move ordering and the points rules).
pub fn value(ty: PieceType) -> i32 {
    VALUES[ty as usize]
}

// ---- terms ----
// Each term has a middlegame and an endgame weight: WEIGHTS[2 * term] and WEIGHTS[2 * term + 1].

/// Piece type t: its value (count), centralisation (summed) and advancement (ranks from home, summed).
pub const fn value_term(t: usize) -> usize {
    t
}
pub const fn center_term(t: usize) -> usize {
    PIECE_COUNT + t
}
pub const fn advance_term(t: usize) -> usize {
    2 * PIECE_COUNT + t
}
/// A passed pawn with `to_go` ranks left to promote (1..=8).
pub const fn passed_term(to_go: usize) -> usize {
    3 * PIECE_COUNT + to_go - 1
}
/// Own pieces next to the royal king.
pub const SHELTER_TERM: usize = 3 * PIECE_COUNT + 8;
pub const TERMS: usize = SHELTER_TERM + 1;
/// The bonus for having the move (not blended): the last weight.
pub const TEMPO: usize = 2 * TERMS;
pub const WEIGHT_COUNT: usize = 2 * TERMS + 1;

/// Hand-set starting weights, before any tuning.
pub fn default_weights() -> Vec<i32> {
    let mut w = vec![0; WEIGHT_COUNT];
    for (t, def) in PIECES.iter().enumerate() {
        let (v, c, a) = if def.king {
            // Hide in the middlegame, centralise in the endgame.
            ((0, 0), (-4, 6), (-8, 0))
        } else if def.pawn {
            ((VALUES[t], VALUES[t] + 20), (0, 0), (6, 12))
        } else {
            ((VALUES[t], VALUES[t]), (2, 2), (0, 0))
        };
        (w[2 * value_term(t)], w[2 * value_term(t) + 1]) = v;
        (w[2 * center_term(t)], w[2 * center_term(t) + 1]) = c;
        (w[2 * advance_term(t)], w[2 * advance_term(t) + 1]) = a;
    }
    for to_go in 1..=8 {
        let bonus = [0, 90, 60, 40, 25, 15, 10, 5, 5][to_go];
        (w[2 * passed_term(to_go)], w[2 * passed_term(to_go) + 1]) = (bonus / 2, bonus);
    }
    (w[2 * SHELTER_TERM], w[2 * SHELTER_TERM + 1]) = (8, 0);
    w[TEMPO] = 10;
    w
}

/// The weights in use: tuned ones from params.rs, else the defaults.
pub fn weights() -> &'static [i32] {
    static W: OnceLock<Vec<i32>> = OnceLock::new();
    W.get_or_init(|| match crate::params::TUNED {
        Some(t) if t.len() == WEIGHT_COUNT => t.to_vec(),
        _ => default_weights(),
    })
}

/// The blend: (middlegame weight, out of max). Non-pawn material left (in battle points, both sides),
/// capped at 8 points per file of the board.
pub fn phase(pos: &Position) -> (i32, i32) {
    let max = 8 * pos.tables().files as i32;
    (pos.phase_points().min(max), max)
}

/// A piece's contribution to the blend: its battle points if it's neither a king nor a pawn.
pub fn phase_points(c: Cell) -> i32 {
    let d = &PIECES[cell_type(c) as usize];
    if d.king || d.pawn { 0 } else { VALUES[cell_type(c) as usize] / 100 }
}

/// How central a square is: 0 in a corner, up to files + ranks in the middle.
fn centrality(t: &Tables, sq: Square) -> i32 {
    let (f, r, files, ranks) = (t.file(sq), t.rank(sq), t.files as i32, t.ranks as i32);
    (files + ranks) - ((2 * f - (files - 1)).abs() + (2 * r - (ranks - 1)).abs())
}

/// Ranks from `color`'s own back rank.
fn advance(t: &Tables, sq: Square, color: Color) -> i32 {
    if color == WHITE { t.rank(sq) } else { t.ranks as i32 - 1 - t.rank(sq) }
}

/// The piece-square part of the terms for a piece on a square: (middlegame, endgame).
fn psq_value(t: &Tables, c: Cell, sq: Square, w: &[i32]) -> (i32, i32) {
    let ty = cell_type(c) as usize;
    let (cen, adv) = (centrality(t, sq), advance(t, sq, cell_color(c)));
    let term = |k: usize, x: i32| (w[2 * k] * x, w[2 * k + 1] * x);
    let parts = [term(value_term(ty), 1), term(center_term(ty), cen), term(advance_term(ty), adv)];
    parts.iter().fold((0, 0), |(a, b), &(x, y)| (a + x, b + y))
}

static PSQ: [OnceLock<Vec<(i32, i32)>>; MAX_SIZE + 1] = [const { OnceLock::new() }; MAX_SIZE + 1];

/// psq_value for every cell and square of an n×n board, indexed (cell - 1) * MAX_SQUARES + square.
pub fn psq_table(size: u8) -> &'static [(i32, i32)] {
    PSQ[size as usize].get_or_init(|| {
        let t = tables(size);
        let w = weights();
        let mut v = vec![(0, 0); 2 * PIECE_COUNT * MAX_SQUARES];
        for c in 1..=(2 * PIECE_COUNT) as Cell {
            for sq in 0..t.squares as Square {
                v[(c as usize - 1) * MAX_SQUARES + sq as usize] = psq_value(t, c, sq, w);
            }
        }
        v
    })
}

/// Calls `f(color, ranks left to promote)` for each passed pawn: no enemy pawn ahead of it on its file
/// or the files next to it. One pass over the board.
fn passed_pawns(pos: &Position, mut f: impl FnMut(Color, usize)) {
    let t = pos.tables();
    let ranks = t.ranks as i32;
    // Per file: white's rearmost pawn and black's (from white's side, the highest rank).
    let mut white_low = [i32::MAX; MAX_SIZE + 2];
    let mut black_high = [i32::MIN; MAX_SIZE + 2];
    let mut pawns: [(Color, i32, i32); MAX_SQUARES] = [(WHITE, 0, 0); MAX_SQUARES];
    let mut n = 0;
    for sq in 0..t.squares as Square {
        let c = pos.at(sq);
        if c == EMPTY || !PIECES[cell_type(c) as usize].pawn {
            continue;
        }
        let (file, rank, color) = (t.file(sq), t.rank(sq), cell_color(c));
        // Files are shifted by one so the neighbours of the edge files exist.
        let i = file as usize + 1;
        if color == WHITE {
            white_low[i] = white_low[i].min(rank);
        } else {
            black_high[i] = black_high[i].max(rank);
        }
        pawns[n] = (color, file, rank);
        n += 1;
    }
    for &(color, file, rank) in &pawns[..n] {
        let i = file as usize + 1;
        let passed = if color == WHITE {
            (i - 1..=i + 1).all(|j| black_high[j] <= rank)
        } else {
            (i - 1..=i + 1).all(|j| white_low[j] >= rank)
        };
        if passed {
            let advanced = if color == WHITE { rank } else { ranks - 1 - rank };
            f(color, (ranks - 1 - advanced).clamp(1, 8) as usize);
        }
    }
}

/// `color`'s own pieces next to its royal king (0 without one).
fn shelter(pos: &Position, color: Color) -> i32 {
    let Some(k) = pos.royal_square(color) else { return 0 };
    let t = pos.tables();
    let (f, r) = (t.file(k), t.rank(k));
    let mut n = 0;
    for df in -1..=1 {
        for dr in -1..=1 {
            if let Some(s) = t.square(f + df, r + dr) {
                let c = pos.at(s);
                n += (s != k && c != EMPTY && cell_color(c) == color) as i32;
            }
        }
    }
    n
}

/// The passed-pawn terms (middlegame, endgame), white's minus black's: they depend only on where the
/// pawns stand, so they are cached by the pawns' hash (one small table per thread).
fn pawn_terms(pos: &Position, w: &[i32]) -> (i32, i32) {
    const SIZE: usize = 1 << 14;
    thread_local! {
        static CACHE: std::cell::RefCell<Vec<(u64, i32, i32)>> = std::cell::RefCell::new(vec![(0, 0, 0); SIZE]);
    }
    // Board sizes share pawn keys only by accident; mixing in the size keeps them apart.
    let key = pos.pawn_hash() ^ (pos.tables().files as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        let slot = &mut c[(key as usize) & (SIZE - 1)];
        if slot.0 != key {
            let (mut mg, mut eg) = (0, 0);
            passed_pawns(pos, |color, to_go| {
                let sign = if color == WHITE { 1 } else { -1 };
                mg += sign * w[2 * passed_term(to_go)];
                eg += sign * w[2 * passed_term(to_go) + 1];
            });
            *slot = (key, mg, eg);
        }
        (slot.1, slot.2)
    })
}

pub fn evaluate(pos: &Position) -> i32 {
    let w = weights();
    let (mut mg, mut eg) = pos.psq_score();
    let (pmg, peg) = pawn_terms(pos, w);
    mg += pmg;
    eg += peg;
    let mut add = |term: usize, x: i32| {
        mg += w[2 * term] * x;
        eg += w[2 * term + 1] * x;
    };
    add(SHELTER_TERM, shelter(pos, WHITE) - shelter(pos, BLACK));
    let (ph, max) = phase(pos);
    let white = (mg * ph + eg * (max - ph)) / max;
    (if pos.side() == WHITE { white } else { -white }) + w[TEMPO]
}

/// The terms' features (white's minus black's) for tuning, as `(term, value)` pairs, and the blend.
/// evaluate() is Σ weight × value, blended, plus tempo.
pub fn features(pos: &Position) -> (Vec<(usize, i32)>, i32, i32) {
    let t = pos.tables();
    let mut x = vec![0i32; TERMS];
    for sq in 0..t.squares as Square {
        let c = pos.at(sq);
        if c == EMPTY {
            continue;
        }
        let ty = cell_type(c) as usize;
        let color = cell_color(c);
        let sign = if color == WHITE { 1 } else { -1 };
        x[value_term(ty)] += sign;
        x[center_term(ty)] += sign * centrality(t, sq);
        x[advance_term(ty)] += sign * advance(t, sq, color);
    }
    passed_pawns(pos, |color, to_go| x[passed_term(to_go)] += if color == WHITE { 1 } else { -1 });
    x[SHELTER_TERM] += shelter(pos, WHITE) - shelter(pos, BLACK);
    let (ph, max) = phase(pos);
    (x.into_iter().enumerate().filter(|&(_, v)| v != 0).collect(), ph, max)
}

/// Material only (the battle's points), from `color`'s point of view.
pub fn material(pos: &Position, color: Color) -> i32 {
    (0..PIECE_COUNT as PieceType)
        .map(|ty| VALUES[ty as usize] * (pos.count(color, ty) as i32 - pos.count(color ^ 1, ty) as i32))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// evaluate() and features() agree: the incremental tables give the same score as summing terms.
    #[test]
    fn features_reproduce_the_evaluation() {
        let w = weights();
        for (size, fen, two) in [
            (8, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1", false),
            (9, "c2dzka1s/1myzeeame/1mt3tu1/9/9/9/UTAUTUATU/1TATUUAT1/4DK3 w - - 0 1", false),
            (5, "r1k2/ppep1/5/1PXP1/1NK2 w - - 0 1", false),
            (8, "r1bqk1nr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBJR w - - 0 1", true),
            (6, "3k2/6/1P4/6/2e3/2K3 b - - 0 1", false),
        ] {
            let pos = Position::from_fen(size, fen, two).unwrap();
            let (x, ph, max) = features(&pos);
            let (mut mg, mut eg) = (0, 0);
            for (k, v) in x {
                mg += w[2 * k] * v;
                eg += w[2 * k + 1] * v;
            }
            let white = (mg * ph + eg * (max - ph)) / max;
            let expect = (if pos.side() == WHITE { white } else { -white }) + w[TEMPO];
            assert_eq!(evaluate(&pos), expect, "{fen}");
        }
    }
}
