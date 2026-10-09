import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import { isPawnLike, type Piece, type PieceType, type Square, sameSquare, squareName } from './pieces';

export const BACK_RANK = 0;

/** Most pieces that can wait on the bench at once (bought pieces arrive there). */
export const BENCH_SIZE = 8;

/**
 * Most pieces on the board: a chess side's worth, two per file (16 on 8×8, 10 on 5×5), and never
 * more than the home squares. Only pieces on the board count; the bench is separate.
 */
export function armyCap(spec: BoardSpec = BOARD_8): number {
  return Math.min(2 * spec.files, spec.files * spec.homeRows);
}

export function placedCount(pieces: Piece[]): number {
  return pieces.filter((p) => p.square).length;
}

export function benchCount(pieces: Piece[]): number {
  return pieces.filter((p) => !p.square).length;
}

/** The front home row (counted from the side's own back rank). */
export function frontRank(spec: BoardSpec): number {
  return spec.homeRows - 1;
}

/** Returns why `type` can't go on `sq` on `spec`, or null if allowed. Ignores occupancy. */
export function placementError(type: PieceType, sq: Square, spec: BoardSpec = BOARD_8): string | null {
  if (sq.file < 0 || sq.file >= spec.files || sq.rank < 0 || sq.rank >= spec.homeRows) {
    return 'Outside your home rows';
  }
  if (type === 'K' && sq.rank === frontRank(spec)) return "King can't be placed on the front row";
  if (isPawnLike(type) && sq.rank === BACK_RANK) return "Pawns can't be placed on the back row";
  return null;
}

export function canPlace(type: PieceType, sq: Square, spec: BoardSpec = BOARD_8): boolean {
  return placementError(type, sq, spec) === null;
}

export function pieceAt(pieces: Piece[], sq: Square): Piece | undefined {
  return pieces.find((p) => sameSquare(p.square, sq));
}

/**
 * Why moving `pieceId` to `target` (a square, or null for the bench) would break the board limit or
 * overfill the bench, or null if it wouldn't. Swaps never change either count.
 */
export function capacityError(
  pieces: Piece[],
  pieceId: string,
  target: Square | null,
  spec: BoardSpec = BOARD_8,
): string | null {
  const mover = pieces.find((p) => p.id === pieceId);
  if (!mover) return null;
  if (target === null) {
    return mover.square && benchCount(pieces) >= BENCH_SIZE ? `The bench is full (${BENCH_SIZE} pieces)` : null;
  }
  if (!mover.square && !pieceAt(pieces, target) && placedCount(pieces) >= armyCap(spec)) {
    return `Your army is full: ${armyCap(spec)} pieces on this board. Swap a piece instead.`;
  }
  return null;
}

/**
 * Moves `pieceId` to `target` (a board square, or null for the bench).
 * If the target is occupied the two pieces swap, provided the displaced piece
 * may legally stand on the mover's origin (a bench origin always accepts it).
 * Returns the new piece list, or null if the move is illegal (including one that would put more
 * than armyCap pieces on the board or more than BENCH_SIZE on the bench).
 */
export function movePiece(
  pieces: Piece[],
  pieceId: string,
  target: Square | null,
  spec: BoardSpec = BOARD_8,
): Piece[] | null {
  const mover = pieces.find((p) => p.id === pieceId);
  if (!mover) return null;
  if (capacityError(pieces, pieceId, target, spec)) return null;
  if (target === null) {
    return pieces.map((p) => (p.id === pieceId ? { ...p, square: null } : p));
  }
  if (!canPlace(mover.type, target, spec)) return null;
  if (sameSquare(mover.square, target)) return pieces;

  const occupant = pieceAt(pieces, target);
  if (occupant && mover.square && !canPlace(occupant.type, mover.square, spec)) return null;

  const origin = mover.square;
  return pieces.map((p) => {
    if (p.id === mover.id) return { ...p, square: target };
    if (occupant && p.id === occupant.id) return { ...p, square: origin };
    return p;
  });
}

/**
 * Moves any piece that can't stand where it is on `spec` (off the board, wrong row, or sharing a
 * square) to the bench. Boards only grow during a run, so this mainly repairs old saves.
 */
export function fitToBoard(pieces: Piece[], spec: BoardSpec): Piece[] {
  const taken = new Set<string>();
  return pieces.map((p) => {
    if (!p.square) return p;
    const key = squareName(p.square);
    if (!canPlace(p.type, p.square, spec) || taken.has(key)) return { ...p, square: null };
    taken.add(key);
    return p;
  });
}

/** Problems that stop the army from starting a battle on `spec`. Empty = ready. */
export function armyErrors(pieces: Piece[], spec: BoardSpec = BOARD_8): string[] {
  const errors: string[] = [];
  const kings = pieces.filter((p) => p.type === 'K');
  if (kings.length !== 1) errors.push('Army must have exactly one king');
  else if (!kings[0].square) errors.push('Place your king on the board');

  const cap = armyCap(spec);
  if (placedCount(pieces) > cap) errors.push(`Too many pieces on the board (at most ${cap})`);

  const seen = new Set<string>();
  for (const p of pieces) {
    if (!p.square) continue;
    const name = squareName(p.square);
    if (seen.has(name)) errors.push(`Two pieces on ${name}`);
    seen.add(name);
    const err = placementError(p.type, p.square, spec);
    if (err) errors.push(`${name}: ${err}`);
  }
  return errors;
}
