import type { Winner } from './battle';
import { BENCH_SIZE, benchCount } from './placement';
import {
  isPawnLike,
  makePiece,
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

/**
 * Which pieces each type can be upgraded into with gold: only a pawn into a minor piece. Rooks and
 * queens come from merging or the shop, never from gold alone; spare gold goes into rerolls.
 */
export const UPGRADES: Record<PieceType, PieceType[]> = {
  ...(Object.fromEntries(PIECE_TYPES.map((t) => [t, []])) as unknown as Record<PieceType, PieceType[]>),
  P: ['N', 'B'],
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

/** A gold upgrade costs 1 more than the value it adds, so merging three pawns is the better deal. */
const UPGRADE_PREMIUM: Partial<Record<PieceType, number>> = { N: 1, B: 1 };

export function upgradeCost(from: PieceType, to: PieceType): number {
  return PIECE_VALUE[to] - PIECE_VALUE[from] + (UPGRADE_PREMIUM[to] ?? 0);
}

/** Value − 1; fused pieces lose 1 per part, so fusing then selling pays the same as selling both parts. */
export function sellValue(type: PieceType): number {
  if (type === 'K') return 0;
  return Math.max(0, PIECE_VALUE[type] - (PIECES[type].group === 'fusion' ? 2 : 1));
}

export function roundIncome(winner: Winner): number {
  return BASE_INCOME + (winner === 'w' ? WIN_BONUS : winner === 'draw' ? DRAW_BONUS : 0);
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
  X: 1.5,
  // Rooks and queens are rare: merging is the main way to get them.
  R: 0.75,
  Q: 0.375,
};

/** Queens are offered from this round on (they'd otherwise fit the price cap from round 4). */
export const QUEEN_OFFER_ROUND = 6;

/** The most an offer can cost in `round`: cheap pieces first, a Rook from round 2, a Queen from round 4. */
export function maxOfferCost(round: number): number {
  return 2 + 2 * round;
}

/** A fresh set of offers for `round`. Prices are the pieces' values. Without `fairy`, standard pieces only. */
export function rollOffers(round: number, rng: Rng, fairy = true): PieceType[] {
  const pool = (Object.keys(OFFER_WEIGHTS) as PieceType[]).filter(
    (t) =>
      PIECE_VALUE[t] <= maxOfferCost(round) &&
      (t !== 'Q' || round >= QUEEN_OFFER_ROUND) &&
      (fairy || PIECES[t].group === 'standard'),
  );
  return Array.from({ length: OFFER_COUNT }, () => weightedPick(pool, (t) => OFFER_WEIGHTS[t] ?? 0, rng));
}

/** Buys offer number `index` onto the bench for its value in gold. */
export function buyOffer(shop: Shop, index: number): ShopResult {
  const type = shop.offers?.[index];
  if (!type) return { ok: false, error: 'That offer is gone' };
  if (benchCount(shop.pieces) >= BENCH_SIZE) {
    return { ok: false, error: `The bench is full (${BENCH_SIZE} pieces): place or sell a piece first` };
  }
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
export function rerollOffers(shop: Shop, round: number, rng: Rng, fairy = true): ShopResult {
  if (shop.gold < REROLL_COST) return { ok: false, error: 'Not enough gold' };
  return { ok: true, shop: { ...shop, gold: shop.gold - REROLL_COST, offers: rollOffers(round, rng, fairy) } };
}

// ---- fusion ----

/** Two pieces that fuse into a compound, free of charge. The king never fuses. */
export interface FusionRecipe {
  parts: [PieceType, PieceType];
  result: PieceType;
}

/**
 * Merges: the main way to upgrade, in every mode. Two minor pieces make a rook and two rooks a queen
 * (each loses a point but frees a square). Three-piece merges (pawns) are in SET_MERGES.
 */
export const MERGES: FusionRecipe[] = [
  { parts: ['N', 'N'], result: 'R' },
  { parts: ['B', 'B'], result: 'R' },
  { parts: ['N', 'B'], result: 'R' },
  { parts: ['R', 'R'], result: 'Q' },
];

/** Fusions into fairy compounds (fairy pieces on only). */
export const FUSIONS: FusionRecipe[] = [
  { parts: ['N', 'B'], result: 'A' }, // Archbishop
  { parts: ['N', 'R'], result: 'C' }, // Chancellor
  { parts: ['N', 'Q'], result: 'Z' }, // Amazon
  { parts: ['N', 'M'], result: 'T' }, // Centaur (the Man stands in for the king)
  { parts: ['F', 'W'], result: 'M' }, // Man: diagonal and straight steps together (worth 3 from 1 + 1)
];

/** What `a` and `b` can merge or fuse into (Knight + Bishop: a Rook, or an Archbishop with fairy pieces on). */
export function fusionResults(a: PieceType, b: PieceType, fairy: boolean): PieceType[] {
  const recipes = fairy ? [...MERGES, ...FUSIONS] : MERGES;
  return recipes
    .filter((f) => (f.parts[0] === a && f.parts[1] === b) || (f.parts[0] === b && f.parts[1] === a))
    .map((f) => f.result);
}

/** Merges and fusions the piece `pieceId` can make with another piece in the army: one entry per partner type and result. */
export function fusionOptions(shop: Shop, pieceId: string, fairy: boolean): { partnerId: string; result: PieceType }[] {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return [];
  const seen = new Set<PieceType>();
  const out: { partnerId: string; result: PieceType }[] = [];
  // Prefer partners on the bench, so fusing doesn't empty a board square the player arranged.
  const partners = [...shop.pieces].sort((x, y) => Number(x.square !== null) - Number(y.square !== null));
  for (const other of partners) {
    if (other.id === pieceId || seen.has(other.type)) continue;
    const results = fusionResults(piece.type, other.type, fairy);
    if (results.length === 0) continue;
    seen.add(other.type);
    for (const result of results) out.push({ partnerId: other.id, result });
  }
  return out;
}

/** Merges `pieceId` with `partnerId` into `result`: it takes `pieceId`'s place (square and id); the partner is used up. */
export function fusePieces(
  shop: Shop,
  pieceId: string,
  partnerId: string,
  result: PieceType,
  fairy: boolean,
): ShopResult {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  const partner = shop.pieces.find((p) => p.id === partnerId);
  if (!piece || !partner || piece.id === partner.id) return { ok: false, error: 'No such piece' };
  if (!fusionResults(piece.type, partner.type, fairy).includes(result)) {
    return {
      ok: false,
      error: `${PIECE_NAME[piece.type]} and ${PIECE_NAME[partner.type]} don't make a ${PIECE_NAME[result]}`,
    };
  }
  return {
    ok: true,
    shop: {
      ...shop,
      pieces: shop.pieces.filter((p) => p.id !== partnerId).map((p) => (p.id === pieceId ? { ...p, type: result } : p)),
    },
  };
}

// ---- three-piece merges: three pawns, or a minor piece and two pawns ----

/**
 * Pawns (and Berolina pawns) merge in threes into a minor piece, and a Knight or Bishop with two
 * pawns into a Rook. Free and points-neutral: two board squares are freed.
 */
export const PAWN_FUSION_COUNT = 3;

const isMinor = (t: PieceType) => t === 'N' || t === 'B';

/** What three pieces of these types can merge into (empty if they can't). */
export function setMergeResults(types: PieceType[], fairy: boolean): PieceType[] {
  if (types.length !== PAWN_FUSION_COUNT) return [];
  const pawns = types.filter(isPawnLike).length;
  if (pawns === 3) return pawnFusionResults(fairy);
  if (pawns === 2 && types.some(isMinor)) return ['R'];
  return [];
}

/** Pieces that can take part in a three-piece merge (what the picker lets you circle). */
export function canSetMerge(type: PieceType): boolean {
  return isPawnLike(type) || isMinor(type);
}

/**
 * The pieces circled when a three-piece merge starts from `pieceId`: for a pawn, two more pawns
 * (see pawnPartners); for a Knight or Bishop, two pawns (plain ones, then benched ones, first).
 * Null if there aren't enough.
 */
export function setMergePartners(shop: Shop, pieceId: string): Piece[] | null {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return null;
  if (isPawnLike(piece.type)) return pawnPartners(shop, pieceId);
  if (!isMinor(piece.type)) return null;
  const pawns = shop.pieces
    .filter((p) => isPawnLike(p.type))
    .sort(
      (x, y) =>
        Number(x.type !== 'P') - Number(y.type !== 'P') || Number(x.square !== null) - Number(y.square !== null),
    );
  return pawns.length >= 2 ? pawns.slice(0, 2) : null;
}

/** What three pawns can become. The Man needs fairy pieces on. */
export function pawnFusionResults(fairy: boolean): PieceType[] {
  return fairy ? ['N', 'B', 'M'] : ['N', 'B'];
}

/**
 * The two other pawns `pieceId` would fuse with by default, or null if there aren't enough: pawns of
 * its own kind first (so Berolina pawns aren't used up by accident), benched ones before placed ones.
 */
export function pawnPartners(shop: Shop, pieceId: string): Piece[] | null {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece || !isPawnLike(piece.type)) return null;
  const others = shop.pieces
    .filter((p) => p.id !== pieceId && isPawnLike(p.type))
    .sort(
      (x, y) =>
        Number(x.type !== piece.type) - Number(y.type !== piece.type) ||
        Number(x.square !== null) - Number(y.square !== null),
    );
  return others.length >= PAWN_FUSION_COUNT - 1 ? others.slice(0, PAWN_FUSION_COUNT - 1) : null;
}

/** What the pawn `pieceId` can fuse into with two other pawns (empty if it can't). */
export function pawnFusionOptions(shop: Shop, pieceId: string, fairy: boolean): PieceType[] {
  return pawnPartners(shop, pieceId) ? pawnFusionResults(fairy) : [];
}

/** Merges `pieceId` and its default partners (see setMergePartners) into `result`. */
export function fusePawns(shop: Shop, pieceId: string, result: PieceType, fairy: boolean): ShopResult {
  const partners = setMergePartners(shop, pieceId);
  if (!partners) return { ok: false, error: `Merging needs ${PAWN_FUSION_COUNT} pieces` };
  return fuseSet(shop, [pieceId, ...partners.map((p) => p.id)], result, fairy);
}

/**
 * Merges exactly the pieces `ids` (the player's pick) into `result`. It takes the place of the
 * minor piece if one is on the board, else of the first picked piece on the board (or the first one).
 */
export function fuseSet(shop: Shop, ids: string[], result: PieceType, fairy: boolean): ShopResult {
  const chosen = ids.map((id) => shop.pieces.find((p) => p.id === id));
  if (new Set(ids).size !== PAWN_FUSION_COUNT || chosen.some((p) => !p))
    return { ok: false, error: `Pick ${PAWN_FUSION_COUNT} pieces to merge` };
  const pieces = chosen as Piece[];
  if (
    !setMergeResults(
      pieces.map((p) => p.type),
      fairy,
    ).includes(result)
  )
    return { ok: false, error: `Those pieces can't become a ${PIECE_NAME[result]}` };
  const pieceId = (pieces.find((p) => isMinor(p.type) && p.square) ?? pieces.find((p) => p.square) ?? pieces[0]).id;
  const used = new Set(ids.filter((id) => id !== pieceId));
  return {
    ok: true,
    shop: {
      ...shop,
      pieces: shop.pieces.filter((p) => !used.has(p.id)).map((p) => (p.id === pieceId ? { ...p, type: result } : p)),
    },
  };
}
