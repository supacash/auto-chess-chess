import { describe, expect, it } from 'vitest';
import { seededRng, weightedPick } from './rng';

describe('weightedPick', () => {
  it('picks roughly in proportion to weight and never a zero-weight item', () => {
    const rng = seededRng(3);
    const counts = { a: 0, b: 0, z: 0 };
    for (let i = 0; i < 2000; i++)
      counts[weightedPick(['a', 'b', 'z'] as const, (x) => ({ a: 3, b: 1, z: 0 })[x], rng)]++;
    expect(counts.z).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.5);
    expect(counts.a / counts.b).toBeLessThan(3.5);
  });
});
