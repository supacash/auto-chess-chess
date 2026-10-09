import { type Piece, type PieceType, type Square, sameSquare, squareName } from './pieces';

/** Number of home ranks each side controls. */
export const HOME_RANKS = 3;
export const FRONT_RANK = HOME_RANKS - 1;
export const BACK_RANK = 0;

/** Returns why `type` can't go on `sq`, or null if allowed. Ignores occupancy. */
export function placementError(type: PieceType, sq: Square): string | null {
  if (sq.file < 0 || sq.file > 7 || sq.rank < 0 || sq.rank >= HOME_RANKS) {
    return 'Outside your home rows';
  }
  if (type === 'K' && sq.rank === FRONT_RANK) return "King can't be placed on the front row";
  if (type === 'P' && sq.rank === BACK_RANK) return "Pawns can't be placed on the back row";
  return null;
}

export function canPlace(type: PieceType, sq: Square): boolean {
  return placementError(type, sq) === null;
}

export function pieceAt(pieces: Piece[], sq: Square): Piece | undefined {
  return pieces.find((p) => sameSquare(p.square, sq));
}

/**
 * Moves `pieceId` to `target` (a board square, or null for the bench).
 * If the target is occupied the two pieces swap, provided the displaced piece
 * may legally stand on the mover's origin (a bench origin always accepts it).
 * Returns the new piece list, or null if the move is illegal.
 */
export function movePiece(pieces: Piece[], pieceId: string, target: Square | null): Piece[] | null {
  const mover = pieces.find((p) => p.id === pieceId);
  if (!mover) return null;
  if (target === null) {
    return pieces.map((p) => (p.id === pieceId ? { ...p, square: null } : p));
  }
  if (!canPlace(mover.type, target)) return null;
  if (sameSquare(mover.square, target)) return pieces;

  const occupant = pieceAt(pieces, target);
  if (occupant && mover.square && !canPlace(occupant.type, mover.square)) return null;

  const origin = mover.square;
  return pieces.map((p) => {
    if (p.id === mover.id) return { ...p, square: target };
    if (occupant && p.id === occupant.id) return { ...p, square: origin };
    return p;
  });
}

/** Problems that stop the army from starting a battle. Empty = ready. */
export function armyErrors(pieces: Piece[]): string[] {
  const errors: string[] = [];
  const kings = pieces.filter((p) => p.type === 'K');
  if (kings.length !== 1) errors.push('Army must have exactly one king');
  else if (!kings[0].square) errors.push('Place your king on the board');

  const seen = new Set<string>();
  for (const p of pieces) {
    if (!p.square) continue;
    const name = squareName(p.square);
    if (seen.has(name)) errors.push(`Two pieces on ${name}`);
    seen.add(name);
    const err = placementError(p.type, p.square);
    if (err) errors.push(`${name}: ${err}`);
  }
  return errors;
}
