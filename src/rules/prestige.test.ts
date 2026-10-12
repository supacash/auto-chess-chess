import { describe, expect, it } from 'vitest';
import { QUEEN_OFFER_ROUND, START_GOLD } from './economy';
import { MAX_HEIRS } from './placement';
import { extraIncome, maxHeirs, PERKS, perkChoices, queenOfferRound, startGold } from './prestige';
import { seededRng } from './rng';
import { applyResult, maxLives, newRun, START_LIVES } from './run';

describe('prestige perks', () => {
  it('offers three different perks, never a non-stackable one already kept', () => {
    for (let seed = 0; seed < 20; seed++) {
      const choices = perkChoices(['life', 'income'], seededRng(seed));
      expect(choices).toHaveLength(3);
      expect(new Set(choices.map((p) => p.id)).size).toBe(3);
      expect(choices.map((p) => p.id)).not.toContain('life');
      expect(choices.map((p) => p.id)).not.toContain('income');
    }
    // Stackable perks stay on offer forever.
    const all = PERKS.filter((p) => !p.stackable).map((p) => p.id);
    expect(perkChoices(all, seededRng(1)).every((p) => p.stackable)).toBe(true);
  });

  it('carries perks into a new run: gold, knights, lives, queen offers and income', () => {
    const run = newRun(undefined, seededRng(1), { prestige: 2, perks: ['gold', 'gold', 'knight', 'life', 'income'] });
    expect(run.prestige).toBe(2);
    expect(run.shop.gold).toBe(START_GOLD + 4 + 1); // + the Growing board's extra gold
    expect(startGold(run.perks)).toBe(START_GOLD + 4);
    expect(run.shop.pieces.filter((p) => p.type === 'N')).toHaveLength(1);
    expect(run.lives).toBe(START_LIVES + 1);
    expect(maxLives(run.perks)).toBe(START_LIVES + 1);
    expect(queenOfferRound(run.perks)).toBe(QUEEN_OFFER_ROUND);
    expect(queenOfferRound(['queenPawns'])).toBe(4);
    expect(extraIncome(run.perks)).toBe(1);
    const after = applyResult(run, 'b');
    expect(after.shop.gold - run.shop.gold).toBe(5 + 1); // base income + Tithe
  });

  it('offers Dynasty (a second Heir) only in fairy runs', () => {
    expect(maxHeirs([])).toBe(MAX_HEIRS);
    expect(maxHeirs(['dynasty'])).toBe(MAX_HEIRS + 1);
    for (let seed = 0; seed < 30; seed++) {
      expect(perkChoices([], seededRng(seed), 3, false).map((p) => p.id)).not.toContain('dynasty');
    }
    // Always among the first prestige's choices in a fairy run; random after that.
    for (let seed = 0; seed < 30; seed++) {
      const first = perkChoices([], seededRng(seed)).map((p) => p.id);
      expect(first).toHaveLength(3);
      expect(first).toContain('dynasty');
    }
    const later = Array.from({ length: 30 }, (_, seed) => perkChoices(['gold'], seededRng(seed)).map((p) => p.id));
    expect(later.some((c) => !c.includes('dynasty'))).toBe(true);
  });

  it('starts a first run with no prestige and no perks', () => {
    const run = newRun();
    expect(run.prestige).toBe(0);
    expect(run.perks).toEqual([]);
    expect(run.lives).toBe(START_LIVES);
  });
});
