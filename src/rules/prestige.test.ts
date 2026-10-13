import { describe, expect, it } from 'vitest';
import { interest, offerPrice, QUEEN_OFFER_ROUND, REROLL_COST, rollOffers, START_GOLD } from './economy';
import { PIECES } from './pieces';
import { MAX_HEIRS } from './placement';
import {
  BAZAAR_WEIGHTS,
  crownGold,
  DYNASTY_GOLD,
  extraIncome,
  FAVOUR_ROUND,
  freeRerolls,
  HAGGLER_REROLLS,
  interestTerms,
  maxHeirs,
  offerOdds,
  PERKS,
  perkChoices,
  perkInterest,
  prestigePerRound,
  PRESTIGE_STEP,
  queenOfferRound,
  revealsOpponent,
  SECOND_WIND_LIVES,
  startGold,
  startPieces,
  WAR_CHEST_GOLD,
} from './prestige';
import { seededRng } from './rng';
import { applyResult, battleIncome, maxLives, newRun, START_LIVES } from './run';

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

  it('carries perks into a new run: gold, pieces, lives, income', () => {
    const run = newRun(undefined, seededRng(1), { prestige: 2, perks: ['gold', 'gold', 'knight', 'life', 'income'] });
    expect(run.prestige).toBe(2);
    expect(run.shop.gold).toBe(START_GOLD + 2 * WAR_CHEST_GOLD + 1); // + the Growing board's extra gold
    expect(startGold(run.perks)).toBe(START_GOLD + 2 * WAR_CHEST_GOLD);
    expect(run.shop.pieces.filter((p) => p.type === 'N')).toHaveLength(1);
    expect(run.shop.pieces.filter((p) => p.type === 'B')).toHaveLength(1);
    expect(run.lives).toBe(START_LIVES + SECOND_WIND_LIVES);
    expect(maxLives(run.perks)).toBe(START_LIVES + SECOND_WIND_LIVES);
    expect(extraIncome(run.perks)).toBe(1);
    const after = applyResult(run, 'b');
    // Base income + Tithe, plus interest on the War chest gold.
    expect(after.shop.gold - run.shop.gold).toBe(5 + 1 + interest(run.shop.gold));
  });

  it('gives a Knight and a Bishop per Squire', () => {
    expect(startPieces([])).toEqual([]);
    expect(startPieces(['knight'])).toEqual(['N', 'B']);
    expect(startPieces(['knight', 'gold', 'knight'])).toEqual(['N', 'B', 'N', 'B']);
    // Royal favour: two of the three queen-pawns a Queen takes.
    expect(startPieces(['queenPawns'])).toEqual(['PQ', 'PQ']);
  });

  it('pays Banker interest: 1 per 5 gold saved, up to 5', () => {
    expect(interestTerms([])).toEqual({ step: 10, max: 3 });
    expect([4, 5, 14, 24, 25, 60].map((g) => perkInterest(g, ['interest']))).toEqual([0, 1, 2, 4, 5, 5]);
    expect([4, 5, 14, 24, 25, 60].map((g) => perkInterest(g, []))).toEqual([0, 0, 1, 2, 2, 3]);
    const run = newRun(undefined, seededRng(1), { prestige: 1, perks: ['interest'] });
    expect(battleIncome({ ...run, shop: { ...run.shop, gold: 25 } }, 'b')).toBe(5 + 5);
  });

  it('gives Haggler free rerolls each round', () => {
    expect(freeRerolls([])).toBe(0);
    expect(freeRerolls(['freeReroll'])).toBe(HAGGLER_REROLLS);
  });

  it('brings queens early and twice as often with Royal favour', () => {
    expect(queenOfferRound([])).toBe(QUEEN_OFFER_ROUND);
    expect(queenOfferRound(['queenPawns'])).toBe(FAVOUR_ROUND);
    const queenShare = (perks: Parameters<typeof offerOdds>[0]) => {
      const rng = seededRng(7);
      const offers = Array.from({ length: 2000 }, () => rollOffers(8, rng, true, offerOdds(perks))).flat();
      return offers.filter((o) => o === 'PQ' || o === 'Q').length / offers.length;
    };
    expect(queenShare(['queenPawns']) / queenShare([])).toBeGreaterThan(1.6);
    const early = Array.from({ length: 300 }, (_, i) =>
      rollOffers(FAVOUR_ROUND, seededRng(i), true, offerOdds(['queenPawns'])),
    );
    expect(early.flat()).toContain('PQ');
  });

  it('stocks fusion pieces with Bazaar, in fairy runs only, at what their parts cost', () => {
    const seen = (perks: Parameters<typeof offerOdds>[0], fairy: boolean) =>
      new Set(Array.from({ length: 400 }, (_, i) => rollOffers(8, seededRng(i), fairy, offerOdds(perks))).flat());
    expect(seen(['bazaar'], true)).toContain('A');
    expect(seen(['bazaar'], true)).toContain('Z');
    expect([...seen([], true)].some((o) => o in BAZAAR_WEIGHTS)).toBe(false);
    expect([...seen(['bazaar'], false)].some((o) => o in BAZAAR_WEIGHTS)).toBe(false);
    expect(offerPrice('A')).toBe(6); // a Knight and a Bishop, though it's worth 7
    expect(offerPrice('Z')).toBe(12);
    for (const type of Object.keys(BAZAAR_WEIGHTS)) expect(PIECES[type as keyof typeof PIECES].group).toBe('fusion');
  });

  it('pays Dynasty gold for each Heir crowned, and allows a second Heir', () => {
    expect(crownGold([])).toBe(0);
    expect(crownGold(['dynasty'])).toBe(DYNASTY_GOLD);
    expect(maxHeirs([])).toBe(MAX_HEIRS);
    expect(maxHeirs(['dynasty'])).toBe(MAX_HEIRS + 1);
  });

  it('offers Dynasty and Bazaar only in fairy runs, and Spyglass only without Reveal', () => {
    for (let seed = 0; seed < 30; seed++) {
      const classic = perkChoices([], seededRng(seed), 3, false).map((p) => p.id);
      expect(classic).not.toContain('dynasty');
      expect(classic).not.toContain('bazaar');
      expect(perkChoices([], seededRng(seed), 3, true, true).map((p) => p.id)).not.toContain('reveal');
    }
    expect(revealsOpponent(['reveal'])).toBe(true);
    expect(revealsOpponent([])).toBe(false);
  });

  it('always offers Dynasty at the first prestige of a fairy run; random after that', () => {
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
    expect(REROLL_COST).toBe(1);
  });

  it('raises the AI by PRESTIGE_STEP points per round for each level', () => {
    expect(prestigePerRound(5.5, 0)).toBe(5.5);
    expect(prestigePerRound(5.5, 2)).toBeCloseTo(5.5 + 2 * PRESTIGE_STEP);
  });
});
