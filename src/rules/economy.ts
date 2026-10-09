import type { Winner } from './battle';
import {
  makePiece,
  MAX_ARMY,
  type Piece,
  type PieceType,
  PIECE_NAME,
  PIECE_TYPES,
  PIECE_VALUE,
  PIECES,
} from './pieces';
import { type Rng, weightedPick } from './rng';

export const START_ARMY: PieceType[] = ['K', 'P', 'P', 'P'];
export const START_GOLD = 3;
export const BASE_INCOME = 5;
export const WIN_BONUS = 2;
export const DRAW_BONUS = 1;
export const PAWN_COST = PIECE_VALUE.P;

/** Which pieces each type can be upgraded into with gold. Fairy pieces come from the shop or fusion instead. */
export const UPGRADES: Record<PieceType, PieceType[]> = {
  ...(Object.fromEntries(PIECE_TYPES.map((t) => [t, []])) as unknown as Record<PieceType, PieceType[]>),
  P: ['N', 'B'],
  N: ['R'],
  B: ['R'],
  R: ['Q'],
};

/** The player's persistent army and purse between rounds. */
export interface Shop {
  gold: number;
  pieces: Piece[];
  /** Pieces for sale this round (bought ones are removed). Missing = none. */
  offers?: PieceType[];
}

export type ShopResult = { ok: true; shop: Shop } | { ok: false; error: string };

export function startingShop(army: PieceType[] = START_ARMY): Shop {
  return { gold: START_GOLD, pieces: army.map((t) => makePiece(t)) };
}

/** An upgrade costs the difference in value, so gold spent always equals army points. */
export function upgradeCost(from: PieceType, to: PieceType): number {
  return PIECE_VALUE[to] - PIECE_VALUE[from];
}

/** Value − 1; fused pieces lose 1 per part, so fusing then selling pays the same as selling both parts. */
export function sellValue(type: PieceType): number {
  if (type === 'K') return 0;
  return Math.max(0, PIECE_VALUE[type] - (PIECES[type].group === 'fusion' ? 2 : 1));
}

export function roundIncome(winner: Winner): number {
  return BASE_INCOME + (winner === 'w' ? WIN_BONUS : winner === 'draw' ? DRAW_BONUS : 0);
}

/** Buys a pawn onto the bench. */
export function buyPawn(shop: Shop): ShopResult {
  if (shop.pieces.length >= MAX_ARMY) return { ok: false, error: `Army is full (${MAX_ARMY} pieces)` };
  if (shop.gold < PAWN_COST) return { ok: false, error: 'Not enough gold' };
  return { ok: true, shop: { ...shop, gold: shop.gold - PAWN_COST, pieces: [...shop.pieces, makePiece('P')] } };
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
  return { ok: true, shop: { ...shop, gold: shop.gold - cost, pieces } };
}

export function sellPiece(shop: Shop, pieceId: string): ShopResult {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return { ok: false, error: 'No such piece' };
  if (piece.type === 'K') return { ok: false, error: "The king can't be sold" };
  return {
    ok: true,
    shop: { ...shop, gold: shop.gold + sellValue(piece.type), pieces: shop.pieces.filter((p) => p.id !== pieceId) },
  };
}

// ---- shop offers ----

/** Pieces offered each round. */
export const OFFER_COUNT = 4;
export const REROLL_COST = 1;

/**
 * What the shop can offer, with how often each shows up. Fusion pieces are never offered (they
 * come only from fusing); the king never is either.
 */
export const OFFER_WEIGHTS: Partial<Record<PieceType, number>> = {
  P: 3,
  E: 3,
  N: 2,
  B: 2,
  F: 2,
  W: 2,
  M: 1.5,
  L: 1.5,
  G: 1.5,
  X: 1.5,
  R: 1.5,
  Q: 0.75,
};

/** The most an offer can cost in `round`: cheap pieces first, a Rook from round 2, a Queen from round 4. */
export function maxOfferCost(round: number): number {
  return 2 + 2 * round;
}

