//! Auto Chess² engine core: rules (move generation), search and evaluation.
//!
//! Pure and deterministic: no I/O, no clocks, no floats in anything that decides a move, so the
//! native CLI and the WASM build play identical battles from the same position and seed.

pub mod betza;
pub mod pieces;
pub mod position;
pub mod tables;

/// Bumped whenever anything that decides a move changes. Folded into the game's RULES_VERSION
/// fingerprint (src/game/version.ts) once the engine plays battles.
pub const ENGINE_VERSION: u32 = 1;

/// Parses a Fairy-Stockfish variant name as the game uses them: `accN` (an N×N board) or `accNk2`
/// (its two-kings rules). Returns (size, two_kings).
pub fn parse_variant(variant: &str) -> Option<(u8, bool)> {
    let rest = variant.strip_prefix("acc")?;
    let (size, two_kings) = match rest.strip_suffix("k2") {
        Some(s) => (s, true),
        None => (rest, false),
    };
    let size: u8 = size.parse().ok()?;
    (5..=9).contains(&size).then_some((size, two_kings))
}
