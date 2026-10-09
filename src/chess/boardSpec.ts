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

/** variants.ini content defining every board in `boards` for Fairy-Stockfish and ffish. */
export function variantsIni(boards: BoardSpec[] = BOARDS): string {
  return boards
    .map((b) =>
      [
        `[${b.variant}:chess]`,
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