/** A fresh set of offers for `round`. Prices are the pieces' values. */
export function rollOffers(round: number, rng: Rng): PieceType[] {
  const pool = (Object.keys(OFFER_WEIGHTS) as PieceType[]).filter((t) => PIECE_VALUE[t] <= maxOfferCost(round));
  return Array.from({ length: OFFER_COUNT }, () => weightedPick(pool, (t) => OFFER_WEIGHTS[t] ?? 0, rng));
}

/** Buys offer number `index` onto the bench for its value in gold. */
export function buyOffer(shop: Shop, index: number): ShopResult {
  const type = shop.offers?.[index];
  if (!type) return { ok: false, error: 'That offer is gone' };
  if (shop.pieces.length >= MAX_ARMY) return { ok: false, error: `Army is full (${MAX_ARMY} pieces)` };
  const price = PIECE_VALUE[type];
  if (shop.gold < price) return { ok: false, error: 'Not enough gold' };
  return {
    ok: true,
    shop: {
      ...shop,
      gold: shop.gold - price,
      pieces: [...shop.pieces, makePiece(type)],
      offers: shop.offers?.filter((_, i) => i !== index),
    },
  };
}

/** Pays REROLL_COST for a fresh set of offers. */
export function rerollOffers(shop: Shop, round: number, rng: Rng): ShopResult {
  if (shop.gold < REROLL_COST) return { ok: false, error: 'Not enough gold' };
  return { ok: true, shop: { ...shop, gold: shop.gold - REROLL_COST, offers: rollOffers(round, rng) } };
}

// ---- fusion ----

/** Two pieces that fuse into a compound, free of charge. The king never fuses. */
export interface FusionRecipe {
  parts: [PieceType, PieceType];
  result: PieceType;
}

export const FUSIONS: FusionRecipe[] = [
  { parts: ['N', 'B'], result: 'A' }, // Archbishop
  { parts: ['N', 'R'], result: 'C' }, // Chancellor
  { parts: ['N', 'Q'], result: 'Z' }, // Amazon
  { parts: ['N', 'M'], result: 'T' }, // Centaur (the Man stands in for the king)
];

/** What `a` and `b` fuse into, or null. Order doesn't matter. */
export function fusionResult(a: PieceType, b: PieceType): PieceType | null {
  return (
    FUSIONS.find((f) => (f.parts[0] === a && f.parts[1] === b) || (f.parts[0] === b && f.parts[1] === a))?.result ??
    null
  );
}

/** Fusions the piece `pieceId` can make with another piece in the army: one entry per partner type. */
export function fusionOptions(shop: Shop, pieceId: string): { partnerId: string; result: PieceType }[] {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return [];
  const seen = new Set<PieceType>();
  const out: { partnerId: string; result: PieceType }[] = [];
  // Prefer partners on the bench, so fusing doesn't empty a board square the player arranged.
  const partners = [...shop.pieces].sort((x, y) => Number(x.square !== null) - Number(y.square !== null));
  for (const other of partners) {
    if (other.id === pieceId || seen.has(other.type)) continue;
    const result = fusionResult(piece.type, other.type);
    if (!result) continue;
    seen.add(other.type);
    out.push({ partnerId: other.id, result });
  }
  return out;
}

/** Fuses `pieceId` with `partnerId`: the result takes `pieceId`'s place (square and id); the partner is used up. */
export function fusePieces(shop: Shop, pieceId: string, partnerId: string): ShopResult {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  const partner = shop.pieces.find((p) => p.id === partnerId);
  if (!piece || !partner || piece.id === partner.id) return { ok: false, error: 'No such piece' };
  const result = fusionResult(piece.type, partner.type);
  if (!result) {
    return { ok: false, error: `${PIECE_NAME[piece.type]} and ${PIECE_NAME[partner.type]} don't fuse` };
  }
  return {
    ok: true,
    shop: {
      ...shop,
      pieces: shop.pieces.filter((p) => p.id !== partnerId).map((p) => (p.id === pieceId ? { ...p, type: result } : p)),
    },
  };
}
