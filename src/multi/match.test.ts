import { describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { armyErrors } from '../rules/placement';
import {
  alive,
  applyRound,
  botArmy,
  lossDamage,
  matchIncome,
  nextStreak,
  nextStreaks,
  streakBonus,
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
    expect(shopSeconds({ blitz: true })).toBe(20);
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
    const owner = copy.copy === 'b' ? copy.black : copy.white;
    expect(alive(three).map((p) => p.id)).toContain(owner);
    // Every player still in fights exactly once (the copy's owner fights in their own battle).
    for (const id of ['a', 'b', 'c']) expect(pairingOf(pairs, id)).not.toBeNull();
    expect(pairingOf(pairs, 'd')).toBeNull();
  });

  it('never repeats last round’s opponent while another pairing exists', () => {
    const draw = (pairs: ReturnType<typeof pairRound>) =>
      pairs.map((pairing) => ({ pairing, winner: 'draw' as const, material: { w: 0, b: 0 } }));
    const opponents = (pairs: ReturnType<typeof pairRound>) =>
      new Map(pairs.flatMap((p) => [[p.white, p.black] as const, [p.black, p.white] as const]));
    for (const start of [four(), out(four(), 'd')]) {
      for (let seed = 0; seed < 30; seed++) {
        let players = start;
        let before = new Map<string, string>();
        for (let round = 1; round <= 8; round++) {
          const pairs = pairRound(players, seed, round);
          const now = opponents(pairs.filter((p) => !p.copy));
          for (const [id, other] of now) expect(before.get(id)).not.toBe(other);
          before = now;
          players = applyRound(players, round, draw(pairs));
        }
      }
    }
  });

  it('remembers who each player fought (the copy’s owner keeps their own opponent)', () => {
    const three = out(four(), 'd');
    const pairs = pairRound(three, 9, 3);
    const after = applyRound(
      three,
      3,
      pairs.map((pairing) => ({ pairing, winner: 'draw', material: { w: 0, b: 0 } })),
    );
    const real = pairs.find((p) => !p.copy)!;
    expect(after.find((p) => p.id === real.white)!.lastOpponent).toBe(real.black);
    expect(after.find((p) => p.id === real.black)!.lastOpponent).toBe(real.white);
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
    const copySide = pairs[i].copy!;
    const owner = copySide === 'b' ? pairs[i].black : pairs[i].white;
    const odd = copySide === 'b' ? pairs[i].white : pairs[i].black;
    const oddWins = copySide === 'b' ? 'w' : 'b';
    const copyWins = copySide;
    const next = applyRound(three, 3, [result(pairs, i, oddWins, 30, 30)]);
    expect(next.find((p) => p.id === owner)!.hp).toBe(START_HP);
    // ...but the odd player out takes damage when the copy wins.
    const lost = applyRound(three, 3, [result(pairs, i, copyWins, 30, 30)]);
    expect(lost.find((p) => p.id === odd)!.hp).toBe(START_HP - 9);
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
      { white: 'a', black: 'b', copy: null, seed: 1 },
      { white: 'd', black: 'c', copy: null, seed: 2 },
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

describe('streaks', () => {
  it('count wins up and losses down, with draws leaving them alone', () => {
    expect(nextStreak(0, 'w')).toBe(1);
    expect(nextStreak(2, 'w')).toBe(3);
    expect(nextStreak(2, 'b')).toBe(-1);
    expect(nextStreak(-2, 'b')).toBe(-3);
    expect(nextStreak(-2, 'draw')).toBe(-2);
  });

  it('pay a capped bonus for win and loss streaks alike', () => {
    expect([1, 2, 3, 4, 7].map(streakBonus)).toEqual([0, 1, 2, 3, 3]);
    expect([-1, -2, -3, -4, -7].map(streakBonus)).toEqual([0, 1, 2, 3, 3]);
  });

  it('make income: base 5, +1 for a win, streak bonus on top; a draw pays 6 with no streak bonus', () => {
    expect(matchIncome('w', 1)).toBe(6);
    expect(matchIncome('w', 3)).toBe(8);
    expect(matchIncome('b', -1)).toBe(5);
    expect(matchIncome('b', -4)).toBe(8);
    expect(matchIncome('draw', 5)).toBe(6);
  });

  it('update every player from a round, but not the owner of a copied army', () => {
    const pairs = [
      { white: 'a', black: 'b', copy: null, seed: 1 },
      { white: 'c', black: 'a', copy: 'b' as const, seed: 2 },
    ];
    const next = nextStreaks(new Map([['a', 2]]), [
      { pairing: pairs[0], winner: 'w', material: { w: 0, b: 0 } },
      { pairing: pairs[1], winner: 'b', material: { w: 0, b: 0 } },
    ]);
    expect(Object.fromEntries(next)).toEqual({ a: 3, b: -1, c: -1 });
  });
});

describe('sides', () => {
  it('put each player on White and Black across rounds, odd player out included', () => {
    const three = out(four(), 'd');
    const sides = new Map<string, Set<string>>();
    for (let round = 1; round <= 30; round++) {
      for (const p of pairRound(three, 4, round)) {
        if (p.copy !== 'w') sides.set(p.white, new Set([...(sides.get(p.white) ?? []), 'w']));
        if (p.copy !== 'b') sides.set(p.black, new Set([...(sides.get(p.black) ?? []), 'b']));
      }
    }
    for (const id of ['a', 'b', 'c']) expect(sides.get(id)).toEqual(new Set(['w', 'b']));
  });
});
