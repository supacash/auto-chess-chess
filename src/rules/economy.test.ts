import { describe, expect, it } from 'vitest';
import {
  buyPawn,
  roundIncome,
  sellPiece,
  sellValue,
  type Shop,
  type ShopResult,
  startingShop,
  upgradeCost,
  upgradePiece,
} from './economy';
import { makePiece, MAX_ARMY, type PieceType, PIECE_VALUE } from './pieces';

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

describe('buyPawn', () => {
  it('costs 1 gold and adds a benched pawn', () => {
    const shop = ok(buyPawn(startingShop()));
    expect(shop.gold).toBe(2);
    expect(shop.pieces).toHaveLength(5);
    expect(shop.pieces[4]).toMatchObject({ type: 'P', square: null });
  });

  it('fails without gold or when the army is full', () => {
    expect(buyPawn({ gold: 0, pieces: [] })).toMatchObject({ ok: false, error: 'Not enough gold' });
    const full = { gold: 10, pieces: Array.from({ length: MAX_ARMY }, () => makePiece('P')) };
    expect(buyPawn(full).ok).toBe(false);
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
    expect(upgradePiece({ gold: 3, pieces: [rook] }, rook.id, 'Q')).toMatchObject({ ok: false, error: 'Not enough gold' });
  });

  it('keeps gold spent equal to army points', () => {
    let shop = startingShop();
    const start = shop.gold + points(shop);
    shop = ok(buyPawn(shop));
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
    const shop: Shop = { gold: 100, pieces: 'KPPPPPPPPBBB'.split('').map((t) => makePiece(t as PieceType)) };
    expect(buyPawn(shop).ok).toBe(true);
    expect(upgradePiece(shop, shop.pieces[1].id, 'B').ok).toBe(true);
  });
});
