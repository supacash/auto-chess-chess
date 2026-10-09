import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import { type Piece, type Square, PIECE_NAME } from '../rules/pieces';
import { movePiece, pieceAt, placementError } from '../rules/placement';
import { mirror } from '../rules/position';
import { fillPiece, label, squareEl } from './boardDom';

/** Pointer travel (px) before a press becomes a drag instead of a tap. */
const DRAG_THRESHOLD = 6;

type DropTarget = { kind: 'square'; sq: Square } | { kind: 'bench' };

interface Press {
  pieceId: string | null;
  x: number;
  y: number;
  dragging: boolean;
  ghost: HTMLElement | null;
}

export interface PlacementBoardOptions {
  onChange: (pieces: Piece[]) => void;
  onMessage: (text: string) => void;
  /** Called whenever the tap-selected piece changes (null = none). */
  onSelect?: (pieceId: string | null) => void;
}

/** Interactive placement board: drag or tap pieces between the bench and the home rows. */
export class PlacementBoard {
  private pieces: Piece[];
  /** The opponent's army (AI-local squares), shown read-only when revealed; null = hidden. */
  private enemy: Piece[] | null = null;
  private selected: string | null = null;
  private reportedSelection: string | null = null;
  private press: Press | null = null;
  private spec: BoardSpec = BOARD_8;
  private readonly boardEl: HTMLElement;
  private readonly benchEl: HTMLElement;

  constructor(
    root: HTMLElement,
    pieces: Piece[],
    private readonly opts: PlacementBoardOptions,
  ) {
    this.pieces = pieces;
    root.innerHTML = `
      <div class="board" aria-label="Chess board"></div>
      <div class="bench-label">Bench</div>
      <div class="bench" aria-label="Bench"></div>`;
    this.boardEl = root.querySelector('.board')!;
    this.benchEl = root.querySelector('.bench')!;

    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', () => this.cancelPress());
    this.render();
  }

  /** Replaces the pieces. The selection survives if the selected piece still exists. */
  setPieces(pieces: Piece[]): void {
    this.pieces = pieces;
    if (!pieces.some((p) => p.id === this.selected)) this.selected = null;
    this.render();
  }

  /** Switches the board size (e.g. when the board grows between rounds). */
  setSpec(spec: BoardSpec): void {
    this.spec = spec;
    this.render();
  }

  /** Shows the opponent's placed army in its rows, or hides it again with null. */
  setEnemy(pieces: Piece[] | null): void {
    this.enemy = pieces;
    this.render();
  }

  clearSelection(): void {
    this.selected = null;
    this.render();
  }

  // ---- rendering ----

  private render(): void {
    const active = this.press?.dragging ? this.press.pieceId : this.selected;
    const legal = active ? this.legalTargets(active) : new Set<string>();

    this.boardEl.replaceChildren();
    this.boardEl.classList.toggle('revealed', this.enemy !== null);
    const { files, ranks, homeRows } = this.spec;
    this.boardEl.style.setProperty('--files', String(files));
    this.boardEl.style.setProperty('--ranks', String(ranks));
    for (let rank = ranks - 1; rank >= 0; rank--) {
      for (let file = 0; file < files; file++) {
        const cell = squareEl(file, rank);
        if (rank < homeRows) cell.classList.add('home');
        else if (rank >= ranks - homeRows) cell.classList.add('enemy');
        if (legal.has(`${file},${rank}`)) cell.classList.add('legal');
        const piece = pieceAt(this.pieces, { file, rank });
        if (piece) cell.appendChild(this.pieceEl(piece));
        const foe = this.enemy?.find((p) => {
          if (!p.square) return false;
          const sq = mirror(p.square, this.spec);
          return sq.file === file && sq.rank === rank;
        });
        if (foe) cell.appendChild(enemyEl(foe));
        this.boardEl.appendChild(cell);
      }
    }

    this.benchEl.replaceChildren();
    const benched = this.pieces.filter((p) => !p.square);
    for (const p of benched) this.benchEl.appendChild(this.pieceEl(p));
    if (benched.length === 0) this.benchEl.appendChild(label('bench-empty', 'Drag pieces here to unplace'));
    this.benchEl.classList.toggle('legal', active !== null && this.pieces.some((p) => p.id === active && p.square));

    if (this.selected !== this.reportedSelection) {
      this.reportedSelection = this.selected;
      this.opts.onSelect?.(this.selected);
    }
  }

