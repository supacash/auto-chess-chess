import { describe, expect, it } from 'vitest';
import {
  AFFINITY_PRICE,
  buyOffer,
  fuseDefaultSet,
  fuseSet,
  fusePieces,
  isAffinityOffer,
  offerPrice,
  fusionOptions,
  fusionResults,
  QUEEN_OFFER_ROUND,
  setMergePartners,
  setMergeResults,
  maxOfferCost,
  OFFER_COUNT,
  OFFER_WEIGHTS,
  REROLL_COST,
  rerollOffers,
  rollOffers,
  roundIncome,
  sellPiece,
  sellValue,
  type Shop,
  type ShopResult,
  startingShop,
  upgradeCost,
  upgradePiece,
} from './economy';
import { makePiece, PIECES, type PieceType, PIECE_VALUE } from './pieces';
import { BENCH_SIZE } from './placement';
import { seededRng } from './rng';

const ok = (r: ShopResult): Shop => {
  if (!r.ok) throw new Error(r.error);
  return r.shop;
};
const points = (shop: Shop) => shop.pieces.reduce((s, p) => s + PIECE_VALUE[p.type], 0);

describe('startingShop', () => {
  it('starts with King + 3 pawns and 3 gold', () => {
    const shop = startingShop();
    expect(shop.gold).toBe(3);
    expect(shop.pieces.map((p) => p.type)).toEqual(['K', 'P', 'P', 'P']);
  });
});

describe('upgradePiece', () => {
  it('turns a pawn into a minor piece in place, and nothing into a rook or queen', () => {
    const pawn = makePiece('P', { file: 3, rank: 1 });
    let shop: Shop = { gold: 20, pieces: [pawn] };
    shop = ok(upgradePiece(shop, pawn.id, 'N'));
    expect(shop.pieces[0]).toMatchObject({ id: pawn.id, type: 'N', square: { file: 3, rank: 1 } });
    expect(shop.gold).toBe(20 - 3);
    expect(upgradePiece(shop, pawn.id, 'R').ok).toBe(false);
    const rook = makePiece('R');
    expect(upgradePiece({ gold: 20, pieces: [rook] }, rook.id, 'Q').ok).toBe(false);
  });

  it('rejects skipped steps, maxed pieces and the king', () => {
    const pawn = makePiece('P');
    const queen = makePiece('Q');
    const king = makePiece('K');
    const shop = { gold: 50, pieces: [pawn, queen, king] };
    expect(upgradePiece(shop, pawn.id, 'Q').ok).toBe(false);
    expect(upgradePiece(shop, queen.id, 'K').ok).toBe(false);
    expect(upgradePiece(shop, king.id, 'Q').ok).toBe(false);
  });

  it('rejects upgrades the player cannot afford', () => {
    const pawn = makePiece('P');
    expect(upgradePiece({ gold: 2, pieces: [pawn] }, pawn.id, 'B')).toMatchObject({
      ok: false,
      error: 'Not enough gold',
    });
  });

  it('charges more than the value added (merging is the main way up)', () => {
    const shop: Shop = { gold: 5, pieces: [makePiece('K'), makePiece('P')] };
    const next = ok(upgradePiece(shop, shop.pieces[1].id, 'B'));
    expect(next.gold + points(next)).toBe(shop.gold + points(shop) - 1);
    expect(upgradeCost('P', 'N')).toBe(3);
    expect(upgradeCost('P', 'B')).toBe(3);
  });
});

describe('sellPiece', () => {
  it('refunds value minus 1 and removes the piece', () => {
    const rook = makePiece('R', { file: 0, rank: 0 });
    const shop = ok(sellPiece({ gold: 0, pieces: [rook] }, rook.id));
    expect(shop).toEqual({ gold: 4, pieces: [] });
    expect(sellValue('P')).toBe(0);
  });

  it('never sells the king', () => {
    const king = makePiece('K');
    expect(sellPiece({ gold: 0, pieces: [king] }, king.id).ok).toBe(false);
  });
});

describe('roundIncome', () => {
  it('pays 5 plus a win or draw bonus', () => {
    expect(roundIncome('w')).toBe(7);
    expect(roundIncome('draw')).toBe(6);
    expect(roundIncome('b')).toBe(5);
  });
});

