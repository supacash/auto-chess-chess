import {
  type AchievementId,
  armyAchievements,
  type Collections,
  mergeAchievements,
  SHOP_FAIRY,
  shopAchievements,
} from '../game/achievements';
import { dismissTip, seenTips } from '../game/storage';
import { interestTip, MATCH_TIPS, nextTip, PLAY_IT_START_TIP, TIPS, type TipId } from '../game/tips';
import {
  buyOffer,
  canMakeHeir,
  fusePieces,
  INTEREST_STEP,
  interest,
  MAX_INTEREST,
  toggleLock,
  fuseDefaultSet,
  fusionOptions,
  makeRook,
  isAffinityOffer,
  type Offer,
  offerName,
  offerPrice,
  pieceName,
  REROLL_COST,
  ROOK_PARTNERS,
  ROOK_PAWNS,
  rookOptions,
  SET_MERGE_SIZE,
  setMergePartners,
  setMergeResults,
  type ShopResult,
  sellPiece,
  sellValue,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from '../rules/economy';
import {
  type Affinity,
  armyPoints,
  isPawnLike,
  type Piece,
  PIECE_NAME,
  PIECE_VALUE,
  PIECES,
  type PieceType,
} from '../rules/pieces';
import { dailyBattle } from '../rules/daily';
import { armyCap, BENCH_SIZE, benchCount, MAX_HEIRS } from '../rules/placement';
import {
  type Family,
  type FamilyStatus,
  familiesOf,
  familyStatus,
  FAMILIES,
  type SynergyUpgrade,
  synergyUpgrades,
} from '../rules/synergy';
import { PlacementBoard } from '../ui/board';
import { fileLetter } from '../chess/boardSpec';
import { inlinePiece, setPlayerColor } from '../ui/boardDom';
import { moveDiagram } from '../ui/moveDiagram';
import { reduceMotion, settings as playerSettings } from './settings';
import { $, escapeHtml, pts } from './dom';
import type { PlacementSession } from './placementSession';
import { type Sfx, sfx } from './sound';
import { showToast } from './toast';

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
  /** The shop offer being looked at (its index), shown with its description and a Buy button. */
  private selectedOffer: number | null = null;
  /** The opponent piece type whose description is showing. */
  private foeInfo: PieceType | null = null;
  /** The synergy chip whose explanation is showing ("you:cavalry", "them:siege" or "help"). */
  private synInfo: string | null = null;
  private busy = false;
  /** Variant of the board last shown, to announce when it grows. */
  private shownBoard: string | null = null;
  private mode: PlacementMode;
  /** Called with each piece gained in the shop (bought, upgraded into or fused), for records. */
  onGained: ((type: PieceType) => void) | null = null;
  /** Called with achievements earned on this screen (the army on the board, a merge). */
  onAchievements: ((ids: AchievementId[]) => void) | null = null;
  /** Called with pieces for a career collection (fairy pieces fielded, fusions made). */
  onCollect: ((kind: keyof Collections, types: PieceType[]) => void) | null = null;
  /** Opens the Piece guide on a piece ("How it moves" in a piece panel). */
  onGuide: ((type: PieceType) => void) | null = null;
  /** Called when the screen is hidden (the guide closes with it). */
  onHide: (() => void) | null = null;
  /** Rerolls this round (Shopaholic), and the round they're for. */
  private rerolls = { round: 0, count: 0 };

  constructor(
    private session: PlacementSession,
    header: () => void,
    onFight: () => void,
    onPlay: () => void,
    onReplay: () => void,
  ) {
    this.mode = { header };
    this.board = new PlacementBoard($('#board-root'), session.run.shop.pieces, {
      onChange: (pieces) => {
        sfx('place');
        this.piecesChanged(pieces);
      },
      onMessage: (text) => {
        if (text) sfx('error');
        this.setMessage(text);
      },
      onFoeTap: (type) => this.toggleFoeInfo(type),
      onSelect: (id) => {
        this.selected = id;
        if (id) this.selectedOffer = null;
        this.renderShop();
        if (id) sfx('select');
        // On a short screen the piece's choices may start below the fight buttons: bring them up.
        if (id) $('#piece-actions').scrollIntoView({ block: 'nearest', behavior: smoothScroll() });
      },
    });

    $('#clear').addEventListener('click', () => {
      const pieces = this.session.run.shop.pieces.map((p) => ({ ...p, square: null }));
      this.board.setPieces(pieces);
      this.setMessage('');
      this.piecesChanged(pieces);
    });
    // "How it moves" in any of the piece panels opens the Piece guide on that piece.
    for (const id of ['#piece-actions', '#offer-detail', '#opponent-info']) {
      $(id).addEventListener('click', (e) => {
        const link = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-guide]');
        if (!link) return;
        e.stopImmediatePropagation();
        this.onGuide?.(link.dataset.guide as PieceType);
      });
    }
    $('#piece-actions').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.hasAttribute('data-close')) {
        this.deselectPiece();
        return;
      }
      const shop = this.session.run.shop;
      if (!this.selected) return;
      const before = this.session.run.shop;
      if (btn.dataset.upgrade) {
        const to = btn.dataset.upgrade as PieceType;
        this.applyShop(upgradePiece(shop, this.selected, to), to, 'merge');
      } else if (btn.dataset.fuse && btn.dataset.result) {
        const to = btn.dataset.result as PieceType;
        const fused = fusePieces(shop, this.selected, btn.dataset.fuse, to, this.session.run.settings.fairy);
        this.applyShop(fused, to, 'merge');
        if (fused.ok) this.onCollect?.('fused', [to]);
      } else if (btn.dataset.rookKeep && btn.dataset.rookUse) {
        const made = makeRook(shop, btn.dataset.rookKeep, btn.dataset.rookUse.split(','));
        this.applyShop(made, 'R', 'merge');
        if (made.ok) this.onAchievements?.(mergeAchievements('R', made.shop.pieces));
      } else if (btn.dataset.mergeSet) {
        const to = btn.dataset.mergeSet as PieceType;
        const bonus = to === 'J' ? (this.session.crownGold?.() ?? 0) : 0;
        const merged = crownBonus(
          fuseDefaultSet(shop, this.selected, to, this.session.run.settings.fairy, this.maxHeirs()),
          bonus,
        );
        this.applyShop(merged, to, 'merge');
        if (merged.ok) this.onAchievements?.(mergeAchievements(to, merged.shop.pieces));
        if (merged.ok && bonus > 0) this.setMessage(`Dynasty: +${bonus} gold for the crowning.`);
      } else if (btn.hasAttribute('data-sell')) this.applyShop(sellPiece(shop, this.selected), undefined, 'sell');
      // The result of a merge, fusion or upgrade isn't left selected: the next tap would move it.
      if (this.session.run.shop !== before) this.board.clearSelection();
    });
    // Tapping a synergy chip explains the family (or, for ?, what synergies are).
    $('#synergies').addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-syn]');
      if (!chip) return;
      this.synInfo = this.synInfo === chip.dataset.syn ? null : chip.dataset.syn!;
      this.renderSynergies();
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
      if (this.selectedOffer !== null) this.deselectPiece();
      this.renderShop();
      if (this.selectedOffer !== null)
        $('#offer-detail').scrollIntoView({ block: 'nearest', behavior: smoothScroll() });
    });
    $('#offer-detail').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button[data-close]')) {
        this.selectedOffer = null;
        this.renderShop();
        return;
      }
      if (!(e.target as HTMLElement).closest('button[data-buy]') || this.selectedOffer === null) return;
      const index = this.selectedOffer;
      this.selectedOffer = null;
      const offer = this.session.run.shop.offers?.[index];
      if (offer && this.session.offerLeft?.(offer) === 0) {
        this.applyShop({ ok: false, error: 'Sold out: every one is taken. Merging or selling puts them back.' });
        return;
      }
      const lastOne = offer !== undefined && this.session.offerLeft?.(offer) === 1;
      const bought = buyOffer(this.session.run.shop, index);
      this.applyShop(bought, offer && (isAffinityOffer(offer) ? 'P' : offer), 'buy');
      if (bought.ok && lastOne) this.onAchievements?.(['poolShark']);
    });
    $('#tip-close').addEventListener('click', () => {
      if (this.tip) dismissTip(this.tip);
      this.renderTip();
    });
    $('#lock').addEventListener('click', () => {
      this.applyShop({ ok: true, shop: toggleLock(this.session.run.shop) });
    });
    $('#reroll').addEventListener('click', () => {
      this.selectedOffer = null;
      const rerolled = this.session.rerollOffers();
      if (rerolled.ok) {
        const round = this.session.run.round;
        this.rerolls = { round, count: this.rerolls.round === round ? this.rerolls.count + 1 : 1 };
      }
      this.applyShop(rerolled, undefined, 'reroll');
    });
    this.fightBtn.addEventListener('click', () => (this.mode.onReady ? this.mode.onReady() : onFight()));
    this.playBtn.addEventListener('click', onPlay);
    $('#last-replay').addEventListener('click', onReplay);
    // The fight bar sticks to the bottom of the screen while the board and shop scroll under it. Only
    // then does it get a backdrop (style.css), so the shop doesn't show through around the buttons.
    // Stuck, it sits on the screen's bottom edge, so with that edge pulled up a pixel it's cut off.
    // (Threshold 0 too: Chrome doesn't report a hidden bar showing up already cut off without it.)
    const bar = $('#placement .fight-bar');
    new IntersectionObserver(
      ([entry]) => bar.classList.toggle('stuck', entry.isIntersecting && entry.intersectionRatio < 1),
      { threshold: [0, 1], rootMargin: '0px 0px -1px 0px' },
    ).observe(bar);
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
    // Auto runs have Play it and Auto fight; Play yourself runs only Play it; matches only Ready.
    const manual = !match && this.session.run.settings.manual === true;
    this.playBtn.hidden = match;
    this.playBtn.classList.toggle('primary', manual);
    this.fightBtn.hidden = manual;
    $('#clear').hidden = false;
    this.fightBtn.textContent = match ? 'Ready' : 'Auto fight';
    this.section.hidden = false;
    $('#last-replay').hidden = !this.session.lastReplay;
    $('#gauntlet-open').hidden = match || !this.session.run.daily;
    const spec = this.session.board;
    const grew = this.shownBoard !== null && this.shownBoard !== spec.variant;
    this.shownBoard = spec.variant;
    this.setMessage('');
    if (grew) sfx('grow');
    if (grew) showToast(`The board grew to ${spec.files}×${spec.ranks}!`, 'More room for your army.', 'teal');

    this.session.fitPiecesToBoard();
    setPlayerColor(this.session.run.color);
    this.board.setSpec(spec, grew);
    this.board.setPieces(this.session.run.shop.pieces);
    const opponent = this.session.opponent();
    const reveal = this.session.revealOpponent?.() ?? this.session.run.settings.reveal;
    this.board.setEnemy(reveal && opponent ? opponent.pieces : null);
    this.renderOpponent();
    this.mode.header();
    this.piecesChanged(this.session.run.shop.pieces);
  }

  hide(): void {
    this.section.hidden = true;
    this.onHide?.();
  }

  /** Redraws just the shop (offers left in the shared pool changed). */
  refreshShop(): void {
    if (!this.section.hidden) this.renderShop();
  }

  /** Redraws the pieces and shop after the session changed them (a perk). */
  refresh(): void {
    if (this.section.hidden) return;
    this.board.setPieces(this.session.run.shop.pieces);
    this.piecesChanged(this.session.run.shop.pieces);
  }

  /** A new run's first board isn't "growth", and nothing is selected. */
  resetForNewRun(): void {
    this.shownBoard = null;
    this.selected = null;
    this.selectedOffer = null;
    this.synInfo = null;
  }

  setMessage(text: string): void {
    this.message.textContent = text;
    if (!text) return;
    this.message.classList.remove('pop');
    void this.message.offsetWidth; // restart the animation
    this.message.classList.add('pop');
  }

  /** While a battle is starting, Fight is disabled and nothing stays selected. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.board.clearSelection();
    this.updateFight();
  }

  private piecesChanged(pieces: Piece[]): void {
    this.session.setPieces(pieces);
    const { gold } = this.session.run.shop;
    const { round } = this.session.run;
    this.onAchievements?.([
      ...armyAchievements(pieces, this.session.board),
      ...shopAchievements(gold, this.rerolls.round === round ? this.rerolls.count : 0),
    ]);
    const fairy = pieces.filter((p) => p.square && SHOP_FAIRY.includes(p.type)).map((p) => p.type);
    if (fairy.length) this.onCollect?.('fielded', fairy);
    const placed = pieces.filter((p) => p.square);
    const points = armyPoints(placed.map((p) => p.type));
    $('#points').textContent =
      `On the board ${placed.length}/${armyCap(this.session.board)} · bench ${benchCount(pieces)}/${BENCH_SIZE} · ${points} pts`;
    this.updateFight();
    this.renderShop();
    this.renderSynergies();
  }

  /** True when this run plays with synergies (synergy.ts). */
  private synergiesOn(): boolean {
    return this.session.run.settings.synergies === true;
  }

  /**
   * The synergy bar: each side's families (yours with how close the next tier is, the opponent's
   * active ones), the explanation of the tapped one, and the upgrade badges on the board.
   */
  private renderSynergies(): void {
    const bar = $('#synergies');
    const info = $('#synergy-info');
    if (!this.synergiesOn()) {
      bar.hidden = true;
      info.hidden = true;
      this.board.setUpgrades(new Map());
      return;
    }
    const spec = this.session.board;
    const mine = this.session.run.shop.pieces;
    const myUpgrades = synergyUpgrades(mine, spec);
    const opponent = this.session.opponent();
    const theirs = opponent?.pieces ?? [];
    const theirUpgrades = synergyUpgrades(theirs, spec);
    const reveal = this.session.revealOpponent?.() ?? this.session.run.settings.reveal;
    this.board.setUpgrades(new Map([...myUpgrades, ...(reveal ? theirUpgrades : [])].map((u) => [u.id, u.to])));

    const placedTypes = (pieces: Piece[]) => pieces.filter((p) => p.square).map((p) => p.type);
    const chip = (who: 'you' | 'them', s: FamilyStatus, upgrades: number) => {
      const key = `${who}:${s.family.id}`;
      const shown = this.synInfo === key;
      const count = s.next === null ? `${s.count}` : `${s.count}/${s.next}`;
      const up = upgrades > 0 ? `<span class="syn-up">↑${upgrades}</span>` : '';
      const label = `${s.family.name}: ${s.count} on the board${upgrades ? `, ${upgrades} upgraded` : ''}. What does it do?`;
      return `<button type="button" class="syn-chip${s.tier > 0 ? ' on' : ''}${shown ? ' active' : ''}" data-syn="${key}" aria-pressed="${shown}" aria-label="${label}">${inlinePiece(s.family.icon, who === 'you' ? 'w' : 'b')}<span class="syn-name">${s.family.name}</span><span class="syn-count">${count}</span>${up}</button>`;
    };
    const upgradedBy = (ups: SynergyUpgrade[], fam: Family) => ups.filter((u) => u.family === fam.id).length;
    const myChips = familyStatus(placedTypes(mine))
      .map((s) => chip('you', s, upgradedBy(myUpgrades, s.family)))
      .join('');
    // The opponent's families that do something this battle (its army is all on the board).
    const theirActive = familyStatus(placedTypes(theirs)).filter((s) => s.tier > 0);
    const theirChips = theirActive.map((s) => chip('them', s, upgradedBy(theirUpgrades, s.family))).join('');
    const helpShown = this.synInfo === 'help';
    const help = `<button type="button" class="syn-chip syn-help${helpShown ? ' active' : ''}" data-syn="help" aria-pressed="${helpShown}" aria-label="What are synergies?">?</button>`;
    bar.hidden = false;
    bar.innerHTML =
      `<div class="syn-row mine"><span class="syn-label">Your synergies</span>${myChips || '<span class="syn-none">none yet</span>'}${help}</div>` +
      (opponent && theirs.length
        ? `<div class="syn-row theirs"><span class="syn-label">Theirs</span>${theirChips || '<span class="syn-none">none</span>'}</div>`
        : '');

    // The tapped chip's explanation (dropped once that family is no longer on the board).
    const [who, id] = this.synInfo?.split(':') ?? [];
    const fam = FAMILIES.find((f) => f.id === id);
    let text = '';
    if (this.synInfo === 'help') text = synergyHelp();
    else if (fam && who === 'you' && placedTypes(mine).some((t) => fam.members.includes(t)))
      text = familyText(fam, placedTypes(mine), myUpgrades, true);
    else if (fam && who === 'them' && theirActive.some((s) => s.family === fam))
      text = familyText(fam, placedTypes(theirs), reveal ? theirUpgrades : null, false);
    if (!text) this.synInfo = null;
    info.hidden = !text;
    info.innerHTML = text;
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
    // "VS" the round's opponent; in a match, who's up next (their army so far).
    const label = this.mode.onReady ? 'Up next' : 'VS';
    const head = `<span class="opp-label">${label}</span> <strong class="opp-name">${escapeHtml(opponent.name)}</strong>`;
    if (opponent.pieces.length === 0) {
      $('#opponent').innerHTML = `${head} <span class="foe-points">nothing placed yet</span>`;
      this.renderFoeInfo();
      return;
    }
    const types = opponent.pieces.map((p) => p.type).sort(pieceOrder);
    const points = armyPoints(types);
    // One glyph per piece type, with a count for repeats ("♛×14"), so big armies stay on one line.
    const counts = new Map<PieceType, number>();
    for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
    $('#opponent').innerHTML =
      `${head} <span class="foe-points">${pts(points)}</span> ` +
      `<span class="glyphs">${[...counts]
        .map(
          ([t, n]) =>
            `<button type="button" class="foe" data-foe="${t}" aria-label="${n} ${PIECE_NAME[t]}${n > 1 ? 's' : ''}: what does it do?">${inlinePiece(t, 'b')}${n > 1 ? `<span class="foe-count">×${n}</span>` : ''}</button>`,
        )
        .join('')}</span>`;
    this.renderFoeInfo();
  }

  /** Redraws the opponent line (e.g. when a multiplayer opponent's preview changes). */
  refreshOpponent(): void {
    if (this.section.hidden) return;
    const shown = this.foeInfo;
    this.renderOpponent();
    if (shown) this.toggleFoeInfo(shown);
    this.renderSynergies();
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
    info.innerHTML = `<span class="panel-head">${moveDiagram(type, 'b')}<span><strong>${PIECE_NAME[type]}</strong> · ${about(type)}${this.familyTags(type)} ${guideLink(type)}</span></span>`;
  }

  private deselectPiece(): void {
    this.selected = null;
    this.board.clearSelection();
  }

  /** The tip currently showing (see game/tips.ts), or null. */
  private tip: TipId | null = null;

  /** Shows the most useful first-run tip that hasn't been dismissed on this device. */
  private renderTip(): void {
    const { shop, round, daily } = this.session.run;
    // The daily challenge starts at round 2, but its first battle is someone's first game as much as round 1 is.
    const first = daily ? dailyBattle(round) === 1 : round === 1;
    this.tip = playerSettings().tutorials ? nextTip(shop, round, seenTips(), first) : null;
    $('#tip').hidden = this.tip === null;
    $('#tip-text').textContent = this.tip ? this.tipText(this.tip) : '';
    // The how-to-play tip already says to place the king: no need for the hint under the buttons too.
    if (this.tip === 'start') $('#fight-hint').hidden = true;
  }

  /** A tip's words here: the run's own interest terms, and how to play in a Play it run or a match. */
  private tipText(tip: TipId): string {
    if (tip === 'interest') {
      const { step, max } = this.session.interestTerms?.() ?? { step: INTEREST_STEP, max: MAX_INTEREST };
      return interestTip(step, max);
    }
    // A match is won on health, not lives, and its button reads Ready.
    if (this.mode.onReady) return MATCH_TIPS[tip] ?? TIPS[tip];
    if (tip === 'start' && this.session.run.settings.manual) return PLAY_IT_START_TIP;
    return TIPS[tip];
  }

  /** The offer cards, and the selected offer's description and Buy button. */
  private renderOffers(): void {
    const { gold, pieces, offers = [] } = this.session.run.shop;
    if (this.selectedOffer !== null && this.selectedOffer >= offers.length) this.selectedOffer = null;
    const rerollCost = this.session.rerollCost?.() ?? REROLL_COST;
    const reroll = $<HTMLButtonElement>('#reroll');
    reroll.disabled = gold < rerollCost;
    reroll.textContent = rerollCost === 0 ? 'Reroll · free' : `Reroll · ${rerollCost}g`;
    $('#offers').innerHTML = offers.length
      ? offers
          .map((o, i) => {
            const price = offerPrice(o);
            const left = this.session.offerLeft?.(o) ?? null;
            const cls = [
              'offer',
              i === this.selectedOffer ? 'selected' : '',
              gold < price || left === 0 ? 'pricey' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const stock =
              left === null ? '' : `<span class="offer-left">${left === 0 ? 'sold out' : `${left} left`}</span>`;
            return `<button type="button" class="${cls}" data-offer="${i}" data-tier="${priceTier(price)}" aria-pressed="${i === this.selectedOffer}" aria-label="${offerName(o)}, ${price} gold${left === 0 ? ', sold out' : ''}"><span class="offer-art">${offerIcon(o)}<span class="offer-price">${price}g</span></span><span class="offer-name">${offerName(o)}</span>${stock}</button>`;
          })
          .join('')
      : '<span class="hint">Sold out. Reroll for more.</span>';

    const detail = $('#offer-detail');
    const offer = this.selectedOffer === null ? undefined : offers[this.selectedOffer];
    detail.hidden = !offer;
    if (!offer) return;
    const price = offerPrice(offer);
    const full = benchCount(pieces) >= BENCH_SIZE;
    const soldOut = this.session.offerLeft?.(offer) === 0;
    const disabled = gold < price || full || soldOut ? 'disabled' : '';
    const text = isAffinityOffer(offer) ? affinityText(offer[1] as Affinity, pieces) : about(offer);
    const offered = isAffinityOffer(offer) ? 'P' : offer;
    detail.innerHTML =
      panelHead(offerDiagram(offer), offerName(offer), `${text}${this.familyTags(offered)} ${guideLink(offered)}`) +
      `<button type="button" class="primary" data-buy ${disabled}>${soldOut ? 'Sold out' : full ? 'Bench full' : gold < price ? `Need ${price}g` : `Buy · ${price}g`}</button>`;
  }

  /** Gold, the buy button, offers, and upgrade/fuse/sell buttons for the selected piece. */
  private renderShop(): void {
    this.renderOffers();
    this.renderTip();
    const { gold, pieces, locked } = this.session.run.shop;
    const { step, max } = this.session.interestTerms?.() ?? { step: INTEREST_STEP, max: MAX_INTEREST };
    const owed = interest(gold, step, max);
    $('#gold').innerHTML =
      `${gold}g` +
      (owed > 0
        ? ` <small class="interest" title="Interest: +1 gold per ${step} saved (up to ${max}), paid after the battle">+${owed} interest</small>`
        : '');
    const lock = $<HTMLButtonElement>('#lock');
    lock.textContent = locked ? '🔒' : '🔓';
    lock.setAttribute('aria-pressed', String(Boolean(locked)));
    lock.classList.toggle('active', Boolean(locked));
    lock.title = locked
      ? 'Locked: these offers stay for next round'
      : 'Lock the shop: keep these offers for next round';

    const actions = $('#piece-actions');
    const piece = pieces.find((p) => p.id === this.selected);
    // A selected piece's choices take the offers' place (they never cover the board it's going to).
    actions.hidden = !piece;
    $('#offers').hidden = Boolean(piece);
    if (!piece) {
      actions.innerHTML = '';
      return;
    }
    // Each button: what it makes (or does) on top, and what it takes underneath.
    const upgrades = (piece.affinity ? [] : UPGRADES[piece.type])
      .map((to) => {
        const cost = upgradeCost(piece.type, to);
        const disabled = gold < cost ? 'disabled' : '';
        return `<button type="button" data-upgrade="${to}" ${disabled} aria-label="Upgrade to ${aName(to)} for ${cost} gold">${act(`${inlinePiece(to)} ${PIECE_NAME[to]}`, `Upgrade · ${cost}g`)}</button>`;
      })
      .join('');
    const sell =
      piece.type === 'K' || piece.type === 'J'
        ? ''
        : `<button type="button" class="sell" data-sell aria-label="Sell for ${sellValue(piece)} gold">${act('Sell', `+${sellValue(piece)}g`)}</button>`;
    // Merging is free: the selected piece becomes the result where it stands, and the partner is used up.
    const fusions = fusionOptions(this.session.run.shop, piece.id, this.session.run.settings.fairy)
      .map(({ partnerId, result }) => {
        const partner = pieces.find((p) => p.id === partnerId)!;
        return `<button type="button" class="fuse" data-fuse="${partnerId}" data-result="${result}" title="Uses up a ${pieceName(partner)}" aria-label="Fuse with a ${pieceName(partner)} into ${aName(result)}">${act(`${inlinePiece(result)} ${PIECE_NAME[result]}`, `+ ${inlinePiece(partner.type)} ${pieceName(partner)}`)}</button>`;
      })
      .join('');
    // Three of a kind merge in one tap (the set is all the same kind, so there's nothing to pick):
    // one button per result (three plain pawns can become a Knight or a Bishop).
    const { shop, settings } = this.session.run;
    const heirs = this.maxHeirs();
    const partners = setMergePartners(shop, piece.id, settings.fairy, heirs);
    const setResults = partners ? setMergeResults([piece, ...partners], canMakeHeir(shop, settings.fairy, heirs)) : [];
    const pawnFusions = setResults
      .map(
        (to) =>
          `<button type="button" class="fuse" data-merge-set="${to}" title="Uses up ${SET_MERGE_SIZE} ${pieceName(piece).toLowerCase()}s" aria-label="Merge ${SET_MERGE_SIZE} into ${to === 'J' ? 'an Heir (a second king)' : aName(to)}">${act(`${inlinePiece(to)} ${PIECE_NAME[to]}`, to === 'J' ? `Merge ${SET_MERGE_SIZE}: a 2nd king` : `Merge ${SET_MERGE_SIZE}`)}</button>`,
      )
      .join('');
    // A Rook: two rook-pawns and a Bishop, Knight or Man. The player picks which piece goes: from a
    // rook-pawn, one button per partner type; from a Bishop, Knight or Man, that very piece.
    const rooks = rookOptions(shop, piece.id)
      .map(({ keepId, usedIds, partner }) => {
        const fromPawn = piece.affinity === 'R';
        const title = fromPawn
          ? `Uses up a ${PIECE_NAME[partner]} and another rook-pawn`
          : `Uses up this ${PIECE_NAME[partner]} and ${ROOK_PAWNS} rook-pawns`;
        const parts = fromPawn
          ? `+ ${inlinePiece(partner)} ${PIECE_NAME[partner]}`
          : `+ ${ROOK_PAWNS} ${inlinePiece('P', 'w', 'R')} rook-pawns`;
        return `<button type="button" class="fuse" data-rook-keep="${keepId}" data-rook-use="${usedIds.join(',')}" title="${title}" aria-label="Make a Rook: ${title.toLowerCase()}">${act(`${inlinePiece('R')} Rook`, parts)}</button>`;
      })
      .join('');
    const info = piece.affinity
      ? affinityText(piece.affinity, pieces)
      : `${about(piece.type)}${
          isPawnLike(piece.type)
            ? ' Three of them merge into a Knight or Bishop.'
            : piece.type === 'Q' && canMakeHeir(shop, settings.fairy, heirs)
              ? ' Three Queens merge into an Heir: a second king, so one must be captured before the other can be mated.'
              : ''
        }`;
    const icon = moveDiagram(piece.type, 'w', piece.affinity);
    actions.innerHTML =
      panelHead(icon, pieceName(piece), `${info}${this.familyTags(piece.type)} ${guideLink(piece.type)}`) +
      `<div class="panel-buttons">${fusions}${rooks}${pawnFusions}${upgrades}${sell}</div>`;
  }

  /** " Cavalry · Guard" tags: the synergy families a piece counts toward, in a synergy run (else nothing). */
  private familyTags(type: PieceType): string {
    if (!this.synergiesOn()) return '';
    return familiesOf(type)
      .map((f) => ` <span class="syn-tag">${f.name}</span>`)
      .join('');
  }

  /** How many Heirs the army may have (a prestige perk can allow more). */
  private maxHeirs(): number {
    return this.session.maxHeirs?.() ?? MAX_HEIRS;
  }

  /** Applies a shop action, or shows why it failed. */
  private applyShop(result: ShopResult, gained?: PieceType, sound?: Sfx): void {
    if (!result.ok) {
      sfx('error');
      this.setMessage(result.error);
      return;
    }
    if (sound) sfx(sound);
    if (gained) this.onGained?.(gained);
    this.setMessage('');
    this.session.setShop(result.shop);
    this.board.setPieces(result.shop.pieces);
    this.piecesChanged(result.shop.pieces);
  }
}

