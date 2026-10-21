import { beforeAll, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import {
  AI_HEIR_ROUND,
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
  RAMP,
  rampFactor,
  SYNERGY_ALLOWANCE,
  SYNERGY_ALLOWANCE_ROUND,
  synergyAllowance,
} from './aiArmy';
import { BOARDS, homeSquares, pawnSquares } from '../chess/boardSpec';
import { PIECES, type PieceType, PIECE_VALUE } from './pieces';
import { armyCap, armyErrors } from './placement';
import { seededRng } from './rng';
import { familyStatus, synergyUpgrades } from './synergy';

const style = (id: string): AiStyle => AI_STYLES.find((s) => s.id === id)!;
const points = (types: PieceType[]) => types.reduce((s, t) => s + PIECE_VALUE[t], 0);
const count = (types: PieceType[], t: PieceType) => types.filter((x) => x === t).length;

describe('aiBudget', () => {
  it('is 6×round × the ramp, within ±1', () => {
    for (const round of [3, 6, 9]) {
      const mid = Math.round(6 * round * rampFactor(round));
      for (let seed = 0; seed < 20; seed++) {
        const b = aiBudget(round, seededRng(seed));
        expect(b).toBeGreaterThanOrEqual(mid - 1);
        expect(b).toBeLessThanOrEqual(mid + 1);
      }
    }
  });

  it('ramps: smaller in the early rounds, bigger later', () => {
    const mid = (round: number) => aiBudget(round, () => 0.5); // randomInt(…, 3) = 1: no jitter
    expect(mid(3)).toBe(Math.round(18 * rampFactor(3)));
    expect(mid(10)).toBe(Math.round(60 * rampFactor(10)));
    expect(rampFactor(18)).toBe(1.07);
    expect(mid(25)).toBe(Math.round(150 * RAMP.at(-1)!));
    expect(rampFactor(3)).toBeLessThan(1);
    expect(rampFactor(8)).toBeGreaterThan(1);
    expect(rampFactor(30)).toBe(RAMP.at(-1));
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
    expect(budgetForSide(60, false)).toBe(59);
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

describe('the Stackman in AI armies', () => {
  it('is drafted at most once per army (shop rarity limits the player instead)', () => {
    const rng = seededRng(5);
    const fortress = AI_STYLES.find((s) => s.id === 'fortress')!;
    for (let i = 0; i < 300; i++) {
      const types = draftAiArmy(60 + (i % 70), fortress, rng, BOARDS.at(-2), true);
      expect(types.filter((t) => t === 'Y').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('Heirs in AI armies', () => {
  const heirs = (round: number, fairy: boolean) => {
    const rng = seededRng(11);
    let withHeir = 0;
    for (let i = 0; i < 400; i++) {
      const style = pickStyle(rng, fairy);
      const spec = BOARDS[BOARDS.length - 2]; // 8×8
      const types = draftAiArmy(110, style, rng, spec, fairy, round);
      if (types.includes('J')) {
        withHeir++;
        expect(types.filter((t) => t === 'J')).toHaveLength(1);
        // Always placed (it goes right after the King), never on the front row.
        const placed = placeAiArmy(types, style, rng, spec);
        expect(placed.filter((p) => p.type === 'J')).toHaveLength(1);
        expect(armyErrors(placed, spec)).toEqual([]);
      }
    }
    return withHeir / 400;
  };

  it('appear rarely from AI_HEIR_ROUND in fairy runs, and never before or without fairy pieces', () => {
    expect(heirs(AI_HEIR_ROUND - 1, true)).toBe(0);
    expect(heirs(AI_HEIR_ROUND + 3, false)).toBe(0);
    const share = heirs(AI_HEIR_ROUND, true);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.2);
  });
});

describe('AI armies with synergies', () => {
  const spec8 = BOARDS[3]; // 8×8
  const draft = (id: string, budget: number, seed: number, synergies: boolean, spec = spec8, round = 9) => {
    const rng = seededRng(seed);
    const s = style(id);
    const types = draftAiArmy(budget, s, rng, spec, true, round, synergies);
    return { types, placed: placeAiArmy(types, s, rng, spec) };
  };
  const active = (types: PieceType[], id: string) => familyStatus(types).some((f) => f.family.id === id && f.tier > 0);
  const upgrades = (placed: ReturnType<typeof placeAiArmy>, id?: string) =>
    synergyUpgrades(placed, spec8).filter((u) => !id || u.family === id).length;

  it('changes nothing without them, or without fairy pieces', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const s of AI_STYLES) {
        const before = draftAiArmy(40, s, seededRng(seed), spec8, true, 12);
        expect(draftAiArmy(40, s, seededRng(seed), spec8, true, 12, false)).toEqual(before);
        expect(draftAiArmy(40, s, seededRng(seed), spec8, false, 12, true)).toEqual(
          draftAiArmy(40, s, seededRng(seed), spec8, false, 12),
        );
      }
    }
  });

  it('leans toward the style’s family and keeps a piece in it for its synergy to upgrade', () => {
    for (const [id, fam] of [
      ['cavalry', 'cavalry'],
      ['heavy', 'siege'],
      ['fortress', 'guard'],
    ] as const) {
      let withThem = 0;
      let without = 0;
      for (let seed = 0; seed < 40; seed++) {
        const built = draft(id, 50, seed, true);
        withThem += upgrades(built.placed, fam);
        without += upgrades(draft(id, 50, seed, false).placed, fam);
        // An active family always has a piece left to upgrade: none were all fused into compounds.
        if (active(built.types, fam)) expect(upgrades(built.placed, fam), `${id} seed ${seed}`).toBeGreaterThan(0);
      }
      expect(withThem, id).toBeGreaterThan(without);
    }
  });

  it('keeps a Fortress’s eight pawns while its budget allows, then upgrades them', () => {
    let small = 0;
    let large = 0;
    for (let seed = 0; seed < 40; seed++) {
      if (active(draft('fortress', 30, seed, true).types, 'infantry')) small++;
      const { types } = draft('fortress', 60, seed, true);
      if (active(types, 'infantry')) large++;
      expect(points(types)).toBeGreaterThanOrEqual(57);
      // Eight pawns don't fit before the 8×8 board.
      expect(active(draft('fortress', 30, seed, true, BOARDS[2]).types, 'infantry')).toBe(false);
    }
    expect(small).toBeGreaterThanOrEqual(36);
    expect(large).toBeLessThanOrEqual(12);
  });

  it(`gets ${SYNERGY_ALLOWANCE} more points from round ${SYNERGY_ALLOWANCE_ROUND}, up to a full board`, () => {
    expect(synergyAllowance(SYNERGY_ALLOWANCE_ROUND - 1)).toBe(0);
    expect(synergyAllowance(SYNERGY_ALLOWANCE_ROUND)).toBe(SYNERGY_ALLOWANCE);
    for (let seed = 0; seed < 20; seed++) {
      const before = points(draft('cavalry', 50, seed, true, spec8, SYNERGY_ALLOWANCE_ROUND - 1).types);
      const after = points(draft('cavalry', 50, seed, true, spec8, SYNERGY_ALLOWANCE_ROUND).types);
      expect(before).toBeLessThanOrEqual(50);
      expect(after).toBeGreaterThan(50);
      expect(after).toBeLessThanOrEqual(50 + SYNERGY_ALLOWANCE);
      expect(points(draft('heavy', 200, seed, true, spec8, 20).types)).toBeLessThanOrEqual(maxArmyValue(spec8));
    }
  });

  it('keeps armies within budget, caps and legal placement, and spends the budget, on every board', () => {
    // Budgets as high as a run reaches on each board (Growing to 7×7, Classic on 8×8, Growing on 9×9).
    const highest: Record<number, number> = { 5: 15, 6: 28, 7: 45, 8: 135, 9: 153 };
    for (const s of AI_STYLES) {
      for (const spec of BOARDS) {
        let short = 0;
        let drafts = 0;
        for (const budget of [5, 12, 20, 28, 35, 45, 60, 80, 100, 120, 135, 153].filter(
          (b) => b <= highest[spec.files],
        )) {
          for (let seed = 0; seed < 6; seed++) {
            const rng = seededRng(seed);
            const types = draftAiArmy(budget, s, rng, spec, true, 9, true);
            expect(count(types, 'K')).toBe(1);
            expect(points(types)).toBeLessThanOrEqual(budget);
            expect(types.length).toBeLessThanOrEqual(armyCap(spec));
            expect(types.filter((t) => PIECES[t].pawn).length).toBeLessThanOrEqual(
              Math.min(MAX_PAWNS, pawnSquares(spec)),
            );
            const placed = placeAiArmy(types, s, rng, spec);
            expect(placed).toHaveLength(types.length);
            expect(armyErrors(placed, spec)).toEqual([]);
            // Points left unspent, beyond what the drafter leaves without synergies.
            short += points(draftAiArmy(budget, s, seededRng(seed), spec, true, 9)) - points(types);
            drafts++;
          }
        }
        expect(short / drafts, `${s.id} on ${spec.files}×${spec.files}`).toBeLessThanOrEqual(3);
      }
    }
  });
});
