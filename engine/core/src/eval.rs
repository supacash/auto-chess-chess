//! Static evaluation in centipawns, from the side to move's point of view. Integer-only.
//!
//! Phase 3 keeps it simple (material, centralisation, pawn advancement); Phase 4 tunes it.

use crate::pieces::{PIECE_COUNT, PIECES, PieceType};
use crate::position::{Cell, Color, Position, WHITE, cell_color, cell_type};
use crate::tables::{MAX_SIZE, MAX_SQUARES, Square, Tables, tables};
use std::sync::OnceLock;

/// Piece values in centipawns: the game's point values (src/rules/pieces.ts) × 100. Kings are 0.
pub const VALUES: [i32; PIECE_COUNT] = {
    // K J Q R B N P E F W M L G X T A C Z D H U S Y
    let points = [0, 0, 9, 5, 3, 3, 1, 1, 1, 1, 3, 2, 1, 3, 5, 7, 8, 12, 7, 5, 5, 6, 9];
    let mut v = [0; PIECE_COUNT];
    let mut i = 0;
    while i < PIECE_COUNT {
        v[i] = points[i] * 100;
        i += 1;
    }
    v
};

pub fn value(ty: PieceType) -> i32 {
    VALUES[ty as usize]
}

/// A small bonus for having the move.
const TEMPO: i32 = 10;

pub fn evaluate(pos: &Position) -> i32 {
    let side = pos.side();
    pos.psq_score(side) - pos.psq_score(side ^ 1) + TEMPO
}

/// The value of a piece (`cell`) on a square: material plus position. Kept summed per side by Position.
fn psq_value(t: &Tables, c: Cell, sq: Square) -> i32 {
    let (files, ranks) = (t.files as i32, t.ranks as i32);
    let ty = cell_type(c);
    let color: Color = cell_color(c);
    let def = &PIECES[ty as usize];
    let (f, r) = (t.file(sq), t.rank(sq));
    // Ranks advanced from the piece's own back rank.
    let advance = if color == WHITE { r } else { ranks - 1 - r };
    let mut s = VALUES[ty as usize];
    if def.pawn {
        // Worth more the closer it gets to promoting.
        let to_go = ranks - 1 - advance;
        s += 8 * advance + if to_go <= 2 { 30 / to_go.max(1) } else { 0 };
    } else if !def.king {
        // Centralisation: distance from the centre, doubled to stay integral on odd and even boards.
        let dist = (2 * f - (files - 1)).abs() + (2 * r - (ranks - 1)).abs();
        s += 2 * ((files + ranks) - dist);
    }
    s
}

static PSQ: [OnceLock<Vec<i32>>; MAX_SIZE + 1] = [const { OnceLock::new() }; MAX_SIZE + 1];

/// psq_value for every cell and square of an n×n board, indexed (cell - 1) * MAX_SQUARES + square.
pub fn psq_table(size: u8) -> &'static [i32] {
    PSQ[size as usize].get_or_init(|| {
        let t = tables(size);
        let mut v = vec![0; 2 * PIECE_COUNT * MAX_SQUARES];
        for c in 1..=(2 * PIECE_COUNT) as Cell {
            for sq in 0..t.squares as Square {
                v[(c as usize - 1) * MAX_SQUARES + sq as usize] = psq_value(t, c, sq);
            }
        }
        v
    })
}

/// Material only (the battle's points), from `color`'s point of view.
pub fn material(pos: &Position, color: Color) -> i32 {
    (0..PIECE_COUNT as PieceType)
        .map(|ty| VALUES[ty as usize] * (pos.count(color, ty) as i32 - pos.count(color ^ 1, ty) as i32))
        .sum()
}
