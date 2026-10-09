import { fileLetter } from '../chess/boardSpec';
import type { PieceType } from '../rules/pieces';

// Each piece is a solid glyph (fill colour) with the outline glyph layered on top.
// U+FE0E forces text (not emoji) rendering, notably for the pawn on mobile.
const GLYPH: Record<PieceType, { solid: string; outline: string }> = {
  K: { solid: '♚︎', outline: '♔︎' },
  Q: { solid: '♛︎', outline: '♕︎' },
  R: { solid: '♜︎', outline: '♖︎' },
  B: { solid: '♝︎', outline: '♗︎' },
  N: { solid: '♞︎', outline: '♘︎' },
  P: { solid: '♟︎', outline: '♙︎' },
};

export function fillGlyph(el: HTMLElement, type: PieceType): void {
  el.replaceChildren(label('solid', GLYPH[type].solid), label('outline', GLYPH[type].outline));
}

/** Single-character glyph for inline text (e.g. the opponent's piece list). */
export function inlineGlyph(type: PieceType): string {
  return GLYPH[type].solid;
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
  cell.className = 'square ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
  cell.dataset.file = String(file);
  cell.dataset.rank = String(rank);
  if (file === 0) cell.appendChild(label('rank-label', String(rank + 1)));
  if (rank === 0) cell.appendChild(label('file-label', fileLetter(file)));
  return cell;
}