/** What synergies are, for the bar's ? chip. */
function synergyHelp(): string {
  const families = FAMILIES.map(
    (f) => `<strong>${f.name}</strong> ${f.members.map((t) => inlinePiece(t)).join('')} from ${f.tiers[0]}`,
  ).join(' · ');
  return (
    '<strong>Synergies</strong> · pieces belong to families by how they move. Field enough of a family and its ' +
    'front pieces fight this battle as stronger pieces (marked on the board), for you and your opponent alike. ' +
    `Bishops, Rooks and Queens belong to none. ${families}.`
  );
}

/** "a Knight fights as a Centaur, a Camel as a Wildebeest": what a family's upgrades make. */
function upgradeText(fam: Family): string {
  const byTarget = new Map<PieceType, PieceType[]>();
  for (const [from, to] of Object.entries(fam.upgrades) as [PieceType, PieceType][]) {
    byTarget.set(to, [...(byTarget.get(to) ?? []), from]);
  }
  return [...byTarget]
    .map(([to, froms], i) => `${froms.map((t) => aName(t)).join(' or ')}${i === 0 ? ' fights' : ''} as ${aName(to)}`)
    .join(', ');
}

/**
 * A family's explanation: its members, what each tier does, and what it does for this army now.
 * `upgrades`: the army's upgrades, or null when where its pieces stand is hidden (the opponent's).
 */
