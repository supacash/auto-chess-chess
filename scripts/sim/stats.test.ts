import { describe, expect, it } from 'vitest';
import { formatMargin, meanMargin, proportionMargin } from './stats';

describe('proportionMargin', () => {
  it('is about ±10 points at 100 games and ±3.5 at 750', () => {
    expect(proportionMargin(50, 100)).toBeCloseTo(9.8, 1);
    expect(proportionMargin(250, 750)).toBeCloseTo(3.37, 1);
  });

  it('does not claim certainty from 0% or 100%', () => {
    expect(proportionMargin(0, 20)).toBeCloseTo(proportionMargin(10, 20));
    expect(proportionMargin(20, 20)).toBeCloseTo(proportionMargin(10, 20));
  });

  it('formats as a whole-point label', () => {
    expect(formatMargin(30, 100)).toBe('±9');
    expect(formatMargin(0, 0)).toBe('-');
  });
});

describe('meanMargin', () => {
  it('shrinks with the square root of the sample size', () => {
    const small = [0, 2, 4, 6, 8];
    const large = Array.from({ length: 20 }, (_, i) => small[i % 5]);
    expect(meanMargin(large)).toBeLessThan(meanMargin(small) / 1.9);
    expect(meanMargin([3, 3, 3])).toBe(0);
    expect(meanMargin([1])).toBeNaN();
  });
});
