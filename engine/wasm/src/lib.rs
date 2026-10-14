//! WebAssembly bindings for the engine. Single-threaded on purpose: no SharedArrayBuffer, so the
//! page needs no cross-origin isolation.

use wasm_bindgen::prelude::*;

/// The engine's version (acc_core::ENGINE_VERSION).
#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> u32 {
    acc_core::ENGINE_VERSION
}
