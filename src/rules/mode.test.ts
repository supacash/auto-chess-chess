import { describe, expect, it } from 'vitest';
import { seededRng } from './rng';
import { aiBudget } from './aiArmy';
import { gameMode, isModeId } from './mode';

describe('game modes', () => {
  it('grows the board in Growing mode and stays 8×8 in Classic', () => {
    expect([1, 3, 5, 7, 9].map((r) => gameMode('growing').board(r).files)).toEqual([5, 6, 7, 8, 8]);
    expect([1, 3, 5, 7, 9].map((r) => gameMode('classic').board(r).files)).toEqual([8, 8, 8, 8, 8]);
  });

  it('gives the Growing AI one point more every round, matching the extra pawn', () => {
    const budgets = (id: 'growing' | 'classic', round: number) => {
      const m = gameMode(id);
      return new Set(
        Array.from({ length: 30 }, (_, s) => aiBudget(round, seededRng(s), 6, m.roundOneDiscount, m.aiBonus)),
      );
    };
    expect(budgets('growing', 1)).toEqual(new Set([5, 6, 7]));
    expect(budgets('classic', 1)).toEqual(new Set([4, 5, 6]));
    const plusOne = (set: Set<number>) => new Set([...set].map((b) => b + 1));
    expect(budgets('growing', 6)).toEqual(plusOne(budgets('classic', 6)));
  });

  it('recognises mode ids', () => {
    expect(isModeId('growing')).toBe(true);
    expect(isModeId('huge')).toBe(false);
  });
});
