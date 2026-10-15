import { loadEngineForNode } from '../engine/wasmNode';
import { rulesLoaded, setRulesLoaded } from './rules';

/** Node-side rules loader for tests and the simulator: reads the engine's WASM from disk. */
export async function loadRulesForNode(): Promise<void> {
  if (rulesLoaded()) return;
  loadEngineForNode();
  setRulesLoaded();
}
