import { fileLetter } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import { type Affinity, PIECE_NAME, type PieceType } from '../rules/pieces';

// Piece art: the Chessnut set by Alexis Luengas (Apache 2.0, see src/assets/pieces/README.md),
// bundled by Vite with hashed file names. Keys look like "../assets/pieces/wK.svg".
const ART = import.meta.glob<string>('../assets/pieces/*.svg', { eager: true, query: '?url', import: 'default' });

/**
 * Colours passed in here are sides in the game's FEN: 'w' is always the player, 'b' the opponent.
 * When the player plays Black this round, the art is swapped so their pieces look black.
 */
let playerColor: Color = 'w';

export function setPlayerColor(color: Color): void {
  playerColor = color;
}

/** The colour a side's pieces are drawn in. */
export function displayColor(side: Color): Color {
  if (playerColor === 'w') return side;
  return side === 'w' ? 'b' : 'w';
}

export function pieceUrl(type: PieceType, color: Color = 'w'): string {
  return ART[`../assets/pieces/${displayColor(color)}${type}.svg`];
}

/**
 * Puts the piece's image inside `el` (a board square's piece element, or the drag ghost). An
 * affinity pawn gets a small badge of the piece it merges toward.
 */
export function fillPiece(el: HTMLElement, type: PieceType, color: Color = 'w', affinity?: Affinity): void {
  const img = document.createElement('img');
  img.src = pieceUrl(type, color);
  img.alt = affinity ? `${PIECE_NAME[affinity]}-pawn` : PIECE_NAME[type];
  img.draggable = false;
  if (!affinity) {
    el.replaceChildren(img);
    return;
  }
  const badge = document.createElement('img');
  badge.className = 'affinity-badge';
  badge.src = pieceUrl(affinity, color);
  badge.alt = '';
  badge.draggable = false;
  el.replaceChildren(img, badge);
}

/** A small inline piece image as HTML, for text such as the opponent's piece list (with an affinity badge). */
export function inlinePiece(type: PieceType, color: Color = 'w', affinity?: Affinity): string {
  const img = `<img class="inline-piece" src="${pieceUrl(type, color)}" alt="${affinity ? `${PIECE_NAME[affinity]}-pawn` : PIECE_NAME[type]}" />`;
  if (!affinity) return img;
  return `<span class="inline-affinity">${img}<img class="affinity-badge" src="${pieceUrl(affinity, color)}" alt="" /></span>`;
}

export function label(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/** A board square with colour, data-file/data-rank and edge coordinate labels. Rank 0 is drawn at the bottom. */
export function squareEl(file: number, rank: number): HTMLElement {
  const cell = document.createElement('div');
  cell.className = `square ${(file + rank) % 2 === 0 ? 'dark' : 'light'}`;
  cell.dataset.file = String(file);
  cell.dataset.rank = String(rank);
  if (file === 0) cell.appendChild(label('rank-label', String(rank + 1)));
  if (rank === 0) cell.appendChild(label('file-label', fileLetter(file)));
  return cell;
}
