import { homeSquares, pawnSquares } from '../chess/boardSpec';
import {
  buyOffer,
  buyPawn,
  fusePieces,
  fusionOptions,
  REROLL_COST,
  PAWN_COST,
  type ShopResult,
  sellPiece,
  sellValue,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from '../rules/economy';
import { isPawnLike, MAX_ARMY, type Piece, PIECE_NAME, PIECE_VALUE, PIECES, type PieceType } from '../rules/pieces';
import { PlacementBoard } from '../ui/board';
import { inlinePiece, setPlayerColor } from '../ui/boardDom';
import { $ } from './dom';
import { renderHeader } from './header';
import type { Session } from './session';

/** King first, then most to least valuable. */
const pieceOrder = (a: PieceType, b: PieceType) =>
  Number(b === 'K') - Number(a === 'K') || PIECE_VALUE[b] - PIECE_VALUE[a];

/** The placement screen: board, bench, shop, opponent preview and the Fight button. */
export class PlacementScreen {
  private readonly section = $('#placement');
  private readonly message = $('#message');
  private readonly fightBtn = $<HTMLButtonElement>('#fight');
  private readonly board: PlacementBoard;
  private selected: string | null = null;
  /** The shop offer being looked at (its index), shown with its description and a Buy button. */
  private selectedOffer: number | null = null;
  private busy = false;
  /** Variant of the board last shown, to announce when it grows. */
  private shownBoard: string | null = null;

  constructor(
    private readonly session: Session,
    onFight: () => void,
  ) {
    this.board = new PlacementBoard($('#board-root'), session.run.shop.pieces, {
      onChange: (pieces) => this.piecesChanged(pieces),
      onMessage: (text) => this.setMessage(text),
      onSelect: (id) => {
        this.selected = id;
        if (id) this.selectedOffer = null;
        this.renderShop();
      },
    });

    $('#clear').addEventListener('click', () => {
      const pieces = this.session.run.shop.pieces.map((p) => ({ ...p, square: null }));
      this.board.setPieces(pieces);
      this.setMessage('');
      this.piecesChanged(pieces);
    });
    $('#buy-pawn').addEventListener('click', () => this.applyShop(buyPawn(this.session.run.shop)));
    $('#piece-actions').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn || !this.selected) return;
      const shop = this.session.run.shop;
      if (btn.dataset.upgrade) this.applyShop(upgradePiece(shop, this.selected, btn.dataset.upgrade as PieceType));
      else if (btn.dataset.fuse) this.applyShop(fusePieces(shop, this.selected, btn.dataset.fuse));
      else if (btn.hasAttribute('data-sell')) this.applyShop(sellPiece(shop, this.selected));
    });
    $('#offers').addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-offer]');
      if (!card) return;
      const index = Number(card.dataset.offer);
      this.selectedOffer = this.selectedOffer === index ? null : index;
      if (this.selectedOffer !== null) this.deselectPiece();
      this.renderShop();
    });
    $('#offer-detail').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button[data-buy]') || this.selectedOffer === null) return;
      const index = this.selectedOffer;
      this.selectedOffer = null;
      this.applyShop(buyOffer(this.session.run.shop, index));
    });
    $('#reroll').addEventListener('click', () => {
      this.selectedOffer = null;
      this.applyShop(this.session.rerollOffers());
    });
    this.fightBtn.addEventListener('click', onFight);
  }

  /** Shows the screen for the session's current round. */
  show(): void {
    this.section.hidden = false;
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
    this.board.setEnemy(this.session.run.settings.reveal ? this.session.aiPieces : null);
    this.renderOpponent();
    renderHeader(this.session);
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
  }

  setMessage(text: string): void {
    this.message.textContent = text;
  }

  /** While a battle is starting, Fight is disabled and nothing stays selected. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.board.clearSelection();
    this.updateFight();
  }

  private piecesChanged(pieces: Piece[]): void {
    this.session.setPieces(pieces);
    const placed = pieces.filter((p) => p.square);
    const points = placed.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
    $('#points').textContent =
      `${placed.length}/${homeSquares(this.session.board)} squares filled · ${points} pts on board · army ${pieces.length}/${MAX_ARMY}`;
    this.updateFight();
    this.renderShop();
  }

  private updateFight(): void {
    const errors = this.session.armyErrors();
    this.fightBtn.disabled = this.busy || errors.length > 0;
    this.fightBtn.title = errors.join('\n');
  }

  private renderOpponent(): void {
    const { aiPieces, aiStyle } = this.session;
    const types = aiPieces.map((p) => p.type).sort(pieceOrder);
    const points = types.reduce((s, t) => s + PIECE_VALUE[t], 0);
    $('#opponent').innerHTML =
      `Opponent · <strong>${aiStyle.name}</strong>: ` +
      `<span class="glyphs">${types.map((t) => inlinePiece(t, 'b')).join('')}</span> · ${points} pts`;
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
    const full = pieces.length >= MAX_ARMY;
    const disabled = gold < price || full ? 'disabled' : '';
    detail.innerHTML = `<p><strong>${PIECE_NAME[type]}</strong> · ${price} pts. ${PIECES[type].description}</p><button type="button" class="primary" data-buy ${disabled}>${full ? 'Army full' : `Buy · ${price}g`}</button>`;
  }

  /** Gold, the buy button, offers, and upgrade/fuse/sell buttons for the selected piece. */
  private renderShop(): void {
    this.renderOffers();
    const { gold, pieces } = this.session.run.shop;
    $('#gold').textContent = `${gold}g`;
    const buy = $<HTMLButtonElement>('#buy-pawn');
    buy.disabled = gold < PAWN_COST || pieces.length >= MAX_ARMY;
    // On a full board, more pawns only wait on the bench: point players at upgrades instead.
    const spec = this.session.board;
    const pawns = pieces.filter((p) => isPawnLike(p.type)).length;
    const boardFull = pieces.length >= homeSquares(spec) || pawns >= pawnSquares(spec);
    buy.textContent = boardFull ? `Board full: upgrade instead (pawn ${PAWN_COST}g)` : `Buy pawn · ${PAWN_COST}g`;
    buy.classList.toggle('muted', boardFull);

    const actions = $('#piece-actions');
    const piece = pieces.find((p) => p.id === this.selected);
    if (!piece) {
      actions.innerHTML = `<span class="hint">Tap a piece to upgrade, fuse or sell it.</span>`;
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
    // Fusion is free: the selected piece becomes the compound where it stands, and the partner is used up.
    const fusions = fusionOptions(this.session.run.shop, piece.id)
      .map(({ partnerId, result }) => {
        const partner = pieces.find((p) => p.id === partnerId)!;
        return `<button type="button" class="fuse" data-fuse="${partnerId}" title="Uses up a ${PIECE_NAME[partner.type]}">+ ${inlinePiece(partner.type)} → ${inlinePiece(result)} ${PIECE_NAME[result]}</button>`;
      })
      .join('');
    actions.innerHTML =
      `<p class="piece-info"><strong>${PIECE_NAME[piece.type]}</strong> · ${PIECE_VALUE[piece.type]} pts. ${PIECES[piece.type].description}</p>` +
      `${upgrades}${fusions}${sell}`;
  }

  /** Applies a shop action, or shows why it failed. */
  private applyShop(result: ShopResult): void {
    if (!result.ok) {
      this.setMessage(result.error);
      return;
    }
    this.setMessage('');
    this.session.setShop(result.shop);
    this.board.setPieces(result.shop.pieces);
    this.piecesChanged(result.shop.pieces);
  }
}
