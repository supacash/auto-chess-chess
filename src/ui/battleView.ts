import type { Chess } from 'chess.js';
import type { PieceType } from '../rules/pieces';
import { fillGlyph, squareEl } from './boardDom';

export interface LastMove {
  from: string;
  to: string;
}

/** Read-only board that shows a running battle, sliding each moved piece into place. */
export class BattleView {
  private readonly boardEl: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `<div class="board battle" aria-label="Battle board"></div>`;
    this.boardEl = root.querySelector('.board')!;
  }

  /** Redraws the position. With `animateMs`, the piece on `last.to` slides in from `last.from`. */
  render(chess: Chess, last?: LastMove, animateMs = 0): void {
    const fromRect = last && animateMs > 0 ? this.cell(last.from)?.getBoundingClientRect() : undefined;
    const checkedKing = chess.inCheck() ? chess.findPiece({ type: 'k', color: chess.turn() })[0] : undefined;

    this.boardEl.replaceChildren();
    const rows = chess.board(); // rank 8 first
    for (let r = 0; r < 8; r++) {
      const rank = 7 - r;
      for (let file = 0; file < 8; file++) {
        const cell = squareEl(file, rank);
        const name = 'abcdefgh'[file] + (rank + 1);
        if (last && (name === last.from || name === last.to)) cell.classList.add('last');
        if (name === checkedKing) cell.classList.add('check');
        const occupant = rows[r][file];
        if (occupant) {
          const el = document.createElement('div');
          el.className = `piece ${occupant.color === 'w' ? 'white' : 'black'}`;
          fillGlyph(el, occupant.type.toUpperCase() as PieceType);
          cell.appendChild(el);
        }
        this.boardEl.appendChild(cell);
      }
    }

    if (last && fromRect) {
      const pieceEl = this.cell(last.to)?.querySelector<HTMLElement>('.piece');
      const toRect = this.cell(last.to)?.getBoundingClientRect();
      if (pieceEl && toRect) {
        pieceEl.animate(
          [
            { transform: `translate(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px)`, zIndex: 5 },
            { transform: 'translate(0, 0)', zIndex: 5 },
          ],
          { duration: animateMs, easing: 'ease-out' },
        );
      }
    }
  }

  private cell(name: string): HTMLElement | null {
    const file = name.charCodeAt(0) - 97;
    const rank = Number(name[1]) - 1;
    return this.boardEl.querySelector(`.square[data-file="${file}"][data-rank="${rank}"]`);
  }
}
