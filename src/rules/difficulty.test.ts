import { describe, expect, it } from 'vitest';
import { aiBudget } from './aiArmy';
import { DEFAULT_SETTINGS, difficulty, isDifficultyId } from './difficulty';
import { seededRng } from './rng';

describe('difficulty', () => {
  it('scales the AI budget by 5, 6 or 7 points per round', () => {
    for (const [id, per] of [
      ['easy', 5],
      ['normal', 6],
      ['hard', 7],
    ] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const b = aiBudget(4, seededRng(seed), difficulty(id).perRound);
        expect(b).toBeGreaterThanOrEqual(4 * per - 1);
        expect(b).toBeLessThanOrEqual(4 * per + 1);
      }
    }
  });

  it('defaults to the growing board on normal without reveal', () => {
    expect(DEFAULT_SETTINGS).toEqual({ mode: 'growing', difficulty: 'normal', reveal: false, side: 'white' });
    expect(difficulty(DEFAULT_SETTINGS.difficulty).perRound).toBe(6);
  });

  it('recognises valid ids only', () => {
    expect(isDifficultyId('hard')).toBe(true);
    expect(isDifficultyId('insane')).toBe(false);
    expect(isDifficultyId(undefined)).toBe(false);
  });
});
