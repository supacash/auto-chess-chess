import type { Winner } from './battle';
import { makePiece, MAX_ARMY, type Piece, type PieceType, PIECE_NAME, PIECE_VALUE } from './pieces';

export const START_ARMY: PieceType[] = ['K', 'P', 'P', 'P'];
export const START_GOLD = 3;
export const BASE_INCOME = 5;
export const WIN_BONUS = 2;
export const DRAW_BONUS = 1;
export const PAWN_COST = PIECE_VALUE.P;

/** Which pieces each type can be upgraded into. */
export const UPGRADES: Record<PieceType, PieceType[]> = {
  P: ['N', 'B'],
  N: ['R'],
  B: ['R'],
  R: ['Q'],
  Q: [],
  K: [],
};

/** The player's persistent army and purse between rounds. */
export interface Shop {
  gold: number;
  pieces: Piece[];
}

export type ShopResult = { ok: true; shop: Shop } | { ok: false; error: string };

export function startingShop(): Shop {
  return { gold: START_GOLD, pieces: START_ARMY.map((t) => makePiece(t)) };
}

/** An upgrade costs the difference in value, so gold spent always equals army points. */
export function upgradeCost(from: PieceType, to: PieceType): number {
  return PIECE_VALUE[to] - PIECE_VALUE[from];
}

export function sellValue(type: PieceType): number {
  return type === 'K' ? 0 : Math.max(0, PIECE_VALUE[type] - 1);
}

export function roundIncome(winner: Winner): number {
  return BASE_INCOME + (winner === 'w' ? WIN_BONUS : winner === 'draw' ? DRAW_BONUS : 0);
}

/** Buys a pawn onto the bench. */
export function buyPawn(shop: Shop): ShopResult {
  if (shop.pieces.length >= MAX_ARMY) return { ok: false, error: `Army is full (${MAX_ARMY} pieces)` };
  if (shop.gold < PAWN_COST) return { ok: false, error: 'Not enough gold' };
  return { ok: true, shop: { gold: shop.gold - PAWN_COST, pieces: [...shop.pieces, makePiece('P')] } };
}

/** Upgrades a piece in place (it keeps its square and id). */
export function upgradePiece(shop: Shop, pieceId: string, to: PieceType): ShopResult {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return { ok: false, error: 'No such piece' };
  if (!UPGRADES[piece.type].includes(to)) {
    return { ok: false, error: `${PIECE_NAME[piece.type]} can't become a ${PIECE_NAME[to]}` };
  }
  const cost = upgradeCost(piece.type, to);
  if (shop.gold < cost) return { ok: false, error: 'Not enough gold' };
  const pieces = shop.pieces.map((p) => (p.id === pieceId ? { ...p, type: to } : p));
  return { ok: true, shop: { gold: shop.gold - cost, pieces } };
}

export function sellPiece(shop: Shop, pieceId: string): ShopResult {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return { ok: false, error: 'No such piece' };
  if (piece.type === 'K') return { ok: false, error: "The king can't be sold" };
  return {
    ok: true,
    shop: { gold: shop.gold + sellValue(piece.type), pieces: shop.pieces.filter((p) => p.id !== pieceId) },
  };
}
