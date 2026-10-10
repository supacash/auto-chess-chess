import { describe, expect, it } from 'vitest';
import { aiBudget } from './aiArmy';
import { DEFAULT_SETTINGS, difficulty, isDifficultyId } from './difficulty';
import { seededRng } from './rng';

describe('difficulty', () => {
  it('scales the AI budget by 5.5, 6 or 6.75 points per round (rounded)', () => {
    for (const [id, per] of [
      ['easy', 5.5],
      ['normal', 6],
      ['hard', 6.75],
    ] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const b = aiBudget(5, seededRng(seed), difficulty(id).perRound);
        expect(b).toBeGreaterThanOrEqual(Math.round(5 * per) - 1);
        expect(b).toBeLessThanOrEqual(Math.round(5 * per) + 1);
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