function familyText(fam: Family, types: PieceType[], upgrades: SynergyUpgrade[] | null, mine: boolean): string {
  const count = types.filter((t) => fam.members.includes(t)).length;
  const tiers = fam.tiers
    .map((n, i) => `${n} on the board upgrade ${i === 0 ? 'the front one' : `the front ${i + 1}`}`)
    .join(', ');
  const ups = upgrades?.filter((u) => u.family === fam.id) ?? [];
  const where = (u: SynergyUpgrade) => (mine ? ` on ${fileLetter(u.square.file)}${u.square.rank + 1}` : '');
  const now = ups.length
    ? `This battle: ${ups.map((u) => `${mine ? 'your' : 'their'} ${PIECE_NAME[u.from]}${where(u)} fights as ${aName(u.to)}`).join(', ')}.`
    : `${mine ? 'You have' : 'They have'} ${count}.`;
  const icons = fam.members.map((t) => inlinePiece(t, mine ? 'w' : 'b')).join('');
  return `<strong>${fam.name}</strong> (${fam.kind}) ${icons} · ${tiers}: ${upgradeText(fam)}, for the battle. ${now}`;
}

/** "3 pts. Jumps in an L shape." (the King and Heir aren't worth points in battle). */
/**
 * A shop panel's head: the piece's move diagram, name and explanation, and Close. With tutorials off
 * (Settings), just the name.
 */
