import { describe, expect, it } from 'vitest';
import { aiBudget, rampFactor } from './aiArmy';
import { DEFAULT_SETTINGS, difficulty, isDifficultyId } from './difficulty';
import { seededRng } from './rng';

describe('difficulty', () => {
  it('scales the AI budget by 5.5, 6 or 6.5 points per round (rounded, times the ramp)', () => {
    for (const [id, per] of [
      ['easy', 5.5],
      ['normal', 6],
      ['hard', 6.5],
    ] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const b = aiBudget(6, seededRng(seed), difficulty(id).perRound);
        const mid = Math.round(6 * per * rampFactor(6));
        expect(b).toBeGreaterThanOrEqual(mid - 1);
        expect(b).toBeLessThanOrEqual(mid + 1);
      }
    }
  });

  it('defaults to the growing board on normal without reveal', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      mode: 'growing',
      difficulty: 'normal',
      reveal: false,
      side: 'white',
      fairy: true,
    });
    expect(difficulty(DEFAULT_SETTINGS.difficulty).perRound).toBe(6);
  });

  it('recognises valid ids only', () => {
    expect(isDifficultyId('hard')).toBe(true);
    expect(isDifficultyId('insane')).toBe(false);
    expect(isDifficultyId(undefined)).toBe(false);
  });
});
