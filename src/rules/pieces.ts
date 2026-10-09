/** Maximum army size, king included. */
export const MAX_ARMY = 16;

/**
 * Every piece the game knows. The id is also the piece's FEN letter (white upper case, black lower
 * case), so it's what the engine, ffish and saves use.
 */
export type PieceType =
  // Standard chess
  | 'K'
  | 'Q'
  | 'R'
  | 'B'
  | 'N'
  | 'P'
  // Fairy pieces
  | 'E' // Berolina pawn
  | 'F' // Ferz
  | 'W' // Wazir
  | 'M' // Man
  | 'L' // Camel
  | 'G' // Grasshopper
  | 'X' // Cannon (Xiangqi)
  | 'T' // Centaur
  | 'A' // Archbishop
  | 'C' // Chancellor
  | 'Z'; // Amazon

export type PieceGroup = 'standard' | 'pawn' | 'utility' | 'chaos' | 'fusion';

export interface PieceDef {
  name: string;
  /** Points: the army budget and the material count use these. Fairy values are first estimates (see SIMULATION.md). */
  value: number;
  group: PieceGroup;
  /** How a fairy piece moves, in Betza notation, for Fairy-Stockfish's variants.ini. Standard pieces are built in. */
  betza?: string;
  /** Pawn-like: can't be placed on the back row, promotes on the last rank. */
  pawn?: boolean;
  /** One line for the shop and tooltips. */
  description: string;
}

export const PIECES: Record<PieceType, PieceDef> = {
  K: { name: 'King', value: 0, group: 'standard', description: 'Lose it and you lose the round.' },
  Q: { name: 'Queen', value: 9, group: 'standard', description: 'Slides any distance in all 8 directions.' },
  R: { name: 'Rook', value: 5, group: 'standard', description: 'Slides any distance straight.' },
  B: { name: 'Bishop', value: 3, group: 'standard', description: 'Slides any distance diagonally.' },
  N: { name: 'Knight', value: 3, group: 'standard', description: 'Jumps in an L shape.' },
  P: {
    name: 'Pawn',
    value: 1,
    group: 'standard',
    pawn: true,
    description: 'Moves straight ahead, captures diagonally.',
  },

  E: {
    name: 'Berolina pawn',
    value: 1,
    group: 'pawn',
    // Moves diagonally forward (two-step diagonal on its first move), captures straight ahead.
    betza: 'mfFcfWifmnF2',
    pawn: true,
    description: 'A reverse pawn: moves diagonally forward, captures straight ahead.',
  },
  F: { name: 'Ferz', value: 1, group: 'utility', betza: 'F', description: 'Steps one square diagonally.' },
  W: { name: 'Wazir', value: 1, group: 'utility', betza: 'W', description: 'Steps one square straight.' },
  M: { name: 'Man', value: 3, group: 'utility', betza: 'WF', description: 'Moves like a king, but can be captured.' },
  L: { name: 'Camel', value: 2, group: 'chaos', betza: 'C', description: 'Jumps three squares and one sideways.' },
  G: {
    name: 'Grasshopper',
    value: 1,
    group: 'chaos',
    betza: 'gQ',
    description: 'Moves like a queen but must hop over a piece, landing just beyond it.',
  },
  X: {
    name: 'Cannon',
    value: 3,
    group: 'chaos',
    betza: 'mRcpR',
    description: 'Moves like a rook; captures only by jumping over exactly one piece.',
  },
  T: { name: 'Centaur', value: 5, group: 'fusion', betza: 'KN', description: 'King and knight moves combined.' },
  A: { name: 'Archbishop', value: 7, group: 'fusion', betza: 'BN', description: 'Bishop and knight moves combined.' },
  C: { name: 'Chancellor', value: 8, group: 'fusion', betza: 'RN', description: 'Rook and knight moves combined.' },
  Z: { name: 'Amazon', value: 12, group: 'fusion', betza: 'QN', description: 'Queen and knight moves combined.' },
};

export const PIECE_TYPES = Object.keys(PIECES) as PieceType[];

export function isPieceType(v: unknown): v is PieceType {
  return typeof v === 'string' && v in PIECES;
}

export const PIECE_VALUE = Object.fromEntries(PIECE_TYPES.map((t) => [t, PIECES[t].value])) as Record<
  PieceType,
  number
>;

export const PIECE_NAME = Object.fromEntries(PIECE_TYPES.map((t) => [t, PIECES[t].name])) as Record<PieceType, string>;

export function isPawnLike(type: PieceType): boolean {
  return PIECES[type].pawn === true;
}

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

export function sameSquare(a: Square | null, b: Square | null): boolean {
  return a !== null && b !== null && a.file === b.file && a.rank === b.rank;
}

export function squareName(sq: Square): string {
  return String.fromCharCode(97 + sq.file) + (sq.rank + 1);
}

// Per-page-load prefix keeps ids unique against pieces restored from a saved run.
const ID_PREFIX = Math.random().toString(36).slice(2, 7);
let nextId = 0;
export function makePiece(type: PieceType, square: Square | null = null): Piece {
  return { id: `${ID_PREFIX}-${nextId++}`, type, square };
}