function panelHead(diagram: string, name: string, explanation: string): string {
  const text = playerSettings().tutorials
    ? `${diagram}<p><strong>${name}</strong> · ${explanation}</p>`
    : `<p><strong>${name}</strong></p>`;
  return `<div class="panel-head">${text}${CLOSE_BUTTON}</div>`;
}

function about(type: PieceType): string {
  const value = type === 'K' || type === 'J' ? '' : `${pts(PIECE_VALUE[type])}. `;
  return `${value}${PIECES[type].description}`;
}

/** Smooth scrolling, unless the player asked for reduced motion. */
function smoothScroll(): ScrollBehavior {
  return reduceMotion() ? 'auto' : 'smooth';
}

/** A sheet button's two lines: what it makes or does, and (smaller) what it takes. */
function act(main: string, note: string): string {
  return `<span class="act">${main}</span><small class="act-note">${note}</small>`;
}

/** "a Knight", "an Archbishop". */
function aName(type: PieceType): string {
  const name = PIECE_NAME[type];
  return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
}

/** Opens the Piece guide on `type`'s entry. */
function guideLink(type: PieceType): string {
  return `<button type="button" class="guide-link" data-guide="${type}">How it moves</button>`;
}

/** Closes the sheet over the fight buttons (deselects the offer or piece). */
const CLOSE_BUTTON = '<button type="button" class="panel-close" data-close aria-label="Close">×</button>';

