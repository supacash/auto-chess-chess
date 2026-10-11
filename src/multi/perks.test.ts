import { describe, expect, it } from 'vitest';
import { applyRound, matchPicksOf, newPlayers, type Pairing, roundDamage, START_HP } from './match';
import {
  botPicks,
  MATCH_PERKS,
  MEND_HP,
  PERK_CHOICES,
  PERK_ROUNDS,
  perkChoices,
  perkedDamage,
  perksUpTo,
} from './perks';

const pairing: Pairing = { white: 'a', black: 'b', copy: null, seed: 1 };

describe('match perks', () => {
  it('offers three different perks, the same for everyone, and no second copy of a one-off perk', () => {
    const choices = perkChoices(7, 3, 'a', []);
    expect(choices).toHaveLength(PERK_CHOICES);
    expect(new Set(choices).size).toBe(PERK_CHOICES);
    expect(perkChoices(7, 3, 'a', [])).toEqual(choices);
    const oneOffs = MATCH_PERKS.filter((p) => !p.stackable).map((p) => p.id);
    for (let seed = 0; seed < 30; seed++) {
      expect(perkChoices(seed, 8, 'a', oneOffs).some((p) => oneOffs.includes(p))).toBe(false);
    }
  });

  it('counts picks up to a round, and bots pick at every perk round', () => {
    expect(perksUpTo({ 3: 'edge', 8: 'tithe' }, 7)).toEqual(['edge']);
    expect(perksUpTo({ 3: 'edge', 8: 'tithe' }, 8)).toEqual(['edge', 'tithe']);
    expect(Object.keys(botPicks(5, 'bot1', 99)).map(Number)).toEqual(PERK_ROUNDS);
    expect(botPicks(5, 'bot1', 2)).toEqual({});
  });

  it('adds Sharp edge to the winner and takes Bulwark off the loser, never below 1', () => {
    expect(perkedDamage(5, ['edge'], [])).toBe(7);
    expect(perkedDamage(5, [], ['bulwark', 'bulwark'])).toBe(1);
    expect(perkedDamage(5, ['edge'], ['bulwark'])).toBe(5);
  });

  it('applies perks to a round: damage, a copy lends no Sharp edge, and Second wind heals', () => {
    const players = newPlayers([
      { id: 'a', name: 'A', bot: false },
      { id: 'b', name: 'B', bot: false },
    ]);
    const people = { a: { 3: 'edge' as const }, b: { 3: 'mend' as const } };
    const picksOf = matchPicksOf(players, 1, 3, people);
    const result = { pairing, winner: 'w' as const, material: { w: 10, b: 0 } };
    // Round 3 base damage: 3 + 10/5 = 5, +2 for A's Sharp edge.
    expect(roundDamage(3, [result], picksOf).get('b')).toBe(7);
    expect(roundDamage(3, [{ ...result, pairing: { ...pairing, copy: 'w' } }], picksOf).get('b')).toBe(5);
    const after = applyRound(players, 3, [result], picksOf);
    expect(after.find((p) => p.id === 'b')!.hp).toBe(Math.min(START_HP, START_HP - 7 + MEND_HP));
    // Second wind heals only in the round it's picked.
    const later = applyRound(after, 4, [result], matchPicksOf(after, 1, 4, people));
    expect(later.find((p) => p.id === 'b')!.hp).toBe(after.find((p) => p.id === 'b')!.hp - 8);
  });
});
