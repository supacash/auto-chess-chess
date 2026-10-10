import { beforeAll, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import {
  AI_STYLES,
  type AiStyle,
  aiBudget,
  budgetForSide,
  draftAiArmy,
  MAX_PAWNS,
  pickStyle,
  placeAiArmy,
  maxArmyValue,
  placeForBattle,
} from './aiArmy';
import { BOARDS, homeSquares, pawnSquares } from '../chess/boardSpec';
import { PIECES, type PieceType, PIECE_VALUE } from './pieces';
import { armyCap, armyErrors } from './placement';
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
  it('eventually picks every style, fairy-only ones only with fairy pieces on', () => {
    const rng = seededRng(5);
    const standard = new Set(Array.from({ length: 100 }, () => pickStyle(rng).id));
    expect(standard).toEqual(new Set(AI_STYLES.filter((s) => !s.fairyOnly).map((s) => s.id)));
    const fairy = new Set(Array.from({ length: 100 }, () => pickStyle(rng, true).id));
    expect(fairy.size).toBe(AI_STYLES.length);
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
          expect(types.length).toBeLessThanOrEqual(armyCap());
          expect(count(types, 'P')).toBeLessThanOrEqual(MAX_PAWNS);
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

describe('budget caps and sides', () => {
  it('drafts no more than a full board can hold', () => {
    const spec = BOARDS[8];
    const types = draftAiArmy(1000, style('heavy'), seededRng(1), spec);
    expect(points(types)).toBeLessThanOrEqual(maxArmyValue(spec));
    expect(maxArmyValue(spec)).toBe((armyCap(spec) - 1) * PIECE_VALUE.Q);
  });

  it('gives a player moving second a smaller opponent', () => {
    expect(budgetForSide(30, true)).toBe(30);
    expect(budgetForSide(30, false)).toBe(29);
    expect(budgetForSide(60, false)).toBe(58);
    expect(budgetForSide(30, false, 0.1)).toBe(27);
  });

  it('keeps pawn-heavy styles’ pawns as budgets grow', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(count(draftAiArmy(40, style('fortress'), seededRng(seed)), 'P')).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('small boards', () => {
  it('drafts armies that fit every board and still spend the budget', () => {
    for (const spec of BOARDS) {
      for (const s of AI_STYLES) {
        for (let seed = 0; seed < 10; seed++) {
          const budget = 6 * spec.files; // generous for the board
          const types = draftAiArmy(budget, s, seededRng(seed), spec);
          expect(types.length).toBeLessThanOrEqual(homeSquares(spec));
          expect(count(types, 'P')).toBeLessThanOrEqual(pawnSquares(spec));
          expect(points(types)).toBeLessThanOrEqual(budget);
          expect(points(types)).toBeGreaterThanOrEqual(budget - 3);
        }
      }
    }
  });

  it('places every drafted piece legally on every board', () => {
    for (const spec of BOARDS) {
      for (const s of AI_STYLES) {
        for (let seed = 0; seed < 20; seed++) {
          const rng = seededRng(seed);
          const types = draftAiArmy(5 * spec.files, s, rng, spec);
          const pieces = placeAiArmy(types, s, rng, spec);
          expect(armyErrors(pieces, spec)).toEqual([]);
          expect(pieces).toHaveLength(types.length);
        }
      }
    }
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
        const pawns = placeAiArmy(['K', 'P', 'P', 'P', 'P', 'P', 'P'], s, seededRng(seed)).filter(
          (p) => p.type === 'P',
        );
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

describe('fairy pieces', () => {
  const draftMany = (fairy: boolean) => {
    const rng = seededRng(11);
    const armies: PieceType[][] = [];
    for (const style of AI_STYLES) {
      for (const spec of BOARDS) {
        for (const budget of [5, 10, 20, 35, 50]) {
          for (let i = 0; i < 5; i++) armies.push(draftAiArmy(budget, style, rng, spec, fairy));
        }
      }
    }
    return armies;
  };

  it('are never drafted with the setting off', () => {
    for (const army of draftMany(false)) {
      for (const t of army) expect(PIECES[t].group).toBe('standard');
    }
  });

  it('are drafted with it on: utility, chaos, fusion pieces and Berolina pawns all show up', () => {
    const groups = new Set(
      draftMany(true)
        .flat()
        .map((t) => PIECES[t].group),
    );
    expect(groups).toEqual(new Set(['standard', 'pawn', 'utility', 'chaos', 'fusion']));
  });

  it('keep armies within budget and legally placeable on every board', () => {
    const rng = seededRng(3);
    for (const style of AI_STYLES) {
      for (const spec of BOARDS) {
        for (const budget of [4, 12, 30, 60]) {
          const types = draftAiArmy(budget, style, rng, spec, true);
          expect(types.filter((t) => t === 'K')).toHaveLength(1);
          expect(types.reduce((s, t) => s + PIECE_VALUE[t], 0)).toBeLessThanOrEqual(budget);
          expect(types.length).toBeLessThanOrEqual(homeSquares(spec));
          const placed = placeAiArmy(types, style, rng, spec);
          expect(placed).toHaveLength(types.length);
          expect(armyErrors(placed, spec)).toEqual([]);
        }
      }
    }
  });

  it('spend nearly the whole budget', () => {
    const rng = seededRng(8);
    for (const style of AI_STYLES) {
      for (const budget of [10, 20, 30]) {
        const types = draftAiArmy(budget, style, rng, BOARDS[BOARDS.length - 1], true);
        expect(types.reduce((s, t) => s + PIECE_VALUE[t], 0)).toBeGreaterThanOrEqual(budget - 1);
      }
    }
  });
});

describe('placeForBattle', () => {
  beforeAll(loadRulesForNode);

  it('always finds a start where not both kings are in check, even with heavy armies', () => {
    const spec = BOARDS[8];
    const heavy: PieceType[] = ['K', 'Q', 'Q', 'R', 'R', 'R', 'R', 'B', 'B', 'N'];
    for (let seed = 0; seed < 100; seed++) {
      const rng = seededRng(seed);
      const player = placeAiArmy(heavy, pickStyle(rng), rng, spec);
      const { ai, start } = placeForBattle(player, heavy, pickStyle(rng), rng, spec, seed % 2 === 0);
      expect(start.ok).toBe(true);
      expect(ai.filter((p) => p.type === 'K')).toHaveLength(1);
      expect(ai.length).toBeLessThanOrEqual(heavy.length);
    }
  });
});