describe('no piece-count limit', () => {
  it('lets an army have more than 8 pawns plus extra pieces (Fairy-Stockfish accepts them)', () => {
    // King, 9 pawns and 3 bishops on the board (13 of 16), bench empty.
    const at = (t: PieceType, file: number, rank: number) => makePiece(t, { file, rank });
    const shop: Shop = {
      gold: 100,
      pieces: [
        at('K', 4, 0),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((f) => at('P', f, 1)),
        at('P', 0, 2),
        at('B', 1, 0),
        at('B', 2, 0),
        at('B', 3, 0),
      ],
    };
    expect(buyOffer({ ...shop, offers: ['P'] }, 0).ok).toBe(true);
    expect(upgradePiece(shop, shop.pieces[1].id, 'B').ok).toBe(true);
  });
});

describe('shop offers', () => {
  it('rolls OFFER_COUNT affordable-tier pieces, never kings or fusion pieces', () => {
    const rng = seededRng(7);
    for (let round = 1; round <= 8; round++) {
      for (let i = 0; i < 30; i++) {
        const offers = rollOffers(round, rng);
        expect(offers).toHaveLength(OFFER_COUNT);
        for (const o of offers) {
          expect(offerPrice(o)).toBeLessThanOrEqual(maxOfferCost(round));
          expect(o).not.toBe('K');
          if (!isAffinityOffer(o)) expect(PIECES[o].group).not.toBe('fusion');
        }
      }
    }
    expect(Object.keys(OFFER_WEIGHTS)).not.toContain('K');
  });

  it('offers queens only from QUEEN_OFFER_ROUND, and never grasshoppers', () => {
    const rng = seededRng(3);
    for (let round = 1; round <= 10; round++) {
      for (let i = 0; i < 60; i++) {
        const offers = rollOffers(round, rng);
        if (round < QUEEN_OFFER_ROUND) {
          expect(offers).not.toContain('Q');
          expect(offers).not.toContain('PQ');
        }
        expect(offers).not.toContain('G');
      }
    }
  });

  it('offers cannons with fairy pieces on', () => {
    const rng = seededRng(9);
    const offers = Array.from({ length: 300 }, () => rollOffers(4, rng, true)).flat();
    expect(offers).toContain('X');
  });

  it('offers only standard pieces with fairy pieces off', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 100; i++) {
      for (const o of rollOffers(6, rng, false)) if (!isAffinityOffer(o)) expect(PIECES[o].group).toBe('standard');
    }
  });

  it('mostly offers affinity pawns: finished pieces are rare', () => {
    const rng = seededRng(5);
    const offers = Array.from({ length: 500 }, () => rollOffers(8, rng, false)).flat();
    const affinity = offers.filter(isAffinityOffer).length;
    expect(affinity / offers.length).toBeGreaterThan(0.75);
    expect(offers.filter((o) => o === 'R' || o === 'Q').length / offers.length).toBeLessThan(0.1);
  });

  it('sells affinity pawns at their price: rook-pawns 2 gold, queen-pawns 3', () => {
    expect(AFFINITY_PRICE).toEqual({ N: 1, B: 1, R: 2, Q: 3 });
    const shop: Shop = { gold: 5, pieces: [makePiece('K')], offers: ['PR', 'PQ'] };
    const next = ok(buyOffer(shop, 0));
    expect(next.gold).toBe(3);
    expect(next.pieces.at(-1)).toMatchObject({ type: 'P', affinity: 'R', square: null });
    expect(sellValue(next.pieces.at(-1)!)).toBe(1);
    expect(sellValue(makePiece('P', null, 'Q'))).toBe(2);
  });

  it('holds back rooks until round 2 and queens until round 6', () => {
    const rng = seededRng(1);
    const seen = (round: number) => new Set(Array.from({ length: 200 }, () => rollOffers(round, rng)).flat());
    expect(seen(1).has('R')).toBe(false);
    expect(seen(2).has('R')).toBe(true);
    expect(seen(5).has('Q')).toBe(false);
    expect(seen(5).has('PQ')).toBe(false);
    expect(seen(6).has('PQ')).toBe(true);
  });

  it('buys an offer onto the bench for its value and removes it from the shop', () => {
    const shop: Shop = { gold: PIECE_VALUE.X + 1, pieces: [makePiece('K')], offers: ['X', 'M', 'E'] };
    const next = ok(buyOffer(shop, 0));
    expect(next.gold).toBe(1);
    expect(next.offers).toEqual(['M', 'E']);
    expect(next.pieces.at(-1)).toMatchObject({ type: 'X', square: null });
    expect(buyOffer(next, 0)).toEqual({ ok: false, error: 'Not enough gold' });
    expect(buyOffer(next, 5).ok).toBe(false);
  });

  it('refuses offers when the bench is full, however many pieces are on the board', () => {
    const shop: Shop = { gold: 99, pieces: Array.from({ length: BENCH_SIZE }, () => makePiece('P')), offers: ['F'] };
    expect(buyOffer(shop, 0).ok).toBe(false);
  });

  it('rerolls for REROLL_COST gold', () => {
    const shop: Shop = { gold: REROLL_COST, pieces: [makePiece('K')], offers: [] };
    const next = ok(rerollOffers(shop, 3, seededRng(2)));
    expect(next.gold).toBe(0);
    expect(next.offers).toHaveLength(OFFER_COUNT);
    expect(rerollOffers(next, 3, seededRng(2)).ok).toBe(false);
  });
});

