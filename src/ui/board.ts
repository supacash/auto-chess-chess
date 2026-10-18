import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import { type Piece, type PieceType, type Square, PIECE_NAME } from '../rules/pieces';
import { movePiece, pieceAt, placementError, capacityError } from '../rules/placement';
import { mirror } from '../rules/position';
import { fillPiece, label, pieceUrl, squareEl } from './boardDom';

/** Pointer travel (px) before a press becomes a drag instead of a tap. */
const DRAG_THRESHOLD = 6;
/** How long a new piece (bought or merged) or one just put down keeps its arrival animation. */
const POP_MS = 400;

type DropTarget = { kind: 'square'; sq: Square } | { kind: 'bench' };

interface Press {
  /** The pointer (finger) this press belongs to: other fingers are ignored until it lifts. */
  pointerId: number;
  pieceId: string | null;
  /** The opponent piece type pressed, if any (revealed opponents only). */
  foe: PieceType | null;
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
  /** Called when an opponent piece is tapped (with Reveal on) while nothing is selected. */
  onFoeTap?: (type: PieceType) => void;
}

/** Interactive placement board: drag or tap pieces between the bench and the home rows. */
export class PlacementBoard {
  private pieces: Piece[];
  /** The opponent's army (AI-local squares), shown read-only when revealed; null = hidden. */
  private enemy: Piece[] | null = null;
  /** Pieces a synergy upgrades for the battle (by id, mine and the revealed opponent's), and what they fight as. */
  private upgrades: ReadonlyMap<string, PieceType> = new Map();
  private selected: string | null = null;
  /** A square a move was refused on, flashed for a moment so the reason (onMessage) is noticed. */
  private rejected: Square | null = null;
  private rejectedTimer = 0;
  private reportedSelection: string | null = null;
  /** Pieces still playing their arrival animation (new ones pop in, moved ones land), until when. */
  private readonly popping = new Map<string, number>();
  private landed: { id: string; until: number } | null = null;
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
    window.addEventListener('pointercancel', (e) => {
      if (!this.press || e.pointerId === this.press.pointerId) this.cancelPress();
    });
    // Switching apps mid-drag can swallow the pointerup: drop the drag rather than leave a ghost.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancelPress();
    });
    this.render();
  }

  /** Replaces the pieces. The selection survives if the selected piece still exists. */
  setPieces(pieces: Piece[]): void {
    // Pieces that weren't here before (bought, or made by a merge) pop in.
    const before = new Set(this.pieces.map((p) => p.id));
    const until = performance.now() + POP_MS;
    for (const p of pieces) if (!before.has(p.id)) this.popping.set(p.id, until);
    this.pieces = pieces;
    if (!pieces.some((p) => p.id === this.selected)) this.selected = null;
    this.render();
  }

  /** Switches the board size (e.g. when the board grows between rounds); `grew` plays a short flourish. */
  setSpec(spec: BoardSpec, grew = false): void {
    this.spec = spec;
    this.render();
    if (!grew) return;
    this.boardEl.classList.remove('grew');
    void this.boardEl.offsetWidth; // restart the animation
    this.boardEl.classList.add('grew');
  }

  /** Shows the opponent's placed army in its rows, or hides it again with null. */
  setEnemy(pieces: Piece[] | null): void {
    this.enemy = pieces;
    this.render();
  }

  /** Marks the pieces a synergy upgrades for the battle (by id, either side's), with what each fights as. */
  setUpgrades(upgrades: ReadonlyMap<string, PieceType>): void {
    this.upgrades = upgrades;
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
        if (this.rejected?.file === file && this.rejected.rank === rank) cell.classList.add('rejected');
        const piece = pieceAt(this.pieces, { file, rank });
        if (piece) cell.appendChild(this.pieceEl(piece));
        const foe = this.enemy?.find((p) => {
          if (!p.square) return false;
          const sq = mirror(p.square, this.spec);
          return sq.file === file && sq.rank === rank;
        });
        if (foe) cell.appendChild(enemyEl(foe, this.upgrades.get(foe.id)));
        this.boardEl.appendChild(cell);
      }
    }

    this.benchEl.replaceChildren();
    const benched = this.pieces.filter((p) => !p.square);
    for (const p of benched) this.benchEl.appendChild(this.pieceEl(p));
    if (benched.length === 0)
      this.benchEl.appendChild(label('bench-empty', 'Empty: drag a piece here to take it off the board'));
    this.benchEl.classList.toggle('legal', active !== null && this.pieces.some((p) => p.id === active && p.square));

    if (this.selected !== this.reportedSelection) {
      this.reportedSelection = this.selected;
      this.opts.onSelect?.(this.selected);
    }
  }

  private pieceEl(p: Piece): HTMLElement {
    const el = document.createElement('div');
    el.className = 'piece';
    const now = performance.now();
    const pop = this.popping.get(p.id);
    if (pop !== undefined) {
      if (now < pop) el.classList.add('fresh');
      else this.popping.delete(p.id);
    }
    if (this.landed?.id === p.id && now < this.landed.until) el.classList.add('landed');
    if (p.id === this.selected) el.classList.add('selected');
    if (this.press?.dragging && p.id === this.press.pieceId) el.classList.add('drag-source');
    el.dataset.id = p.id;
    fillPiece(el, p.type, 'w', p.affinity);
    el.title = p.affinity ? `${PIECE_NAME[p.affinity]}-pawn` : PIECE_NAME[p.type];
    const to = p.square ? this.upgrades.get(p.id) : undefined;
    if (to) addUpgradeBadge(el, to, 'w');
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
    if (this.press) {
      // A second finger while one is already down is ignored: taking it over used to orphan the first
      // finger's drag ghost, which then stayed stuck on screen. A new primary pointer means no other
      // finger is down, so the old press lost its pointerup: clear it and start over.
      if (!e.isPrimary) return;
      this.cancelPress();
    }
    const pieceEl = (e.target as HTMLElement).closest<HTMLElement>('.piece[data-id]');
    const foe = ((e.target as HTMLElement).closest<HTMLElement>('[data-foe]')?.dataset.foe as PieceType) ?? null;
    this.press = {
      pointerId: e.pointerId,
      pieceId: pieceEl?.dataset.id ?? null,
      foe,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
      ghost: null,
    };
    if (pieceEl) e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    if (!press?.pieceId || e.pointerId !== press.pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
      press.dragging = true;
      this.selected = null;
      const piece = this.pieces.find((p) => p.id === press.pieceId)!;
      press.ghost = document.createElement('div');
      press.ghost.className = 'piece ghost';
      fillPiece(press.ghost, piece.type, 'w', piece.affinity);
      document.body.appendChild(press.ghost);
      this.render();
    }
    press.ghost!.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%)`;
  }

  private onPointerUp(e: PointerEvent): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.cancelPress();
    const target = dropTargetAt(e.clientX, e.clientY);

    if (press.dragging) {
      if (target) this.tryMove(press.pieceId!, target);
    } else if (press.foe && !this.selected) {
      this.opts.onFoeTap?.(press.foe);
    } else {
      this.handleTap(press.pieceId, target);
    }
    this.render();
  }

  private cancelPress(): void {
    this.press?.ghost?.remove();
    // Belt and braces: no ghost may outlive its press.
    for (const ghost of document.querySelectorAll('.piece.ghost')) ghost.remove();
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
      if (!quiet) {
        this.opts.onMessage(this.moveError(pieceId, sq));
        this.flashRejected(sq);
      }
      return false;
    }
    this.pieces = next;
    this.landed = { id: pieceId, until: performance.now() + POP_MS };
    this.opts.onMessage('');
    this.opts.onChange(next);
    return true;
  }

  private flashRejected(sq: Square | null): void {
    clearTimeout(this.rejectedTimer);
    this.rejected = sq;
    this.rejectedTimer = window.setTimeout(() => {
      this.rejected = null;
      this.render();
    }, 700);
  }

  private moveError(pieceId: string, sq: Square | null): string {
    const full = capacityError(this.pieces, pieceId, sq, this.spec);
    if (full) return full;
    if (!sq) return "Can't move there";
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
function enemyEl(p: Piece, upgrade?: PieceType): HTMLElement {
  const el = document.createElement('div');
  el.className = 'piece black enemy-piece';
  fillPiece(el, p.type, 'b');
  el.title = `Opponent's ${PIECE_NAME[p.type]}`;
  el.dataset.foe = p.type;
  if (upgrade) addUpgradeBadge(el, upgrade, 'b');
  return el;
}

/** A small picture of what a piece fights as this battle (a synergy upgrade), in its top corner. */
function addUpgradeBadge(el: HTMLElement, to: PieceType, color: 'w' | 'b'): void {
  const badge = document.createElement('img');
  badge.className = 'upgrade-badge';
  badge.src = pieceUrl(to, color);
  badge.alt = '';
  badge.draggable = false;
  el.appendChild(badge);
  el.classList.add('upgraded');
  el.title += ` · fights as a ${PIECE_NAME[to]} (synergy)`;
}

function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = el?.closest<HTMLElement>('.square');
  if (cell) return { kind: 'square', sq: { file: Number(cell.dataset.file), rank: Number(cell.dataset.rank) } };
  if (el?.closest('.bench')) return { kind: 'bench' };
  return null;
}
