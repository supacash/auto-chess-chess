import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'ffish-es6';
import { variantsIni } from './boardSpec';
import { rulesLoaded, setRules } from './rules';

/** Node-side ffish loader for tests and the simulator: reads the WASM from node_modules. */
export async function loadRulesForNode(): Promise<void> {
  if (rulesLoaded()) return;
  const require = createRequire(import.meta.url);
  const wasmBinary = readFileSync(require.resolve('ffish-es6/ffish.wasm'));
  const ffish = await Module({ wasmBinary } as Parameters<typeof Module>[0]);
  ffish.loadVariantConfig(variantsIni());
  setRules(ffish);
}
