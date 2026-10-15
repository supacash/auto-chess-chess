import type { Winner } from './battle';
import { BENCH_SIZE, benchCount, MAX_HEIRS } from './placement';
import {
  type Affinity,
  AFFINITIES,
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
 * Which pieces each type can be upgraded into with gold: only a plain pawn (no affinity) into a minor
 * piece. Rooks and queens come from merging or the shop; spare gold goes into rerolls.
 */
export const UPGRADES: Record<PieceType, PieceType[]> = {
  ...(Object.fromEntries(PIECE_TYPES.map((t) => [t, []])) as unknown as Record<PieceType, PieceType[]>),
  P: ['N', 'B'],
};

/** The player's persistent army and purse between rounds. */
export interface Shop {
  gold: number;
  pieces: Piece[];
  /** Offers for sale this round (bought ones are removed). Missing = none. */
  offers?: Offer[];
  /** Locked: the offers stay for the next round instead of being replaced (see restock). */
  locked?: boolean;
}

export type ShopResult = { ok: true; shop: Shop } | { ok: false; error: string };

export function startingShop(army: PieceType[] = START_ARMY): Shop {
  return { gold: START_GOLD, pieces: army.map((t) => makePiece(t)) };
}

/** A gold upgrade costs 1 more than the value it adds. */
const UPGRADE_PREMIUM: Partial<Record<PieceType, number>> = { N: 1, B: 1 };

export function upgradeCost(from: PieceType, to: PieceType): number {
  return PIECE_VALUE[to] - PIECE_VALUE[from] + (UPGRADE_PREMIUM[to] ?? 0);
}

/**
 * Gold above a piece's value that it costs in the shop. The Wazir fights like a 1-point piece but
 * costs 2, so a Man costs 3 gold however it's made (a Ferz and a Wazir, or bought).
 */
const PRICE_PREMIUM: Partial<Record<PieceType, number>> = { W: 1 };

/**
 * What a piece costs in gold: its value, plus any PRICE_PREMIUM. A two-piece fusion costs no more
 * than its parts, so buying one (the Bazaar perk) costs the same as fusing it, and fusing and selling
 * never makes gold (an Archbishop is worth 7 but costs a Knight and a Bishop, 6).
 */
export function piecePrice(type: PieceType): number {
  const own = PIECE_VALUE[type] + (PRICE_PREMIUM[type] ?? 0);
  const recipe = FUSIONS.find((f) => f.result === type);
  return recipe ? Math.min(own, piecePrice(recipe.parts[0]) + piecePrice(recipe.parts[1])) : own;
}

/**
 * What a piece is worth, as in other auto-battlers: its price (an affinity pawn's too). Plain pawns
 * are only ever the free starting pawns, so they sell for nothing.
 */
export function sellValue(piece: PieceType | Pick<Piece, 'type' | 'affinity'>): number {
  const { type, affinity } = typeof piece === 'string' ? { type: piece, affinity: undefined } : piece;
  if (affinity) return AFFINITY_PRICE[affinity];
  if (type === 'K' || type === 'J' || type === 'P') return 0;
  return piecePrice(type);
}

/** Interest: +1 gold per INTEREST_STEP gold saved, up to MAX_INTEREST, paid with each round's income. */
export const INTEREST_STEP = 10;
export const MAX_INTEREST = 3;

/** Interest on `gold`: +1 per `step` saved, up to `max` (the Banker perk changes both). */
export function interest(gold: number, step = INTEREST_STEP, max = MAX_INTEREST): number {
  return Math.min(max, Math.floor(Math.max(0, gold) / step));
}

export function roundIncome(winner: Winner): number {
  return BASE_INCOME + (winner === 'w' ? WIN_BONUS : winner === 'draw' ? DRAW_BONUS : 0);
}

/** Upgrades a piece in place (it keeps its square and id). */
export function upgradePiece(shop: Shop, pieceId: string, to: PieceType): ShopResult {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece) return { ok: false, error: 'No such piece' };
  if (piece.affinity || !UPGRADES[piece.type].includes(to)) {
    return { ok: false, error: `${pieceName(piece)} can't become a ${PIECE_NAME[to]}` };
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
  if (piece.type === 'J') return { ok: false, error: "The Heir can't be sold" };
  return {
    ok: true,
    shop: { ...shop, gold: shop.gold + sellValue(piece), pieces: shop.pieces.filter((p) => p.id !== pieceId) },
  };
}

// ---- affinity pawns ----

/**
 * Pawns with an affinity: they fight as ordinary pawns, and three with the same affinity merge into
 * that piece. Rook-pawns cost a premium (three make a 5-point rook for 6 gold): rooks proved strong
 * for their value.
 */
export const AFFINITY_PRICE: Record<Affinity, number> = { N: 1, B: 1, R: 2, Q: 3 };

/** A piece's name, with its affinity ("Rook-pawn"). */
export function pieceName(piece: Pick<Piece, 'type' | 'affinity'>): string {
  return piece.affinity ? `${PIECE_NAME[piece.affinity]}-pawn` : PIECE_NAME[piece.type];
}

// ---- shop offers ----

/** Offers each round. */
export const OFFER_COUNT = 4;
export const REROLL_COST = 1;

/** A shop offer: a piece, or an affinity pawn ('PN' = knight-pawn, 'PR' = rook-pawn, …). */
export type Offer = PieceType | `P${Affinity}`;

export function isAffinityOffer(offer: Offer): offer is `P${Affinity}` {
  return offer.length === 2 && offer[0] === 'P' && (AFFINITIES as string[]).includes(offer[1]);
}

export function isOffer(value: unknown): value is Offer {
  return typeof value === 'string' && (value in PIECES || isAffinityOffer(value as Offer));
}

/** What an offer costs: a piece's price, or an affinity pawn's. */
export function offerPrice(offer: Offer): number {
  return isAffinityOffer(offer) ? AFFINITY_PRICE[offer[1] as Affinity] : piecePrice(offer);
}

export function offerName(offer: Offer): string {
  return isAffinityOffer(offer) ? `${PIECE_NAME[offer[1] as Affinity]}-pawn` : PIECE_NAME[offer];
}

/** The piece an offer buys (on the bench). */
export function offerPiece(offer: Offer): Piece {
  return isAffinityOffer(offer) ? makePiece('P', null, offer[1] as Affinity) : makePiece(offer);
}

/**
 * What the shop can offer, with how often each shows up. Mostly affinity pawns; finished pieces are
 * rare. Fusion pieces are never offered (they come only from fusing), nor is the king.
 */
export const OFFER_WEIGHTS: Partial<Record<Offer, number>> = {
  PN: 2.5,
  PB: 2.5,
  // Rook-pawns are rarer than the Ferz and Wazir: the Rook recipe is getting cheaper (SIMULATION.md §23).
  PR: 0.8,
  PQ: 1.2,
  E: 2,
  F: 1, // Ferz, Wazir and Man were in most shops; they're rarer so the other fairy pieces show up
  W: 1,
  M: 0.8,
  L: 1.2,
  X: 1.5,
  N: 0.5,
  B: 0.5,
  R: 0.3,
  Q: 0.15,
  Y: 0.1, // the Stackman: the one fusion piece the shop sells (fairy, from round 4, at its value)
};

/** Queens and queen-pawns are offered from this round on. */
export const QUEEN_OFFER_ROUND = 6;

/** The most an offer can cost in `round`: cheap pieces first, a Rook from round 2. */
export function maxOfferCost(round: number): number {
  return 2 + 2 * round;
}

/** How offers are drawn when something changes the defaults: a prestige perk, or the multiplayer pool. */
export interface OfferOdds {
  /** Queens and queen-pawns show up from this round on (QUEEN_OFFER_ROUND by default). */
  queenRound?: number;
  /** Multiplies each offer's chance (multiplayer: how much of it is left in the shared pool). */
  scale?: (offer: Offer) => number;
  /** Offers the shop doesn't normally stock, with their weights (the Bazaar perk's fusion pieces). */
  extra?: Partial<Record<Offer, number>>;
}

/** A fresh set of offers for `round`. Without `fairy`, standard pieces (and affinity pawns) only. */
export function rollOffers(round: number, rng: Rng, fairy = true, odds: OfferOdds = {}): Offer[] {
  const { queenRound = QUEEN_OFFER_ROUND, scale = () => 1, extra } = odds;
  const weights = extra ? { ...OFFER_WEIGHTS, ...extra } : OFFER_WEIGHTS;
  const pool = (Object.keys(weights) as Offer[]).filter((o) => {
    const queen = o === 'Q' || o === 'PQ';
    const standard = isAffinityOffer(o) || PIECES[o].group === 'standard';
    return offerPrice(o) <= maxOfferCost(round) && (!queen || round >= queenRound) && (fairy || standard);
  });
  return Array.from({ length: OFFER_COUNT }, () => weightedPick(pool, (o) => (weights[o] ?? 0) * scale(o), rng));
}

/** Buys offer number `index` onto the bench for its price in gold. */
export function buyOffer(shop: Shop, index: number): ShopResult {
  const offer = shop.offers?.[index];
  if (!offer) return { ok: false, error: 'That offer is gone' };
  if (benchCount(shop.pieces) >= BENCH_SIZE) {
    return { ok: false, error: `The bench is full (${BENCH_SIZE} pieces): place or sell a piece first` };
  }
  const price = offerPrice(offer);
  if (shop.gold < price) return { ok: false, error: 'Not enough gold' };
  return {
    ok: true,
    shop: {
      ...shop,
      gold: shop.gold - price,
      pieces: [...shop.pieces, offerPiece(offer)],
      offers: shop.offers?.filter((_, i) => i !== index),
    },
  };
}

/** Pays `cost` (REROLL_COST unless a perk makes it free) for a fresh set of offers. */
export function rerollOffers(
  shop: Shop,
  round: number,
  rng: Rng,
  fairy = true,
  cost = REROLL_COST,
  odds: OfferOdds = {},
): ShopResult {
  if (shop.gold < cost) return { ok: false, error: 'Not enough gold' };
  const { locked: _, ...rest } = shop; // rerolling unlocks
  return { ok: true, shop: { ...rest, gold: shop.gold - cost, offers: rollOffers(round, rng, fairy, odds) } };
}

/** Locks or unlocks the shop: a locked shop keeps its offers into the next round. */
export function toggleLock(shop: Shop): Shop {
  return { ...shop, locked: !shop.locked };
}

/**
 * The shop for a new round: fresh offers, unless it was locked, in which case it keeps the offers
 * (whatever's left of them) and unlocks.
 */
export function restock(shop: Shop, round: number, rng: Rng, fairy = true, odds: OfferOdds = {}): Shop {
  const { locked, ...rest } = shop;
  if (locked && rest.offers) return rest;
  return { ...rest, offers: rollOffers(round, rng, fairy, odds) };
}

// ---- two-piece merges and fusion ----

/** Two pieces that merge or fuse into one, free of charge. The king never fuses. */
export interface FusionRecipe {
  parts: [PieceType, PieceType];
  result: PieceType;
}

/** Two rooks merge into a queen, in every mode (a point lost, a square freed). */
export const MERGES: FusionRecipe[] = [{ parts: ['R', 'R'], result: 'Q' }];

/** Fusions into fairy compounds (fairy pieces on only). */
export const FUSIONS: FusionRecipe[] = [
  { parts: ['N', 'B'], result: 'A' }, // Archbishop
  { parts: ['N', 'R'], result: 'C' }, // Chancellor
  { parts: ['N', 'Q'], result: 'Z' }, // Amazon
  { parts: ['N', 'M'], result: 'T' }, // Centaur (the Man stands in for the king)
  { parts: ['F', 'W'], result: 'M' }, // Man: diagonal and straight steps together (worth 3 from 1 + 1; 3 gold)
  { parts: ['R', 'F'], result: 'D' }, // Dragon King
  { parts: ['B', 'W'], result: 'H' }, // Dragon Horse
  { parts: ['N', 'L'], result: 'U' }, // Wildebeest
  { parts: ['X', 'B'], result: 'S' }, // Siege Cannon
];

/** What `a` and `b` can merge or fuse into. Order doesn't matter. */
export function fusionResults(a: PieceType, b: PieceType, fairy: boolean): PieceType[] {
  const recipes = fairy ? [...MERGES, ...FUSIONS] : MERGES;
  return recipes
    .filter((f) => (f.parts[0] === a && f.parts[1] === b) || (f.parts[0] === b && f.parts[1] === a))
    .map((f) => f.result);
}

/** Merges and fusions the piece `pieceId` can make with another piece in the army: one entry per partner type and result. */
export function fusionOptions(shop: Shop, pieceId: string, fairy: boolean): { partnerId: string; result: PieceType }[] {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.affinity) return [];
  const seen = new Set<PieceType>();
  const out: { partnerId: string; result: PieceType }[] = [];
  // Prefer partners on the bench, so fusing doesn't empty a board square the player arranged.
  const partners = [...shop.pieces].sort((x, y) => Number(x.square !== null) - Number(y.square !== null));
  for (const other of partners) {
    if (other.id === pieceId || other.affinity || seen.has(other.type)) continue;
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
  if (piece.affinity || partner.affinity || !fusionResults(piece.type, partner.type, fairy).includes(result)) {
    return {
      ok: false,
      error: `${pieceName(piece)} and ${pieceName(partner)} don't make a ${PIECE_NAME[result]}`,
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

// ---- three-piece merges: three of a kind ----

/**
 * Three pawns with the same affinity merge into that piece; three plain pawns (the starting ones, or
 * three Berolina pawns) into a Knight or Bishop; three Knights (or three Bishops) into a Queen. Free;
 * two board squares are freed.
 */
export const SET_MERGE_SIZE = 3;

type MergePart = Pick<Piece, 'type' | 'affinity'>;

/**
 * True when three Queens may merge into an Heir (a second king): fairy pieces on, and the army has
 * no Heir yet.
 */
export function canMakeHeir(shop: Shop, fairy: boolean, maxHeirs = MAX_HEIRS): boolean {
  return fairy && shop.pieces.filter((p) => p.type === 'J').length < maxHeirs;
}

/** What three pieces can merge into (empty if they can't). `heir`: three Queens may become an Heir (canMakeHeir). */
export function setMergeResults(parts: MergePart[], heir = false): PieceType[] {
  if (parts.length !== SET_MERGE_SIZE) return [];
  const [first] = parts;
  if (first.affinity) return parts.every((p) => p.affinity === first.affinity) ? [first.affinity] : [];
  if (!parts.every((p) => p.type === first.type && !p.affinity)) return [];
  if (isPawnLike(first.type)) return ['N', 'B'];
  if (first.type === 'N' || first.type === 'B') return ['Q'];
  if (first.type === 'M') return ['Y']; // three men stack into a Stackman
  if (first.type === 'Q' && heir) return ['J']; // three queens crown an Heir
  return [];
}

/** Pieces that can take part in a three-piece merge (what the picker lets you circle). */
export function canSetMerge(piece: MergePart, heir = false): boolean {
  return (
    piece.affinity !== undefined ||
    isPawnLike(piece.type) ||
    piece.type === 'N' ||
    piece.type === 'B' ||
    piece.type === 'M' ||
    (piece.type === 'Q' && heir)
  );
}

/** True when two pieces are the same kind for a three-piece merge (same affinity, or both plain of one type). */
function sameKind(a: MergePart, b: MergePart): boolean {
  return a.affinity ? a.affinity === b.affinity : !b.affinity && a.type === b.type;
}

/**
 * The two pieces circled with `pieceId` when a three-piece merge starts: the same kind (same
 * affinity, or the same minor piece), benched ones first. Null if there aren't enough.
 */
export function setMergePartners(shop: Shop, pieceId: string, fairy = false, maxHeirs = MAX_HEIRS): Piece[] | null {
  const piece = shop.pieces.find((p) => p.id === pieceId);
  if (!piece || !canSetMerge(piece, canMakeHeir(shop, fairy, maxHeirs))) return null;
  const others = shop.pieces
    .filter((p) => p.id !== pieceId && sameKind(piece, p))
    .sort((x, y) => Number(x.square !== null) - Number(y.square !== null));
  return others.length >= SET_MERGE_SIZE - 1 ? others.slice(0, SET_MERGE_SIZE - 1) : null;
}

/** Merges `pieceId` and its default partners (see setMergePartners) into `result`. */
export function fuseDefaultSet(
  shop: Shop,
  pieceId: string,
  result: PieceType,
  fairy = false,
  maxHeirs = MAX_HEIRS,
): ShopResult {
  const partners = setMergePartners(shop, pieceId, fairy, maxHeirs);
  if (!partners) return { ok: false, error: `Merging needs ${SET_MERGE_SIZE} matching pieces` };
  return fuseSet(shop, [pieceId, ...partners.map((p) => p.id)], result, fairy, maxHeirs);
}

/**
 * Merges exactly the pieces `ids` (the player's pick) into `result`. It takes the place of the first
 * picked piece on the board (or the first one, if all are benched). An Heir goes to the bench instead
 * (a queen's square may be on the front row, where a king can't stand).
 */
export function fuseSet(shop: Shop, ids: string[], result: PieceType, fairy = false, maxHeirs = MAX_HEIRS): ShopResult {
  const chosen = ids.map((id) => shop.pieces.find((p) => p.id === id));
  if (new Set(ids).size !== SET_MERGE_SIZE || chosen.some((p) => !p))
    return { ok: false, error: `Pick ${SET_MERGE_SIZE} pieces to merge` };
  const pieces = chosen as Piece[];
  if (!setMergeResults(pieces, canMakeHeir(shop, fairy, maxHeirs)).includes(result))
    return { ok: false, error: `Those pieces can't become a ${PIECE_NAME[result]}` };
  const pieceId = (pieces.find((p) => p.square) ?? pieces[0]).id;
  const used = new Set(ids.filter((id) => id !== pieceId));
  return {
    ok: true,
    shop: {
      ...shop,
      pieces: shop.pieces
        .filter((p) => !used.has(p.id))
        .map((p) => (p.id === pieceId ? { id: p.id, type: result, square: result === 'J' ? null : p.square } : p)),
    },
  };
}
