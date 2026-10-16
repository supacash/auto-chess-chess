import type { Color } from '../chess/fen';
import { movePattern } from '../rules/movePattern';
import { type Affinity, PIECE_NAME, type PieceType } from '../rules/pieces';
import { inlinePiece } from './boardDom';

/**
 * A small board showing how a piece moves, as HTML: the piece in the middle and a mark on every
 * square it reaches (a dot to move or capture, a ring to move only, a cross to capture only, a
 * diamond to land by hopping). An opponent's piece (black) moves down the board.
 */
export function moveDiagram(type: PieceType, color: Color = 'w', affinity?: Affinity): string {
  const grid = movePattern(type);
  const rows = color === 'b' ? [...grid].reverse() : grid;
  const size = grid.length;
  const mid = Math.floor(size / 2);
  const cells = rows
    .flatMap((row, r) =>
      row.map((reach, c) => {
        const shade = (r + c) % 2 === 0 ? 'light' : 'dark';
        if (r === mid && c === mid)
          return `<span class="md ${shade} md-piece">${inlinePiece(type, color, affinity)}</span>`;
        return `<span class="md ${shade}${reach ? ` md-${reach}` : ''}"></span>`;
      }),
    )
    .join('');
  return `<span class="move-diagram" style="--md:${size}" role="img" aria-label="How the ${PIECE_NAME[type]} moves">${cells}</span>`;
}