/** An offer's price band, which colours its card like an auto-battler's cost tiers. */
function priceTier(price: number): number {
  return price <= 1 ? 1 : price <= 3 ? 2 : price <= 5 ? 3 : price <= 8 ? 4 : 5;
}

/** A merge that crowned an Heir, with the gold a perk pays for it (Dynasty). */
function crownBonus(result: ShopResult, gold: number): ShopResult {
  return result.ok && gold > 0 ? { ok: true, shop: { ...result.shop, gold: result.shop.gold + gold } } : result;
}

/** How an offer moves: an affinity pawn moves as a pawn (with its badge in the middle). */
function offerDiagram(offer: Offer): string {
  return isAffinityOffer(offer) ? moveDiagram('P', 'w', offer[1] as Affinity) : moveDiagram(offer);
}

/** An offer's picture: the piece, or a pawn with its affinity badge. */
function offerIcon(offer: Offer): string {
  return isAffinityOffer(offer) ? inlinePiece('P', 'w', offer[1] as Affinity) : inlinePiece(offer);
}

/** What an affinity pawn is for, and how many of its set the player has. */
function affinityText(affinity: Affinity, pieces: Piece[]): string {
  const have = pieces.filter((p) => p.affinity === affinity).length;
  const name = PIECE_NAME[affinity];
  if (affinity === 'R') {
    const partner = pieces.some((p) => !p.affinity && ROOK_PARTNERS.includes(p.type));
    return `Fights as a pawn. Two rook-pawns and a Bishop, Knight or Man of your choice make a Rook (you have ${have}/${ROOK_PAWNS}${partner ? '' : ', and no Bishop, Knight or Man yet'}).`;
  }
  return `Fights as a pawn. Three ${name.toLowerCase()}-pawns merge into a ${name} (you have ${have}/${SET_MERGE_SIZE}).`;
}
