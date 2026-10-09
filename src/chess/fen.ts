import { PIECE_VALUE, type PieceType } from '../rules/pieces';

/** Pure FEN helpers that work on any board size (multi-digit empty runs, e.g. "10"). */

export type Color = 'w' | 'b';

export interface FenPiece {
  type: PieceType;
  color: Color;
}

/** Board rows from the top rank down; each row has `files` cells. */
export function parsePlacement(fen: string, files: number): (FenPiece | null)[][] {
  return fen
    .split(' ')[0]
    .split('/')
    .map((row) => {
      const cells: (FenPiece | null)[] = [];
      for (const m of row.matchAll(/(\d+)|([a-zA-Z])/g)) {
        if (m[1]) for (let i = 0; i < Number(m[1]); i++) cells.push(null);
        else {
          const ch = m[2];
          cells.push({ type: ch.toUpperCase() as PieceType, color: ch === ch.toUpperCase() ? 'w' : 'b' });
        }
      }
      while (cells.length < files) cells.push(null);
      return cells;
    });
}

/** FEN piece-placement field for a grid indexed [rank][file] with rank 0 at the bottom. */
export function placementField(grid: (FenPiece | null)[][]): string {
  const rows: string[] = [];
  for (let rank = grid.length - 1; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (const cell of grid[rank]) {
      if (!cell) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      row += cell.color === 'w' ? cell.type : cell.type.toLowerCase();
      empty = 0;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

export function fenTurn(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Total piece value per side (king excluded). */
export function material(fen: string): Record<Color, number> {
  const out: Record<Color, number> = { w: 0, b: 0 };
  for (const ch of fen.split(' ')[0]) {
    const v = PIECE_VALUE[ch.toUpperCase() as PieceType];
    if (v !== undefined) out[ch === ch.toUpperCase() ? 'w' : 'b'] += v;
  }
  return out;
}

/**
 * The position as black sees it: ranks reversed and colours swapped (files stay put, matching how
 * an army is mirrored onto the board). Used to show a battle to the player whose army is black.
 */
export function mirrorFen(fen: string, files: number): string {
  const swap = (c: FenPiece | null): FenPiece | null => c && { type: c.type, color: c.color === 'w' ? 'b' : 'w' };
  // parsePlacement lists the top rank first, which is the bottom rank once mirrored.
  const grid = parsePlacement(fen, files).map((row) => row.map(swap));
  const [, turn, ...rest] = fen.split(' ');
  return [placementField(grid), turn === 'b' ? 'w' : 'b', ...rest].join(' ');
}

/** A square name ("e2") on the mirrored board ("e7" on 8 ranks). */
export function mirrorSquare(name: string, ranks: number): string {
  const m = /^([a-z])(\d+)$/.exec(name);
  return m ? `${m[1]}${ranks + 1 - Number(m[2])}` : name;
}
