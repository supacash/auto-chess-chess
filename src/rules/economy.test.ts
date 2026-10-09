import { describe, expect, it } from 'vitest';
import {
  buyOffer,
  fusePawns,
  fusePawnSet,
  pawnFusionOptions,
  fusePieces,
  fusionOptions,
  fusionResult,
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
  it('follows the upgrade path and keeps the square', () => {
    const pawn = makePiece('P', { file: 3, rank: 1 });
    let shop: Shop = { gold: 20, pieces: [pawn] };
    shop = ok(upgradePiece(shop, pawn.id, 'N'));
    shop = ok(upgradePiece(shop, pawn.id, 'R'));
    shop = ok(upgradePiece(shop, pawn.id, 'Q'));
    expect(shop.pieces[0]).toMatchObject({ id: pawn.id, type: 'Q', square: { file: 3, rank: 1 } });
    expect(shop.gold).toBe(20 - 8);
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
    const rook = makePiece('R');
    expect(upgradePiece({ gold: 3, pieces: [rook] }, rook.id, 'Q')).toMatchObject({
      ok: false,
      error: 'Not enough gold',
    });
  });

  it('keeps gold spent equal to army points', () => {
    let shop = startingShop();
    const start = shop.gold + points(shop);
    shop = ok(buyOffer({ ...shop, offers: ['P'] }, 0));
    shop = ok(upgradePiece(shop, shop.pieces[1].id, 'B'));
    expect(shop.gold + points(shop)).toBe(start);
    expect(upgradeCost('B', 'R')).toBe(2);
    expect(upgradeCost('R', 'Q')).toBe(4);
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
        for (const t of offers) {
          expect(PIECE_VALUE[t]).toBeLessThanOrEqual(maxOfferCost(round));
          expect(t).not.toBe('K');
          expect(PIECES[t].group).not.toBe('fusion');
        }
      }
    }
    expect(Object.keys(OFFER_WEIGHTS)).not.toContain('K');
  });

  it('offers only standard pieces with fairy pieces off', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 100; i++) {
      for (const t of rollOffers(6, rng, false)) expect(PIECES[t].group).toBe('standard');
    }
  });

  it('holds back rooks until round 2 and queens until round 4', () => {
    const rng = seededRng(1);
    const seen = (round: number) => new Set(Array.from({ length: 200 }, () => rollOffers(round, rng)).flat());
    expect(seen(1).has('R')).toBe(false);
    expect(seen(2).has('R')).toBe(true);
    expect(seen(3).has('Q')).toBe(false);
    expect(seen(4).has('Q')).toBe(true);
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

describe('fusion', () => {
  it('knows the recipes in either order', () => {
    expect(fusionResult('N', 'B')).toBe('A');
    expect(fusionResult('R', 'N')).toBe('C');
    expect(fusionResult('N', 'Q')).toBe('Z');
    expect(fusionResult('M', 'N')).toBe('T');
    expect(fusionResult('N', 'N')).toBeNull();
    expect(fusionResult('K', 'N')).toBeNull();
    // Fusing then selling pays the same as selling both parts.
    expect(sellValue('C')).toBe(sellValue('N') + sellValue('R'));
  });

  it('is free, keeps the chosen piece in place and uses up the partner', () => {
    const knight = makePiece('N', { file: 2, rank: 0 });
    const rook = makePiece('R', { file: 0, rank: 0 });
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), knight, rook] };
    const next = ok(fusePieces(shop, knight.id, rook.id));
    expect(next.gold).toBe(0);
    expect(next.pieces).toHaveLength(2);
    expect(next.pieces.find((p) => p.id === knight.id)).toEqual({ ...knight, type: 'C' });
    expect(fusePieces(shop, knight.id, knight.id).ok).toBe(false);
    expect(fusePieces(shop, rook.id, shop.pieces[0].id).ok).toBe(false);
  });

  it('lists one option per partner type, preferring benched partners', () => {
    const knight = makePiece('N', { file: 1, rank: 0 });
    const placedBishop = makePiece('B', { file: 2, rank: 0 });
    const benchBishop = makePiece('B');
    const rook = makePiece('R');
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), knight, placedBishop, benchBishop, rook, makePiece('P')] };
    expect(fusionOptions(shop, knight.id)).toEqual([
      { partnerId: benchBishop.id, result: 'A' },
      { partnerId: rook.id, result: 'C' },
    ]);
    expect(fusionOptions(shop, rook.id)).toEqual([{ partnerId: knight.id, result: 'C' }]);
    expect(fusionOptions(shop, shop.pieces[0].id)).toEqual([]);
  });
});

