import { describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { armyErrors } from '../rules/placement';
import {
  alive,
  applyRound,
  botArmy,
  lossDamage,
  type MatchPlayer,
  matchOver,
  mixSeed,
  newPlayers,
  type PairingResult,
  pairingOf,
  pairRound,
  START_HP,
  shopSeconds,
} from './match';

const four = () =>
  newPlayers([
    { id: 'a', name: 'A', bot: false },
    { id: 'b', name: 'B', bot: true },
    { id: 'c', name: 'C', bot: true },
    { id: 'd', name: 'D', bot: true },
  ]);

const out = (players: MatchPlayer[], ...ids: string[]) =>
  players.map((p) => (ids.includes(p.id) ? { ...p, hp: 0, place: 4 } : p));

describe('match setup', () => {
  it('starts everyone at full health, not placed', () => {
    expect(four().every((p) => p.hp === START_HP && p.place === null)).toBe(true);
    expect(shopSeconds({ blitz: false })).toBe(45);
    expect(shopSeconds({ blitz: true })).toBe(15);
  });
});

describe('pairRound', () => {
  it('pairs everyone once, the same way for the same seed and round', () => {
    const pairs = pairRound(four(), 42, 1);
    expect(pairs).toHaveLength(2);
    expect(pairs.flatMap((p) => [p.white, p.black]).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(pairs.every((p) => !p.copy)).toBe(true);
    expect(pairRound(four(), 42, 1)).toEqual(pairs);
    expect(pairs[0].seed).not.toBe(pairs[1].seed);
  });

  it('mixes pairings across rounds and seeds', () => {
    const key = (seed: number, round: number) =>
      pairRound(four(), seed, round)
        .map((p) => [p.white, p.black].sort().join(''))
        .sort()
        .join('|');
    const seen = new Set(Array.from({ length: 12 }, (_, r) => key(7, r + 1)));
    expect(seen.size).toBeGreaterThan(1);
    expect(mixSeed(1, 1)).not.toBe(mixSeed(2, 1));
  });

  it('gives the odd player out a copy of someone else’s army', () => {
    const three = out(four(), 'd');
    const pairs = pairRound(three, 9, 3);
    expect(pairs).toHaveLength(2);
    const copy = pairs.find((p) => p.copy)!;
    expect(copy.black).not.toBe(copy.white);
    expect(alive(three).map((p) => p.id)).toContain(copy.black);
    // Every player still in fights exactly once (the copy's owner fights in their own battle).
    for (const id of ['a', 'b', 'c']) expect(pairingOf(pairs, id)).not.toBeNull();
    expect(pairingOf(pairs, 'd')).toBeNull();
  });

  it('pairs nobody when one player is left', () => {
    expect(pairRound(out(four(), 'b', 'c', 'd'), 1, 5)).toEqual([]);
  });
});

describe('damage and knockouts', () => {
  const result = (pairs: ReturnType<typeof pairRound>, i: number, winner: 'w' | 'b' | 'draw', w = 10, b = 0) =>
    ({ pairing: pairs[i], winner, material: { w, b } }) satisfies PairingResult;

  it('costs the loser the round number plus 1 per 5 points the winner kept', () => {
    expect(lossDamage(1, 4)).toBe(1);
    expect(lossDamage(3, 12)).toBe(5);
    const pairs = pairRound(four(), 1, 2);
    const next = applyRound(four(), 2, [result(pairs, 0, 'w', 10), result(pairs, 1, 'draw')]);
    const hp = (id: string) => next.find((p) => p.id === id)!.hp;
    expect(hp(pairs[0].black)).toBe(START_HP - 4);
    expect(hp(pairs[0].white)).toBe(START_HP);
    expect(hp(pairs[1].white)).toBe(START_HP);
    expect(hp(pairs[1].black)).toBe(START_HP);
  });

  it('never damages the owner of a copied army', () => {
    const three = out(four(), 'd');
    const pairs = pairRound(three, 9, 3);
    const i = pairs.findIndex((p) => p.copy);
    const next = applyRound(three, 3, [result(pairs, i, 'w', 30)]);
    expect(next.find((p) => p.id === pairs[i].black)!.hp).toBe(START_HP);
    // ...but the odd player out takes damage when the copy wins.
    const lost = applyRound(three, 3, [result(pairs, i, 'b', 0, 30)]);
    expect(lost.find((p) => p.id === pairs[i].white)!.hp).toBe(START_HP - 9);
  });

  it('crowns the last player standing', () => {
    // C and D are already out; B is low and loses to A.
    const players = out(four(), 'c', 'd').map((p) => (p.id === 'b' ? { ...p, hp: 2 } : p));
    const pairs = pairRound(players, 3, 6);
    expect(pairs).toHaveLength(1);
    const aWins = pairs[0].white === 'a' ? 'w' : 'b';
    const next = applyRound(players, 6, [{ pairing: pairs[0], winner: aWins, material: { w: 10, b: 10 } }]);
    expect(matchOver(next)).toBe(true);
    expect(next.find((p) => p.id === 'a')!.place).toBe(1);
    expect(next.find((p) => p.id === 'b')!.place).toBe(2);
  });

  it('places simultaneous knockouts by remaining health', () => {
    const players = four().map((p) => ({ ...p, hp: { a: 20, b: 1, c: 3, d: 20 }[p.id]! }));
    const pairs = [
      { white: 'a', black: 'b', copy: false, whiteFirst: true, seed: 1 },
      { white: 'd', black: 'c', copy: false, whiteFirst: true, seed: 2 },
    ];
    const next = applyRound(
      players,
      5,
      pairs.map((p) => ({ pairing: p, winner: 'w' as const, material: { w: 0, b: 0 } })),
    );
    expect(next.find((p) => p.id === 'b')!.place).toBe(4); // -4 hp
    expect(next.find((p) => p.id === 'c')!.place).toBe(3); // -2 hp
    expect(alive(next).map((p) => p.id)).toEqual(['a', 'd']);
  });
});

describe('bot armies', () => {
  it('are legal, the same on every client, and different per bot and round', () => {
    const army = botArmy(5, 3, 'bot-1');
    expect(armyErrors(army, BOARD_8)).toEqual([]);
    const types = (pieces: typeof army) => pieces.map((p) => `${p.type}${p.square?.file}${p.square?.rank}`).join();
    expect(types(botArmy(5, 3, 'bot-1'))).toBe(types(army));
    expect(types(botArmy(5, 3, 'bot-2'))).not.toBe(types(army));
    expect(types(botArmy(5, 4, 'bot-1'))).not.toBe(types(army));
  });
});
