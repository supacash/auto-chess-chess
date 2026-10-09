import { BOARD_8, type BoardSpec, parseSquare, squareName } from '../chess/boardSpec';
import { fenTurn, parsePlacement } from '../chess/fen';
import { displayColor, fillPiece, squareEl } from './boardDom';

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

/** Lets the player move: `legal` maps each movable square to its legal UCI moves. */
export interface BoardInput {
  legal: Map<string, string[]>;
  onPick: (from: string, to: string) => void;
}

/**
 * Board that shows a battle, sliding each moved piece into place. With setInput it also takes the
 * player's moves: tap a piece then a highlighted square, or drag the piece there.
 */
export class BattleView {
  private readonly boardEl: HTMLElement;
  private input: BoardInput | null = null;
  private selected: string | null = null;
  /** The square a press started on, to complete a drag on release. */
  private pressFrom: string | null = null;

  constructor(root: HTMLElement) {
    root.innerHTML = `<div class="board battle" aria-label="Battle board"></div>`;
    this.boardEl = root.querySelector('.board')!;
    this.boardEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.boardEl.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  /** Starts (or with null, stops) taking the player's moves. */
  setInput(input: BoardInput | null): void {
    this.input = input;
    this.selected = null;
    this.pressFrom = null;
    this.boardEl.classList.toggle('interactive', input !== null);
    this.paintSelection();
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.input || e.button !== 0) return;
    const sq = this.squareAt(e.target as Element | null);
    if (!sq) return;
    if (this.selected && this.targets(this.selected).includes(sq)) {
      this.pick(this.selected, sq);
      return;
    }
    if (this.input.legal.has(sq)) {
      e.preventDefault();
      this.selected = sq === this.selected ? null : sq;
      this.pressFrom = sq;
    } else {
      this.selected = null;
    }
    this.paintSelection();
  }

  private onPointerUp(e: PointerEvent): void {
    const from = this.pressFrom;
    this.pressFrom = null;
    if (!this.input || !from) return;
    const sq = this.squareAt(document.elementFromPoint(e.clientX, e.clientY));
    if (sq && sq !== from && this.targets(from).includes(sq)) this.pick(from, sq);
  }

  private pick(from: string, to: string): void {
    const input = this.input!;
    this.selected = null;
    this.paintSelection();
    input.onPick(from, to);
  }

  /** Destination squares of the legal moves from `from`. */
  private targets(from: string): string[] {
    return (this.input?.legal.get(from) ?? []).map((uci) => /^[a-z]\d+([a-z]\d+)/.exec(uci)![1]);
  }

  private squareAt(el: Element | null): string | null {
    const cell = el?.closest<HTMLElement>('.square');
    if (!cell || !this.boardEl.contains(cell)) return null;
    return squareName(Number(cell.dataset.file), Number(cell.dataset.rank));
  }

  private paintSelection(): void {
    const targets = new Set(this.selected ? this.targets(this.selected) : []);
    for (const cell of this.boardEl.querySelectorAll<HTMLElement>('.square')) {
      const name = squareName(Number(cell.dataset.file), Number(cell.dataset.rank));
      cell.classList.toggle('from', name === this.selected);
      cell.classList.toggle('legal', targets.has(name));
    }
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
          el.className = `piece ${displayColor(occupant.color) === 'w' ? 'white' : 'black'}`;
          fillPiece(el, occupant.type, occupant.color);
          cell.appendChild(el);
        }
        this.boardEl.appendChild(cell);
      }
    }
    this.paintSelection();

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
