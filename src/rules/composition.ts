import type { PieceType } from './pieces';

/**
 * Stockfish refuses positions a real game can't reach: a side's pawns plus "promoted" pieces
 * (knights, bishops or rooks beyond 2, queens beyond 1) can be at most 8.
 */
export const MAX_PAWN_SLOTS = 8;

/** How many of each piece a side starts a normal game with; anything beyond needs a promotion. */
const STANDARD: Partial<Record<PieceType, number>> = { N: 2, B: 2, R: 2, Q: 1 };

/** Pawns plus pieces beyond the standard set: the count Stockfish caps at MAX_PAWN_SLOTS. */
export function pawnSlots(types: readonly PieceType[]): number {
  const count = (t: PieceType) => types.filter((x) => x === t).length;
  let slots = count('P');
  for (const [t, n] of Object.entries(STANDARD) as [PieceType, number][]) slots += Math.max(0, count(t) - n);
  return slots;
}

export function fitsEngine(types: readonly PieceType[]): boolean {
  return pawnSlots(types) <= MAX_PAWN_SLOTS;
}

export const COMPOSITION_ERROR = `Too many pieces: pawns plus extra pieces (beyond 2 knights, 2 bishops, 2 rooks and 1 queen) can be at most ${MAX_PAWN_SLOTS}`;
