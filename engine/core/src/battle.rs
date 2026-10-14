//! How a battle ends, as src/rules/battle.ts decides it: checkmate; insufficient material (on points);
//! stalemate, the 50-move rule or threefold repetition (drawn); the move limit (on points).

use crate::eval::material;
use crate::position::{Color, Position, WHITE};

/// A finished battle's winner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Winner {
    Side(Color),
    Draw,
}

impl Winner {
    /// White's score: 1, ½ or 0.
    pub fn white_score(self) -> f32 {
        match self {
            Winner::Side(c) if c == WHITE => 1.0,
            Winner::Side(_) => 0.0,
            Winner::Draw => 0.5,
        }
    }
}

/// The side ahead on the battle's points (the pieces' values), or a draw when level.
pub fn on_points(pos: &Position) -> Winner {
    match material(pos, WHITE).signum() {
        1 => Winner::Side(WHITE),
        -1 => Winner::Side(WHITE ^ 1),
        _ => Winner::Draw,
    }
}

/// The result if the battle is over, `plies` plies after its start; `limit` is its move limit.
pub fn result(pos: &mut Position, plies: usize, limit: Option<usize>) -> Option<Winner> {
    if pos.legal_moves().is_empty() {
        return Some(if pos.in_check() { Winner::Side(pos.side() ^ 1) } else { Winner::Draw });
    }
    if pos.insufficient_material() {
        return Some(on_points(pos));
    }
    if pos.halfmove() >= 100 || pos.is_threefold() {
        return Some(Winner::Draw);
    }
    if limit.is_some_and(|l| plies >= l) {
        return Some(on_points(pos));
    }
    None
}