describe('two-piece merges and fusion', () => {
  it('knows the recipes in either order', () => {
    expect(fusionResults('R', 'R', false)).toEqual(['Q']);
    expect(fusionResults('N', 'B', false)).toEqual([]); // no mixing knights and bishops any more
    expect(fusionResults('N', 'N', false)).toEqual([]);
    expect(fusionResults('N', 'B', true)).toEqual(['A']);
    expect(fusionResults('R', 'N', true)).toEqual(['C']);
    expect(fusionResults('R', 'N', false)).toEqual([]);
    expect(fusionResults('N', 'Q', true)).toEqual(['Z']);
    expect(fusionResults('M', 'N', true)).toEqual(['T']);
    expect(fusionResults('Q', 'Q', true)).toEqual([]);
    expect(fusionResults('K', 'N', true)).toEqual([]);
    // Fusing then selling pays the same as selling both parts.
    expect(sellValue('C')).toBe(sellValue('N') + sellValue('R'));
  });

  it('is free, keeps the chosen piece in place and uses up the partner', () => {
    const knight = makePiece('N', { file: 2, rank: 0 });
    const rook = makePiece('R', { file: 0, rank: 0 });
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), knight, rook] };
    const next = ok(fusePieces(shop, knight.id, rook.id, 'C', true));
    expect(next.gold).toBe(0);
    expect(next.pieces).toHaveLength(2);
    expect(next.pieces.find((p) => p.id === knight.id)).toEqual({ ...knight, type: 'C' });
    expect(fusePieces(shop, knight.id, rook.id, 'C', false).ok).toBe(false); // a fairy fusion
    expect(fusePieces(shop, knight.id, rook.id, 'Q', true).ok).toBe(false);
    expect(fusePieces(shop, knight.id, knight.id, 'R', true).ok).toBe(false);
    expect(fusePieces(shop, rook.id, shop.pieces[0].id, 'C', true).ok).toBe(false);
  });

  it('merges two rooks into a queen in any mode', () => {
    const a = makePiece('R', { file: 0, rank: 0 });
    const b = makePiece('R');
    const queen = ok(fusePieces({ gold: 0, pieces: [makePiece('K'), a, b] }, a.id, b.id, 'Q', false));
    expect(queen.pieces.map((p) => p.type)).toEqual(['K', 'Q']);
    expect(queen.pieces[1].square).toEqual({ file: 0, rank: 0 });
  });

  it('lists one option per partner type, preferring benched partners, and never affinity pawns', () => {
    const knight = makePiece('N', { file: 1, rank: 0 });
    const placedBishop = makePiece('B', { file: 2, rank: 0 });
    const benchBishop = makePiece('B');
    const rook = makePiece('R');
    const rookPawn = makePiece('P', null, 'R');
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), knight, placedBishop, benchBishop, rook, rookPawn] };
    expect(fusionOptions(shop, knight.id, true)).toEqual([
      { partnerId: benchBishop.id, result: 'A' },
      { partnerId: rook.id, result: 'C' },
    ]);
    expect(fusionOptions(shop, knight.id, false)).toEqual([]);
    expect(fusionOptions(shop, rookPawn.id, true)).toEqual([]);
    expect(fusionOptions(shop, shop.pieces[0].id, true)).toEqual([]);
  });

  it('fuses a Ferz and a Wazir into a Man', () => {
    expect(fusionResults('F', 'W', true)).toEqual(['M']);
    expect(fusionResults('W', 'F', true)).toEqual(['M']);
    expect(fusionResults('F', 'W', false)).toEqual([]);
  });
});

