/** Maximum army size, king included. */
export const MAX_ARMY = 16;

export type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';

/** Board square: file 0-7 (a-h), rank 0-7 (rank 1-8). The player always owns ranks 0-2. */
export interface Square {
  file: number;
  rank: number;
}

export interface Piece {
  id: string;
  type: PieceType;
  /** null = on the bench (owned but not placed). */
  square: Square | null;
}

export const PIECE_VALUE: Record<PieceType, number> = {
  K: 0,
  Q: 9,
  R: 5,
  B: 3,
  N: 3,
  P: 1,
};

export const PIECE_NAME: Record<PieceType, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
  P: 'Pawn',
};

export function sameSquare(a: Square | null, b: Square | null): boolean {
  return a !== null && b !== null && a.file === b.file && a.rank === b.rank;
}

export function squareName(sq: Square): string {
  return 'abcdefgh'[sq.file] + (sq.rank + 1);
}

// Per-page-load prefix keeps ids unique against pieces restored from a saved run.
const ID_PREFIX = Math.random().toString(36).slice(2, 7);
let nextId = 0;
export function makePiece(type: PieceType, square: Square | null = null): Piece {
  return { id: `${ID_PREFIX}-${nextId++}`, type, square };
}
