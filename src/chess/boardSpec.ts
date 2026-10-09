import { isPawnLike, PIECE_TYPES, PIECES } from '../rules/pieces';

/**
 * Board geometry. Every size is a Fairy-Stockfish variant with the game's rules: standard pieces,
 * no castling, pawn two-step from each side's second rank, promotion on the last rank.
 */
export interface BoardSpec {
  /** Fairy-Stockfish variant name (also used by ffish). */
  variant: string;
  files: number;
  ranks: number;
  /** Rows each side places pieces in, counted from its own back rank. */
  homeRows: number;
}

function square(n: number, homeRows: number): BoardSpec {
  return { variant: `acc${n}`, files: n, ranks: n, homeRows };
}

/** All boards the game uses, smallest first. */
export const BOARDS: BoardSpec[] = [square(5, 2), square(6, 2), square(7, 2), square(8, 3)];

export const BOARD_8 = BOARDS[BOARDS.length - 1];

export function fileLetter(file: number): string {
  return String.fromCharCode(97 + file);
}

/** "e4"-style name for a 0-based file/rank. Ranks past 9 are two digits ("a10"). */
export function squareName(file: number, rank: number): string {
  return fileLetter(file) + (rank + 1);
}

export function parseSquare(name: string): { file: number; rank: number } {
  return { file: name.charCodeAt(0) - 97, rank: Number(name.slice(1)) - 1 };
}

/** Fairy-Stockfish definitions for the fairy pieces (customPieceN = letter:betza), shared by every board. */
function customPieceLines(): string[] {
  const fairy = PIECE_TYPES.filter((t) => PIECES[t].betza);
  const pawns = PIECE_TYPES.filter(isPawnLike).map((t) => t.toLowerCase());
  return [
    ...fairy.map((t, i) => `customPiece${i + 1} = ${t.toLowerCase()}:${PIECES[t].betza}`),
    // Pawn-like fairy pieces (the Berolina pawn) promote on the last rank like pawns.
    `promotionPawnTypes = ${pawns.join('')}`,
  ];
}

/** variants.ini content defining every board in `boards` for Fairy-Stockfish and ffish. */
export function variantsIni(boards: BoardSpec[] = BOARDS): string {
  return boards
    .map((b) =>
      [
        `[${b.variant}:chess]`,
        ...customPieceLines(),
        `maxFile = ${fileLetter(b.files - 1)}`,
        `maxRank = ${b.ranks}`,
        'castling = false',
        `promotionRegionWhite = *${b.ranks}`,
        'promotionRegionBlack = *1',
        'doubleStepRegionWhite = *2',
        `doubleStepRegionBlack = *${b.ranks - 1}`,
      ].join('\n'),
    )
    .join('\n\n')
    .concat('\n');
}

/** Rounds played on each board before it grows: 5×5 rounds 1–2, 6×6 3–4, 7×7 5–6, then 8×8. */
export const ROUNDS_PER_BOARD = 2;

/** The board a round is played on. */
export function boardForRound(round: number): BoardSpec {
  return BOARDS[Math.min(BOARDS.length - 1, Math.floor((Math.max(1, round) - 1) / ROUNDS_PER_BOARD))];
}

/** Half-moves before a battle ends on points: 10 × board size + 10 (60 on 5×5 … 90 on 8×8). */
export function plyLimit(spec: BoardSpec): number {
  return 10 * Math.max(spec.files, spec.ranks) + 10;
}

/** How many squares a side can place pieces on. */
export function homeSquares(spec: BoardSpec): number {
  return spec.files * spec.homeRows;
}

/** Most pawns that fit (pawns can't stand on the back row). */
export function pawnSquares(spec: BoardSpec): number {
  return spec.files * (spec.homeRows - 1);
}
