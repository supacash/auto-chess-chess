import init from '../engine/wasm/acc';
import { rulesLoaded, setRulesLoaded } from './rules';

let loading: Promise<void> | null = null;

/** Loads the rules (the game's engine as WASM) in the browser, once. Vite bundles the WASM file. */
export function loadRules(): Promise<void> {
  if (rulesLoaded()) return Promise.resolve();
  loading ??= init().then(() => setRulesLoaded());
  return loading;
}
