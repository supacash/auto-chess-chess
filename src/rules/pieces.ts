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
  | 'Z' // Amazon
  | 'D' // Dragon King (rook + ferz)
  | 'H' // Dragon Horse (bishop + wazir)
  | 'U' // Wildebeest (knight + camel)
  | 'S' // Siege Cannon (cannon + bishop)
  | 'Y' // Stackman (three men)
  | 'J'; // Heir (three queens): a second king

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
  T: { name: 'Centaur', value: 5, group: 'fusion', betza: 'KN', description: 'Man and knight moves combined.' },
  A: { name: 'Archbishop', value: 7, group: 'fusion', betza: 'BN', description: 'Bishop and knight moves combined.' },
  C: { name: 'Chancellor', value: 8, group: 'fusion', betza: 'RN', description: 'Rook and knight moves combined.' },
  Z: { name: 'Amazon', value: 12, group: 'fusion', betza: 'QN', description: 'Queen and knight moves combined.' },
  D: {
    name: 'Dragon King',
    value: 7,
    group: 'fusion',
    betza: 'RF',
    description: 'Moves like a rook, or one step diagonally.',
  },
  H: {
    name: 'Dragon Horse',
    value: 5,
    group: 'fusion',
    betza: 'BW',
    description: 'Moves like a bishop, or one step straight.',
  },
  U: { name: 'Wildebeest', value: 5, group: 'fusion', betza: 'NC', description: 'Jumps like a knight or a camel.' },
  S: {
    name: 'Siege Cannon',
    value: 6,
    group: 'fusion',
    betza: 'mQcpQ',
    description: 'Moves like a queen; captures only by jumping over exactly one piece.',
  },
  Y: {
    name: 'Stackman',
    value: 9,
    group: 'fusion',
    betza: 'KNAD',
    description: 'Three men stacked up: jumps to any square up to two away, over anything in between.',
  },
  J: {
    name: 'Heir',
    value: 0,
    group: 'fusion',
    betza: 'K',
    description: 'A second king: one of the two must be captured before the other can be checkmated.',
  },
};

export const PIECE_TYPES = Object.keys(PIECES) as PieceType[];

export function isPieceType(v: unknown): v is PieceType {
  return typeof v === 'string' && v in PIECES;
}

export const PIECE_VALUE = Object.fromEntries(PIECE_TYPES.map((t) => [t, PIECES[t].value])) as Record<
  PieceType,
  number
>;

/**
 * What an Heir is worth in an army's points: the three Queens merged into it. In battle it counts 0
 * (like the King), so hiding it can't win a game on points; the army totals shown to the player (and
 * the AI's budget) count what it cost.
 */
export const HEIR_WORTH = 3 * PIECE_VALUE.Q;

/** An army's points as shown to the player: piece values, with an Heir at HEIR_WORTH. */
export function armyPoints(types: readonly PieceType[]): number {
  return types.reduce((sum, t) => sum + (t === 'J' ? HEIR_WORTH : PIECE_VALUE[t]), 0);
}

export const PIECE_NAME = Object.fromEntries(PIECE_TYPES.map((t) => [t, PIECES[t].name])) as Record<PieceType, string>;

export function isPawnLike(type: PieceType): boolean {
  return PIECES[type].pawn === true;
}

/** Board square: file 0-7 (a-h), rank 0-7 (rank 1-8). The player always owns ranks 0-2. */
export interface Square {
  file: number;
  rank: number;
}

/** The piece an affinity pawn merges toward: three with the same affinity make that piece. */
export type Affinity = 'N' | 'B' | 'R' | 'Q';
export const AFFINITIES: Affinity[] = ['N', 'B', 'R', 'Q'];

export function isAffinity(v: unknown): v is Affinity {
  return (AFFINITIES as unknown[]).includes(v);
}

export interface Piece {
  id: string;
  type: PieceType;
  /** null = on the bench (owned but not placed). */
  square: Square | null;
  /**
   * Only on a pawn bought as an affinity pawn ("Rook-pawn"). It fights as an ordinary pawn; the
   * affinity only matters in the shop (merging, selling).
   */
  affinity?: Affinity;
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
export function makePiece(type: PieceType, square: Square | null = null, affinity?: Affinity): Piece {
  const piece: Piece = { id: `${ID_PREFIX}-${nextId++}`, type, square };
  if (affinity) piece.affinity = affinity;
  return piece;
}
