//! Auto Chess² engine core: rules (move generation), search and evaluation.
//!
//! Pure and deterministic: no I/O, no clocks, no floats in anything that decides a move, so the
//! native CLI and the WASM build play identical battles from the same position and seed.

/// Bumped whenever anything that decides a move changes. Folded into the game's RULES_VERSION
/// fingerprint (src/game/version.ts) once the engine plays battles.
pub const ENGINE_VERSION: u32 = 1;
