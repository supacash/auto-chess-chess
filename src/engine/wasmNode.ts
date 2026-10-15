import { readFileSync } from 'node:fs';
import { initSync } from './wasm/acc';

let loaded = false;

/** Node-side loader for the game's own engine (tests, simulator): reads the WASM next to its bindings. */
export function loadEngineForNode(): void {
  if (loaded) return;
  initSync({ module: readFileSync(new URL('./wasm/acc_bg.wasm', import.meta.url)) });
  loaded = true;
}
