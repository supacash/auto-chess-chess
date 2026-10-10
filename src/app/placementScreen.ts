import {
  buyOffer,
  canSetMerge,
  fusePieces,
  fuseSet,
  fusionOptions,
  PAWN_FUSION_COUNT,
  setMergePartners,
  setMergeResults,
  REROLL_COST,
  type ShopResult,
  sellPiece,
  sellValue,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from '../rules/economy';
import { isPawnLike, type Piece, PIECE_NAME, PIECE_VALUE, PIECES, type PieceType } from '../rules/pieces';
import { armyCap, BENCH_SIZE, benchCount } from '../rules/placement';
import { PlacementBoard } from '../ui/board';
import { inlinePiece, setPlayerColor } from '../ui/boardDom';
import { $, escapeHtml } from './dom';
import type { PlacementSession } from './placementSession';

/** King first, then most to least valuable. */
const pieceOrder = (a: PieceType, b: PieceType) =>
  Number(b === 'K') - Number(a === 'K') || PIECE_VALUE[b] - PIECE_VALUE[a];

/** How the screen is being used: a single-player run, or a multiplayer match (one Ready button). */
export interface PlacementMode {
  /** Redraws the header for this session (run stats, or the match's players). */
  header: () => void;
  /** In a match, the main button reads Ready and calls this instead of Auto fight. */
  onReady?: () => void;
}

/** The placement screen: board, bench, shop, opponent preview, and the Play it / Auto fight buttons. */
export class PlacementScreen {
  private readonly section = $('#placement');
  private readonly message = $('#message');
  private readonly fightBtn = $<HTMLButtonElement>('#fight');
  private readonly playBtn = $<HTMLButtonElement>('#play');
  private readonly board: PlacementBoard;
  private selected: string | null = null;
  /** Picking the pawns to fuse: the ones circled so far (in order), or null when not picking. */
  private fusing: string[] | null = null;
  /** The shop offer being looked at (its index), shown with its description and a Buy button. */
  private selectedOffer: number | null = null;
  /** The opponent piece type whose description is showing. */
  private foeInfo: PieceType | null = null;
  private busy = false;
  /** Variant of the board last shown, to announce when it grows. */
  private shownBoard: string | null = null;
  private mode: PlacementMode;
  /** Called with each piece gained in the shop (bought, upgraded into or fused), for records. */
  onGained: ((type: PieceType) => void) | null = null;

  constructor(
    private session: PlacementSession,
    header: () => void,
    onFight: () => void,
    onPlay: () => void,
    onReplay: () => void,
  ) {
    this.mode = { header };
    this.board = new PlacementBoard($('#board-root'), session.run.shop.pieces, {
      onChange: (pieces) => this.piecesChanged(pieces),
      onMessage: (text) => this.setMessage(text),
      onFoeTap: (type) => this.toggleFoeInfo(type),
      onSelect: (id) => {
        this.selected = id;
        if (id) this.selectedOffer = null;
        this.renderShop();
      },
      onPick: (id) => this.togglePick(id),
    });

    $('#clear').addEventListener('click', () => {
      const pieces = this.session.run.shop.pieces.map((p) => ({ ...p, square: null }));
      this.board.setPieces(pieces);
      this.setMessage('');
      this.piecesChanged(pieces);
    });
    $('#piece-actions').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      const shop = this.session.run.shop;
      if (this.fusing) {
        if (btn.hasAttribute('data-cancel-fuse')) this.stopFusing();
        else if (btn.dataset.fuseTo) {
          const to = btn.dataset.fuseTo as PieceType;
          const picked = this.fusing;
          this.stopFusing();
          this.applyShop(fuseSet(shop, picked, to, this.session.run.settings.fairy), to);
        }
        return;
      }
      if (!this.selected) return;
      if (btn.dataset.upgrade) {
        const to = btn.dataset.upgrade as PieceType;
        this.applyShop(upgradePiece(shop, this.selected, to), to);
      } else if (btn.dataset.fuse && btn.dataset.result) {
        const to = btn.dataset.result as PieceType;
        this.applyShop(fusePieces(shop, this.selected, btn.dataset.fuse, to, this.session.run.settings.fairy), to);
      } else if (btn.hasAttribute('data-fuse-pawns')) {
        this.startFusing(this.selected);
      } else if (btn.hasAttribute('data-sell')) this.applyShop(sellPiece(shop, this.selected));
    });
    // Tapping an opponent piece in the list explains what it does (the board reports taps via onFoeTap).
    $('#opponent').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-foe]');
      if (el) this.toggleFoeInfo(el.dataset.foe as PieceType);
    });
    $('#offers').addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-offer]');
      if (!card) return;
      const index = Number(card.dataset.offer);
      this.selectedOffer = this.selectedOffer === index ? null : index;
      if (this.selectedOffer !== null) {
        this.stopFusing();
        this.deselectPiece();
      }
      this.renderShop();
    });
    $('#offer-detail').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button[data-buy]') || this.selectedOffer === null) return;
      const index = this.selectedOffer;
      this.selectedOffer = null;
      this.applyShop(buyOffer(this.session.run.shop, index), this.session.run.shop.offers?.[index]);
    });
    $('#reroll').addEventListener('click', () => {
      this.selectedOffer = null;
      this.applyShop(this.session.rerollOffers());
    });
    this.fightBtn.addEventListener('click', () => (this.mode.onReady ? this.mode.onReady() : onFight()));
    this.playBtn.addEventListener('click', onPlay);
    $('#last-replay').addEventListener('click', onReplay);
  }

  /** Switches what's being played (a run, or a match); takes effect on the next show(). */
  use(session: PlacementSession, mode: PlacementMode): void {
    this.session = session;
    this.mode = mode;
    this.resetForNewRun();
  }

  /** Shows the screen for the session's current round. */
  show(): void {
    const match = this.mode.onReady !== undefined;
    this.playBtn.hidden = match;
    $('#clear').hidden = false;
    this.fightBtn.textContent = match ? 'Ready' : 'Auto fight';
    this.section.hidden = false;
    $('#last-replay').hidden = !this.session.lastReplay;
    const spec = this.session.board;
    const grew = this.shownBoard !== null && this.shownBoard !== spec.variant;
    this.shownBoard = spec.variant;
    this.setMessage('');
    const notice = $('#notice');
    notice.hidden = !grew;
    notice.textContent = grew ? `The board grew to ${spec.files}×${spec.ranks}: more room for your army!` : '';

    this.session.fitPiecesToBoard();
    setPlayerColor(this.session.run.color);
    this.board.setSpec(spec);
    this.board.setPieces(this.session.run.shop.pieces);
    const opponent = this.session.opponent();
    this.board.setEnemy(this.session.run.settings.reveal && opponent ? opponent.pieces : null);
    this.renderOpponent();
    this.mode.header();
    this.piecesChanged(this.session.run.shop.pieces);
  }

  hide(): void {
    this.section.hidden = true;
  }

  /** A new run's first board isn't "growth", and nothing is selected. */
  resetForNewRun(): void {
    this.shownBoard = null;
    this.selected = null;
    this.selectedOffer = null;
    this.stopFusing();
  }

  // ---- picking the pieces for a three-piece merge ----

  /** Starts picking pieces to merge, with `pieceId` and its default partners circled (see setMergePartners). */
  private startFusing(pieceId: string): void {
    const partners = setMergePartners(this.session.run.shop, pieceId) ?? [];
    this.fusing = [pieceId, ...partners.map((p) => p.id)];
    this.selected = null;
    this.selectedOffer = null;
    this.syncPicking();
  }

  private stopFusing(): void {
    if (!this.fusing) return;
    this.fusing = null;
    this.board.setPicking(null);
    this.renderShop();
  }

  /** Circles or un-circles a piece (at most PAWN_FUSION_COUNT). */
  private togglePick(id: string): void {
    if (!this.fusing) return;
    if (this.fusing.includes(id)) this.fusing = this.fusing.filter((x) => x !== id);
    else if (this.fusing.length < PAWN_FUSION_COUNT) this.fusing = [...this.fusing, id];
    else this.setMessage(`${PAWN_FUSION_COUNT} pieces are picked: tap one to swap it out.`);
    this.syncPicking();
  }

  private syncPicking(): void {
    if (!this.fusing) return;
    const parts = this.session.run.shop.pieces.filter((p) => canSetMerge(p.type));
    this.board.setPicking({ pickable: new Set(parts.map((p) => p.id)), picked: new Set(this.fusing) });
    this.renderShop();
  }

  /** The merge panel: what's picked, what it can become, and Cancel. */
  private renderFusing(picked: string[]): string {
    const { pieces } = this.session.run.shop;
    const types = picked.map((id) => pieces.find((p) => p.id === id)!.type);
    const chosen = types.length ? types.map((t) => inlinePiece(t)).join('') : 'none yet';
    const results = setMergeResults(types, this.session.run.settings.fairy);
    const missing = PAWN_FUSION_COUNT - types.length;
    const buttons = results.length
      ? results
          .map(
            (to) =>
              `<button type="button" class="fuse" data-fuse-to="${to}">→ ${inlinePiece(to)} ${PIECE_NAME[to]}</button>`,
          )
          .join('')
      : `<span class="hint">${missing > 0 ? `Pick ${missing} more.` : 'These don’t merge: pick 3 pawns, or a knight or bishop and 2 pawns.'}</span>`;
    return (
      `<p class="piece-info"><strong>Merge ${PAWN_FUSION_COUNT} pieces</strong> · tap pieces on the board or bench to pick them (${picked.length}/${PAWN_FUSION_COUNT}): ${chosen}</p>` +
      `${buttons}<button type="button" data-cancel-fuse>Cancel</button>`
    );
  }

  setMessage(text: string): void {
    this.message.textContent = text;
  }

  /** While a battle is starting, Fight is disabled and nothing stays selected. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) {
      this.stopFusing();
      this.board.clearSelection();
    }
    this.updateFight();
  }

  private piecesChanged(pieces: Piece[]): void {
    this.session.setPieces(pieces);
    const placed = pieces.filter((p) => p.square);
    const points = placed.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
    $('#points').textContent =
      `On the board ${placed.length}/${armyCap(this.session.board)} · bench ${benchCount(pieces)}/${BENCH_SIZE} · ${points} pts`;
    this.updateFight();
    this.renderShop();
  }

  private updateFight(): void {
    const errors = this.session.armyErrors();
    for (const btn of [this.fightBtn, this.playBtn]) {
      btn.disabled = this.busy || errors.length > 0;
      btn.title = errors.join('\n');
    }
    const hint = $('#fight-hint');
    hint.hidden = this.busy || errors.length === 0;
    hint.textContent = errors[0] ?? '';
  }

  private renderOpponent(): void {
    const opponent = this.session.opponent();
    this.foeInfo = null;
    if (!opponent) {
      $('#opponent').textContent = 'Your opponent is revealed when the round starts.';
      this.renderFoeInfo();
      return;
    }
    const label = this.mode.onReady ? 'Next opponent' : 'Opponent';
    const name = escapeHtml(opponent.name);
    if (opponent.pieces.length === 0) {
      $('#opponent').innerHTML = `${label} · <strong>${name}</strong>: nothing placed yet`;
      this.renderFoeInfo();
      return;
    }
    const types = opponent.pieces.map((p) => p.type).sort(pieceOrder);
    const points = types.reduce((s, t) => s + PIECE_VALUE[t], 0);
    $('#opponent').innerHTML =
      `${label} · <strong>${name}</strong>: ` +
      `<span class="glyphs">${types
        .map(
          (t) =>
            `<button type="button" class="foe" data-foe="${t}" aria-label="What does the ${PIECE_NAME[t]} do?">${inlinePiece(t, 'b')}</button>`,
        )
        .join('')}</span> · ${points} pts`;
    this.renderFoeInfo();
  }

  /** Redraws the opponent line (e.g. when a multiplayer opponent's preview changes). */
  refreshOpponent(): void {
    if (this.section.hidden) return;
    const shown = this.foeInfo;
    this.renderOpponent();
    if (shown) this.toggleFoeInfo(shown);
  }

  private toggleFoeInfo(type: PieceType): void {
    this.foeInfo = this.foeInfo === type ? null : type;
    this.renderFoeInfo();
  }

  private renderFoeInfo(): void {
    const info = $('#opponent-info');
    const type = this.foeInfo;
    info.hidden = !type;
    for (const el of document.querySelectorAll<HTMLElement>('#opponent [data-foe]')) {
      el.classList.toggle('active', el.dataset.foe === type);
    }
    if (!type) return;
    info.innerHTML = `${inlinePiece(type, 'b')} <strong>${PIECE_NAME[type]}</strong> · ${PIECE_VALUE[type]} pts. ${PIECES[type].description}`;
  }

  private deselectPiece(): void {
    this.selected = null;
    this.board.clearSelection();
  }

  /** The offer cards, and the selected offer's description and Buy button. */
  private renderOffers(): void {
    const { gold, pieces, offers = [] } = this.session.run.shop;
    if (this.selectedOffer !== null && this.selectedOffer >= offers.length) this.selectedOffer = null;
    $<HTMLButtonElement>('#reroll').disabled = gold < REROLL_COST;
    $('#offers').innerHTML = offers.length
      ? offers
          .map((t, i) => {
            const cls = ['offer', i === this.selectedOffer ? 'selected' : '', gold < PIECE_VALUE[t] ? 'pricey' : '']
              .filter(Boolean)
              .join(' ');
            return `<button type="button" class="${cls}" data-offer="${i}" aria-pressed="${i === this.selectedOffer}">${inlinePiece(t)}<span class="offer-name">${PIECE_NAME[t]}</span><span class="offer-price">${PIECE_VALUE[t]}g</span></button>`;
          })
          .join('')
      : '<span class="hint">Sold out. Reroll for more.</span>';

    const detail = $('#offer-detail');
    const type = this.selectedOffer === null ? undefined : offers[this.selectedOffer];
    detail.hidden = !type;
    if (!type) return;
    const price = PIECE_VALUE[type];
    const full = benchCount(pieces) >= BENCH_SIZE;
    const disabled = gold < price || full ? 'disabled' : '';
    detail.innerHTML = `<p><strong>${PIECE_NAME[type]}</strong> · ${price} pts. ${PIECES[type].description}</p><button type="button" class="primary" data-buy ${disabled}>${full ? 'Bench full' : `Buy · ${price}g`}</button>`;
  }

  /** Gold, the buy button, offers, and upgrade/fuse/sell buttons for the selected piece. */
  private renderShop(): void {
    this.renderOffers();
    const { gold, pieces } = this.session.run.shop;
    $('#gold').textContent = `${gold}g`;

    const actions = $('#piece-actions');
    if (this.fusing) {
      // Pawns sold or moved away meanwhile drop out of the pick.
      this.fusing = this.fusing.filter((id) => pieces.some((p) => p.id === id));
      actions.innerHTML = this.renderFusing(this.fusing);
      return;
    }
    const piece = pieces.find((p) => p.id === this.selected);
    if (!piece) {
      actions.innerHTML = `<span class="hint">Tap a piece to merge, upgrade or sell it.</span>`;
      return;
    }
    const upgrades = UPGRADES[piece.type]
      .map((to) => {
        const cost = upgradeCost(piece.type, to);
        const disabled = gold < cost ? 'disabled' : '';
        return `<button type="button" data-upgrade="${to}" ${disabled}>${inlinePiece(to)} ${PIECE_NAME[to]} · ${cost}g</button>`;
      })
      .join('');
    const sell =
      piece.type === 'K'
        ? ''
        : `<button type="button" class="sell" data-sell>Sell · +${sellValue(piece.type)}g</button>`;
    // Merging is free: the selected piece becomes the result where it stands, and the partner is used up.
    const fusions = fusionOptions(this.session.run.shop, piece.id, this.session.run.settings.fairy)
      .map(({ partnerId, result }) => {
        const partner = pieces.find((p) => p.id === partnerId)!;
        return `<button type="button" class="fuse" data-fuse="${partnerId}" data-result="${result}" title="Uses up a ${PIECE_NAME[partner.type]}">+ ${inlinePiece(partner.type)} → ${inlinePiece(result)} ${PIECE_NAME[result]}</button>`;
      })
      .join('');
    // Three-piece merges (3 pawns, or a minor piece + 2 pawns): open the picker to choose which pieces.
    const partners = setMergePartners(this.session.run.shop, piece.id);
    const setResults = partners
      ? setMergeResults([piece.type, ...partners.map((p) => p.type)], this.session.run.settings.fairy)
      : [];
    const setLabel = isPawnLike(piece.type) ? `${PAWN_FUSION_COUNT} pawns` : 'with 2 pawns';
    const pawnFusions = setResults.length
      ? `<button type="button" class="fuse" data-fuse-pawns title="Choose the pieces to merge">Merge ${setLabel}… → ${setResults.map((t) => inlinePiece(t)).join(' ')}</button>`
      : '';
    actions.innerHTML =
      `<p class="piece-info"><strong>${PIECE_NAME[piece.type]}</strong> · ${PIECE_VALUE[piece.type]} pts. ${PIECES[piece.type].description}</p>` +
      `${fusions}${pawnFusions}${upgrades}${sell}`;
  }

  /** Applies a shop action, or shows why it failed. */
  private applyShop(result: ShopResult, gained?: PieceType): void {
    if (!result.ok) {
      this.setMessage(result.error);
      return;
    }
    if (gained) this.onGained?.(gained);
    this.setMessage('');
    this.session.setShop(result.shop);
    this.board.setPieces(result.shop.pieces);
    this.piecesChanged(result.shop.pieces);
  }
}
