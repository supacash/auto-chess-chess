import { BOARD_8, type BoardSpec, parseSquare, squareName } from '../chess/boardSpec';
import { fenTurn, parsePlacement } from '../chess/fen';
import { fillGlyph, squareEl } from './boardDom';

export interface LastMove {
  from: string;
  to: string;
}

export interface RenderOptions {
  last?: LastMove;
  /** With a last move, slide the moved piece in over this many ms. */
  animateMs?: number;
  /** Highlight the king of the side to move as in check. */
  check?: boolean;
}

/** Read-only board that shows a running battle, sliding each moved piece into place. */
export class BattleView {
  private readonly boardEl: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `<div class="board battle" aria-label="Battle board"></div>`;
    this.boardEl = root.querySelector('.board')!;
  }

  /** Redraws the position from a FEN on a board of `spec`'s size. */
  render(fen: string, spec: BoardSpec = BOARD_8, { last, animateMs = 0, check = false }: RenderOptions = {}): void {
    const fromRect = last && animateMs > 0 ? this.cell(last.from)?.getBoundingClientRect() : undefined;
    const rows = parsePlacement(fen, spec.files); // top rank first
    const checkedColor = check ? fenTurn(fen) : null;

    this.boardEl.style.setProperty('--files', String(spec.files));
    this.boardEl.style.setProperty('--ranks', String(spec.ranks));
    this.boardEl.replaceChildren();
    for (let r = 0; r < spec.ranks; r++) {
      const rank = spec.ranks - 1 - r;
      for (let file = 0; file < spec.files; file++) {
        const cell = squareEl(file, rank);
        const name = squareName(file, rank);
        if (last && (name === last.from || name === last.to)) cell.classList.add('last');
        const occupant = rows[r]?.[file];
        if (occupant) {
          if (occupant.type === 'K' && occupant.color === checkedColor) cell.classList.add('check');
          const el = document.createElement('div');
          el.className = `piece ${occupant.color === 'w' ? 'white' : 'black'}`;
          fillGlyph(el, occupant.type);
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
    const { file, rank } = parseSquare(name);
    return this.boardEl.querySelector(`.square[data-file="${file}"][data-rank="${rank}"]`);
  }
}