describe('pawn fusion', () => {
  it('needs three pawns (Berolina pawns count) and offers the Man only with fairy pieces on', () => {
    const a = makePiece('P', { file: 1, rank: 1 });
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), a, makePiece('E')] };
    expect(pawnFusionOptions(shop, a.id, true)).toEqual([]);
    const three = { ...shop, pieces: [...shop.pieces, makePiece('P')] };
    expect(pawnFusionOptions(three, a.id, true)).toEqual(['N', 'B', 'M']);
    expect(pawnFusionOptions(three, a.id, false)).toEqual(['N', 'B']);
    expect(pawnFusionOptions(three, three.pieces[0].id, true)).toEqual([]);
  });

  it('is free, keeps points, puts the result on the chosen pawn and uses its own kind, benched first', () => {
    const chosen = makePiece('P', { file: 2, rank: 1 });
    const placed = makePiece('P', { file: 3, rank: 1 });
    const bench1 = makePiece('E');
    const bench2 = makePiece('P');
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), chosen, placed, bench1, bench2] };
    const next = ok(fusePawns(shop, chosen.id, 'B', false));
    expect(next.gold).toBe(0);
    // The Berolina pawn is kept: plain pawns go first (the benched one, then the placed one).
    expect(next.pieces.map((p) => p.id)).toEqual([shop.pieces[0].id, chosen.id, bench1.id]);
    expect(next.pieces[1]).toEqual({ ...chosen, type: 'B' });
    expect(points(next)).toBe(points(shop));
  });

  it('fuses exactly the picked pawns, onto the first picked one on the board', () => {
    const benched = makePiece('E');
    const placed = makePiece('E', { file: 1, rank: 1 });
    const plain = makePiece('P');
    const spare = makePiece('P');
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), benched, placed, plain, spare] };
    const next = ok(fusePawnSet(shop, [benched.id, placed.id, plain.id], 'N', true));
    expect(next.pieces.map((p) => p.id)).toEqual([shop.pieces[0].id, placed.id, spare.id]);
    expect(next.pieces[1]).toEqual({ ...placed, type: 'N' });
    expect(fusePawnSet(shop, [benched.id, placed.id], 'N', true).ok).toBe(false);
    expect(fusePawnSet(shop, [benched.id, benched.id, plain.id], 'N', true).ok).toBe(false);
    expect(fusePawnSet(shop, [benched.id, plain.id, shop.pieces[0].id], 'N', true).ok).toBe(false);
  });

  it('fuses a Ferz and a Wazir into a Man', () => {
    expect(fusionResult('F', 'W')).toBe('M');
    expect(fusionResult('W', 'F')).toBe('M');
  });

  it('rejects other results, the Man without fairy pieces, and too few pawns', () => {
    const pawns = [makePiece('P'), makePiece('P'), makePiece('P')];
    const shop: Shop = { gold: 0, pieces: [makePiece('K'), ...pawns] };
    expect(fusePawns(shop, pawns[0].id, 'R', true).ok).toBe(false);
    expect(fusePawns(shop, pawns[0].id, 'M', false).ok).toBe(false);
    expect(fusePawns({ ...shop, pieces: shop.pieces.slice(0, 3) }, pawns[0].id, 'N', true).ok).toBe(false);
  });
});