describe('three-piece merges', () => {
  it('merges three pawns with the same affinity into that piece, keeping the first placed one’s square', () => {
    const benched = makePiece('P', null, 'R');
    const placed = makePiece('P', { file: 1, rank: 1 }, 'R');
    const third = makePiece('P', null, 'R');
    const other = makePiece('P', null, 'N');
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), benched, placed, third, other] };
    const next = ok(fuseSet(shop, [benched.id, placed.id, third.id], 'R'));
    expect(next.gold).toBe(0);
    expect(next.pieces).toEqual([shop.pieces[0], { id: placed.id, type: 'R', square: { file: 1, rank: 1 } }, other]);
    expect(fuseSet(shop, [benched.id, placed.id, other.id], 'R').ok).toBe(false); // mixed affinities
    expect(fuseSet(shop, [benched.id, placed.id, third.id], 'Q').ok).toBe(false);
    expect(fuseSet(shop, [benched.id, placed.id], 'R').ok).toBe(false);
    expect(fuseSet(shop, [benched.id, benched.id, third.id], 'R').ok).toBe(false);
  });

  it('merges three knights or three bishops into a queen, three plain pawns into a minor piece, but not a mix', () => {
    const plain = (t: PieceType) => ({ type: t });
    expect(setMergeResults([plain('N'), plain('N'), plain('N')])).toEqual(['Q']);
    expect(setMergeResults([plain('B'), plain('B'), plain('B')])).toEqual(['Q']);
    expect(setMergeResults([plain('N'), plain('N'), plain('B')])).toEqual([]);
    expect(setMergeResults([plain('R'), plain('R'), plain('R')])).toEqual([]);
    expect(setMergeResults([plain('P'), plain('P'), plain('P')])).toEqual(['N', 'B']); // three plain pawns
    expect(setMergeResults([plain('E'), plain('E'), plain('E')])).toEqual(['N', 'B']);
    expect(setMergeResults([plain('P'), plain('P'), plain('E')])).toEqual([]);
    expect(setMergeResults([plain('P'), plain('P'), makePiece('P', null, 'R')])).toEqual([]);
    const q = makePiece('P', null, 'Q');
    expect(setMergeResults([q, { ...q }, { ...q }])).toEqual(['Q']);
  });

  it('circles two more of the same kind by default, benched ones first', () => {
    const chosen = makePiece('P', { file: 2, rank: 1 }, 'N');
    const placed = makePiece('P', { file: 3, rank: 1 }, 'N');
    const bench = makePiece('P', null, 'N');
    const wrong = makePiece('P', null, 'B');
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), chosen, placed, wrong, bench] };
    expect(setMergePartners(shop, chosen.id)?.map((p) => p.id)).toEqual([bench.id, placed.id]);
    expect(setMergePartners({ ...shop, pieces: shop.pieces.slice(0, 4) }, chosen.id)).toBeNull();
    const next = ok(fuseDefaultSet(shop, chosen.id, 'N'));
    expect(next.pieces.map((p) => p.type)).toEqual(['K', 'N', 'P']);
    expect(next.pieces[1]).toEqual({ id: chosen.id, type: 'N', square: { file: 2, rank: 1 } });
    expect(next.pieces[2]).toEqual(wrong);
  });

  it('doesn’t gold-upgrade affinity pawns', () => {
    const pawn = makePiece('P', null, 'R');
    expect(upgradePiece({ gold: 10, pieces: [pawn] }, pawn.id, 'N').ok).toBe(false);
  });
});