  private pieceEl(p: Piece): HTMLElement {
    const el = document.createElement('div');
    el.className = 'piece';
    if (p.id === this.selected) el.classList.add('selected');
    if (this.press?.dragging && p.id === this.press.pieceId) el.classList.add('drag-source');
    el.dataset.id = p.id;
    fillPiece(el, p.type);
    el.title = PIECE_NAME[p.type];
    return el;
  }

  private legalTargets(pieceId: string): Set<string> {
    const out = new Set<string>();
    for (let rank = 0; rank < this.spec.homeRows; rank++) {
      for (let file = 0; file < this.spec.files; file++) {
        if (movePiece(this.pieces, pieceId, { file, rank }, this.spec)) out.add(`${file},${rank}`);
      }
    }
    return out;
  }

  // ---- input ----

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const pieceEl = (e.target as HTMLElement).closest<HTMLElement>('.piece[data-id]');
    this.press = { pieceId: pieceEl?.dataset.id ?? null, x: e.clientX, y: e.clientY, dragging: false, ghost: null };
    if (pieceEl) e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    if (!press?.pieceId) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
      press.dragging = true;
      this.selected = null;
      const piece = this.pieces.find((p) => p.id === press.pieceId)!;
      press.ghost = document.createElement('div');
      press.ghost.className = 'piece ghost';
      fillPiece(press.ghost, piece.type);
      document.body.appendChild(press.ghost);
      this.render();
    }
    press.ghost!.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%)`;
  }

  private onPointerUp(e: PointerEvent): void {
    const press = this.press;
    if (!press) return;
    this.cancelPress();
    const target = dropTargetAt(e.clientX, e.clientY);

    if (press.dragging) {
      if (target) this.tryMove(press.pieceId!, target);
    } else {
      this.handleTap(press.pieceId, target);
    }
    this.render();
  }

  private cancelPress(): void {
    this.press?.ghost?.remove();
    const wasDragging = this.press?.dragging;
    this.press = null;
    if (wasDragging) this.render();
  }

  private handleTap(pieceId: string | null, target: DropTarget | null): void {
    if (pieceId) {
      if (this.selected === pieceId) this.selected = null;
      else if (this.selected && target?.kind === 'square' && this.tryMove(this.selected, target, true))
        this.selected = null;
      else this.selected = pieceId;
    } else if (this.selected && target) {
      if (this.tryMove(this.selected, target)) this.selected = null;
    } else {
      this.selected = null;
    }
  }

  /** Applies a move; reports why on failure unless `quiet`. */
  private tryMove(pieceId: string, target: DropTarget, quiet = false): boolean {
    const sq = target.kind === 'square' ? target.sq : null;
    const next = movePiece(this.pieces, pieceId, sq, this.spec);
    if (!next) {
      if (!quiet && sq) this.opts.onMessage(this.moveError(pieceId, sq));
      return false;
    }
    this.pieces = next;
    this.opts.onMessage('');
    this.opts.onChange(next);
    return true;
  }

  private moveError(pieceId: string, sq: Square): string {
    const mover = this.pieces.find((p) => p.id === pieceId)!;
    const own = placementError(mover.type, sq, this.spec);
    if (own) return own;
    const occupant = pieceAt(this.pieces, sq);
    if (occupant && mover.square) {
      return `Can't swap: ${PIECE_NAME[occupant.type]} — ${placementError(occupant.type, mover.square, this.spec)}`;
    }
    return "Can't move there";
  }
}

/** A read-only opponent piece: no data-id, so it can't be picked up. */
function enemyEl(p: Piece): HTMLElement {
  const el = document.createElement('div');
  el.className = 'piece black enemy-piece';
  fillPiece(el, p.type, 'b');
  el.title = `Opponent's ${PIECE_NAME[p.type]}`;
  return el;
}

function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = el?.closest<HTMLElement>('.square');
  if (cell) return { kind: 'square', sq: { file: Number(cell.dataset.file), rank: Number(cell.dataset.rank) } };
  if (el?.closest('.bench')) return { kind: 'bench' };
  return null;
}
