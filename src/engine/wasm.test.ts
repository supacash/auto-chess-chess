import { describe, expect, it } from 'vitest';
import { engineVersion } from './wasm/acc';
import { loadEngineForNode } from './wasmNode';

describe('engine WASM', () => {
  it('loads in Node and reports its version', () => {
    loadEngineForNode();
    expect(engineVersion()).toBeGreaterThanOrEqual(1);
  });
});
