import { describe, expect, it } from 'vitest';
import { AI_STYLES, type AiStyle, aiBudget, draftAiArmy, MAX_PAWNS, pickStyle, placeAiArmy } from './aiArmy';
import { fitsEngine } from './composition';
import { MAX_ARMY, type PieceType, PIECE_VALUE } from './pieces';
import { armyErrors } from './placement';
import { seededRng } from './rng';

const style = (id: string): AiStyle => AI_STYLES.find((s) => s.id === id)!;
const points = (types: PieceType[]) => types.reduce((s, t) => s + PIECE_VALUE[t], 0);
const count = (types: PieceType[], t: PieceType) => types.filter((x) => x === t).length;

describe('aiBudget', () => {
  it('is 6×round within ±1', () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = aiBudget(3, seededRng(seed));
      expect(b).toBeGreaterThanOrEqual(17);
      expect(b).toBeLessThanOrEqual(19);
    }
  });

  it('is one point smaller in round 1', () => {
    const budgets = new Set(Array.from({ length: 40 }, (_, seed) => aiBudget(1, seededRng(seed))));
    expect(budgets).toEqual(new Set([4, 5, 6]));
    expect(aiBudget(1, seededRng(0), 7)).toBeGreaterThanOrEqual(5);
  });
});

describe('pickStyle', () => {
  it('eventually picks every style', () => {
    const rng = seededRng(5);
    const seen = new Set(Array.from({ length: 100 }, () => pickStyle(rng).id));
    expect(seen.size).toBe(AI_STYLES.length);
  });
});

describe('draftAiArmy', () => {
  it('has one king and respects budget, army cap and pawn cap for every style', () => {
    for (const s of AI_STYLES) {
      for (const budget of [3, 6, 12, 25, 60, 100]) {
        for (let seed = 0; seed < 10; seed++) {
          const types = draftAiArmy(budget, s, seededRng(seed));
          expect(count(types, 'K')).toBe(1);
          expect(points(types)).toBeLessThanOrEqual(budget);
          expect(types.length).toBeLessThanOrEqual(MAX_ARMY);
          expect(count(types, 'P')).toBeLessThanOrEqual(MAX_PAWNS);
          expect(fitsEngine(types)).toBe(true);
        }
      }
    }
  });

  it('spends the whole budget at typical sizes', () => {
    for (const s of AI_STYLES) {
      for (let seed = 0; seed < 10; seed++) {
        expect(points(draftAiArmy(14, s, seededRng(seed)))).toBe(14);
      }
    }
  });

  it('gives each style its character', () => {
    const avg = (id: string, t: PieceType) => {
      let total = 0;
      for (let seed = 0; seed < 40; seed++) total += count(draftAiArmy(20, style(id), seededRng(seed)), t);
      return total / 40;
    };
    expect(avg('fortress', 'P')).toBeGreaterThan(avg('heavy', 'P'));
    expect(avg('heavy', 'Q') + avg('heavy', 'R')).toBeGreaterThan(avg('cavalry', 'Q') + avg('cavalry', 'R'));
    expect(avg('cavalry', 'N') + avg('cavalry', 'B')).toBeGreaterThan(avg('heavy', 'N') + avg('heavy', 'B'));
  });
});

describe('placeAiArmy', () => {
  it('produces a legal, fully placed army for every style', () => {
    for (const s of AI_STYLES) {
      for (let seed = 0; seed < 20; seed++) {
        const rng = seededRng(seed);
        const types = draftAiArmy(30, s, rng);
        const pieces = placeAiArmy(types, s, rng);
        expect(armyErrors(pieces)).toEqual([]);
        expect(pieces).toHaveLength(types.length);
      }
    }
  });

  it('puts the king on a preferred file, possibly flipped', () => {
    const s = style('fortress');
    const allowed = new Set(s.kingFiles.flatMap((f) => [f, 7 - f]));
    for (let seed = 0; seed < 20; seed++) {
      const king = placeAiArmy(['K', 'P', 'P', 'R'], s, seededRng(seed)).find((p) => p.type === 'K')!;
      expect(king.square!.rank).toBe(s.kingRank);
      expect(allowed.has(king.square!.file)).toBe(true);
    }
  });

  it('shields a fortress king with pawns', () => {
    for (let seed = 0; seed < 20; seed++) {
      const pieces = placeAiArmy(['K', 'P', 'P', 'P'], style('fortress'), seededRng(seed));
      const king = pieces.find((p) => p.type === 'K')!.square!;
      for (const p of pieces.filter((x) => x.type === 'P')) {
        expect(p.square!.rank).toBe(king.rank + 1);
        expect(Math.abs(p.square!.file - king.file)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('avoids doubled pawns when there is room', () => {
    for (const s of AI_STYLES) {
      for (let seed = 0; seed < 20; seed++) {
        const pawns = placeAiArmy(['K', 'P', 'P', 'P', 'P', 'P', 'P'], s, seededRng(seed)).filter((p) => p.type === 'P');
        expect(new Set(pawns.map((p) => p.square!.file)).size).toBe(pawns.length);
      }
    }
  });

  it('keeps rooks on the back row and pushes cavalry forward', () => {
    const rookRanks = placeAiArmy(['K', 'R', 'R'], style('balanced'), seededRng(1)).filter((p) => p.type === 'R');
    expect(rookRanks.every((p) => p.square!.rank === 0)).toBe(true);
    const knights = placeAiArmy(['K', 'N', 'N'], style('cavalry'), seededRng(1)).filter((p) => p.type === 'N');
    expect(knights.every((p) => p.square!.rank >= 1)).toBe(true);
  });
});
