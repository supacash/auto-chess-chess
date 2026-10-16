import {
  FUSIONS,
  MERGES,
  maxOfferCost,
  OFFER_WEIGHTS,
  piecePrice,
  QUEEN_OFFER_ROUND,
  ROOK_PARTNERS,
  ROOK_PAWNS,
  SET_MERGE_SIZE,
  START_ARMY,
  setMergeResults,
  UPGRADES,
  upgradeCost,
} from './economy';
import { AFFINITIES, type Affinity, isPawnLike, PIECE_TYPES, PIECES, type PieceType } from './pieces';
import { FINAL_ROUND } from './run';

/** The Piece guide's sections. */
export type GuideGroup = 'standard' | 'pawns' | 'fairy' | 'fusions';
export const GUIDE_GROUPS: readonly GuideGroup[] = ['standard', 'pawns', 'fairy', 'fusions'];

/** Some pieces: `count` of `type` (an affinity pawn when `affinity` is set). */
export interface GuidePart {
  type: PieceType;
  affinity?: Affinity;
  count: number;
}

/**
 * One way to get a piece, read off the shop's rules (economy.ts): it's in the starting army, the shop
 * offers it, the shop's affinity pawns fight as it, a set of pieces merges into it, a gold upgrade, or
 * a two-piece fusion. `fairy`: only with fairy pieces on.
 */
export type GuideWay =
  | { kind: 'start'; count: number }
  | { kind: 'shop'; gold: number; fromRound: number }
  | { kind: 'affinityPawns' }
  | { kind: 'merge'; parts: GuidePart[]; oneOf?: readonly PieceType[]; fairy: boolean }
  | { kind: 'upgrade'; from: PieceType; gold: number }
  | { kind: 'fusion'; parts: GuidePart[] };

/** A fairy piece: only in the shop, AI armies and fusions with fairy pieces on. */
export function isFairyPiece(type: PieceType): boolean {
  return PIECES[type].group !== 'standard';
}

/** Which section of the guide a piece is in. */
export function guideGroup(type: PieceType): GuideGroup {
  if (isPawnLike(type)) return 'pawns';
  const { group } = PIECES[type];
  return group === 'standard' ? 'standard' : group === 'fusion' ? 'fusions' : 'fairy';
}

/** The first round the shop can offer a piece at `gold` (offers get dearer as the run goes on). */
function firstOfferRound(gold: number): number {
  for (let round = 1; round <= FINAL_ROUND; round++) if (maxOfferCost(round) >= gold) return round;
  return FINAL_ROUND;
}

/** Two parts that are the same piece read as one part of two. */
function pairParts([a, b]: readonly [PieceType, PieceType]): GuidePart[] {
  return a === b
    ? [{ type: a, count: 2 }]
    : [
        { type: a, count: 1 },
        { type: b, count: 1 },
      ];
}

/** Every way to get `type`, in the order the guide lists them. Empty for a piece nobody can meet. */
export function waysToGet(type: PieceType): GuideWay[] {
  const ways: GuideWay[] = [];
  const start = START_ARMY.filter((t) => t === type).length;
  if (start > 0) ways.push({ kind: 'start', count: start });
  if ((OFFER_WEIGHTS[type] ?? 0) > 0) {
    const gold = piecePrice(type);
    const round = firstOfferRound(gold);
    ways.push({ kind: 'shop', gold, fromRound: type === 'Q' ? Math.max(round, QUEEN_OFFER_ROUND) : round });
  }
  // Affinity pawns are pawns until their set is merged.
  if (type === 'P' && AFFINITIES.some((a) => (OFFER_WEIGHTS[`P${a}`] ?? 0) > 0)) ways.push({ kind: 'affinityPawns' });

  // Three affinity pawns of one kind.
  for (const affinity of AFFINITIES) {
    const set = Array.from({ length: SET_MERGE_SIZE }, () => ({ type: 'P' as const, affinity }));
    if (setMergeResults(set).includes(type))
      ways.push({ kind: 'merge', parts: [{ type: 'P', affinity, count: SET_MERGE_SIZE }], fairy: false });
  }
  // The Rook's own recipe.
  if (type === 'R')
    ways.push({
      kind: 'merge',
      parts: [{ type: 'P', affinity: 'R', count: ROOK_PAWNS }],
      oneOf: ROOK_PARTNERS,
      fairy: false,
    });
  // Three of the same plain piece (three Queens make an Heir only with fairy pieces on).
  for (const from of PIECE_TYPES) {
    if (from === 'K') continue;
    const set = Array.from({ length: SET_MERGE_SIZE }, () => ({ type: from }));
    if (setMergeResults(set, true).includes(type))
      ways.push({
        kind: 'merge',
        parts: [{ type: from, count: SET_MERGE_SIZE }],
        fairy: isFairyPiece(from) || isFairyPiece(type),
      });
  }
  for (const merge of MERGES) {
    if (merge.result === type)
      ways.push({
        kind: 'merge',
        parts: pairParts(merge.parts),
        fairy: merge.parts.some(isFairyPiece),
      });
  }
  for (const from of PIECE_TYPES) {
    if (UPGRADES[from].includes(type)) ways.push({ kind: 'upgrade', from, gold: upgradeCost(from, type) });
  }
  for (const fusion of FUSIONS) {
    if (fusion.result === type) ways.push({ kind: 'fusion', parts: pairParts(fusion.parts) });
  }
  return ways;
}

/** True when a way to get a piece needs fairy pieces on. */
export function isFairyWay(way: GuideWay): boolean {
  return way.kind === 'fusion' || (way.kind === 'merge' && way.fairy);
}

/**
 * The pieces in the guide, by section: every piece a player can meet, i.e. one the shop, a merge, a
 * fusion or the starting army can give. (AI armies draft from the same pieces; the Grasshopper is
 * neither sold nor drafted any more, so it's left out.)
 */
export function guidePieces(group: GuideGroup): PieceType[] {
  return PIECE_TYPES.filter((t) => guideGroup(t) === group && waysToGet(t).length > 0);
}
