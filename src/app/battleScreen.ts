import { type BoardSpec, plyLimit } from '../chess/boardSpec';
import { FINAL_ROUND, bestStreak, type RoundLog } from '../rules/run';
import type { Color } from '../chess/fen';
import { Game, type Move } from '../chess/rules';
import { mirrorFen, mirrorSquare, parsePlacement, royalCaptured } from '../chess/fen';
import { checkmateEval, evalShare, formatEval, whiteEval, type History } from '../engine/pick';
import type { ManualBattle, ManualState } from '../game/manualBattle';
import { type BattleRecord, recordBoard } from '../game/record';
import { type MoveSource, runBattle, SEARCH_DEPTH } from '../game/runBattle';
import { type BattleResult, type EndReason, material, wonOnPoints } from '../rules/battle';
import type { Rng } from '../rules/rng';
import { PIECE_NAME, PIECE_VALUE, type PieceType } from '../rules/pieces';
import { BattleView } from '../ui/battleView';
import { displayColor, inlinePiece, setPlayerColor } from '../ui/boardDom';
import { $, escapeHtml, sleep } from './dom';
import type { BattleOutcome } from './session';

/** Base playback time per move at 1× speed. */
const MOVE_MS = 400;
/** Pause on the starting position before the first move. */
const INTRO_MS = 700;
/** Longer pause in multiplayer, where the player's side is announced first. */
const SIDE_INTRO_MS = 2000;

const REASON_TEXT: Record<EndReason, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  repetition: 'by threefold repetition',
  insufficient: 'by insufficient material',
  'fifty-move': 'by the 50-move rule',
  'move-limit': 'on points',
  decisive: 'by a decisive material lead',
  resign: 'by resigning',
};

/** A finished auto battle: its result plus every move and the engine's eval (for white) after it. */
export interface Playback {
  result: BattleResult;
  moves: string[];
  evals: (number | null)[];
  /** The most points the player was ever behind in material (for records). */
  worstDeficit: number;
}

/** Works out evals for a review of a game that recorded none (manual games). */
export interface ReviewAnalysis {
  /** Gets the engine ready for this board. */
  prepare(spec: BoardSpec, fen: string): Promise<void>;
  /** The position's eval from White's side, or null if the engine couldn't search it. */
  evaluate(fen: string, history: History): Promise<number | null>;
  /** Keeps the evals worked out so far (so the next review needn't redo them). */
  save(evals: (number | null)[]): void;
}

/**
 * What to announce when a move captured a King or an Heir (only possible with an Heir on the board),
 * or null. `mine` is the player's side (null when watching someone else's battle).
 */
function royalCaptureText(before: string, after: string, mine: Color | null): string | null {
  const capture = royalCaptured(before, after);
  if (!capture) return null;
  const { side, lost } = capture;
  const whose = mine === null ? (side === 'w' ? "White's" : "Black's") : side === mine ? 'Your' : 'Their';
  return lost === 'King'
    ? `${whose} King was captured! ${whose} Heir takes the crown.`
    : `${whose} Heir was captured! Only the King is left.`;
}

/** An extra button on a custom result card. */
export interface CardButton {
  label: string;
  onClick: () => void;
}

/** Thrown by play() when the battle was stopped with abort(). */
export class BattleAborted extends Error {
  constructor() {
    super('Battle stopped');
  }
}

type PlayerAction = { kind: 'move'; uci: string } | { kind: 'undo' } | { kind: 'resign' } | { kind: 'pause' };

/** Thrown by playManual() when the player leaves for the menu: the game stays saved, to resume later. */
export class GamePaused extends Error {
  constructor() {
    super('Game paused');
  }
}

/** The battle screen: animated board, eval bar, playback speed, and the result. */
export class BattleScreen {
  private readonly section = $('#battle');
  private readonly status = $('#battle-status');
  private readonly result = $('#result');
  private readonly playback = $('#playback');
  private readonly view = new BattleView($('#battle-root'));
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly manual = $('#manual');
  private readonly promo = $('#promo');
  private readonly undoBtn = $<HTMLButtonElement>('#undo');
  private readonly resignBtn = $<HTMLButtonElement>('#resign');
  private readonly replayDone = $<HTMLButtonElement>('#replay-done');
  private speed = 1;
  private skipping = false;
  /** Resolves the player's pending turn in a manual game. */
  private pending: ((action: PlayerAction) => void) | null = null;
  private resignTimer = 0;

  /** Overrides what the result card's main button does while a custom card is showing (see showCard). */
  private nextOverride: (() => void) | null = null;
  /** The custom card's extra buttons (see showCard). */
  private extras: CardButton[] = [];
  private announceTimer = 0;

  /** Flashes `text` over the board for a few seconds (a King or Heir captured). */
  private announce(text: string | null): void {
    if (!text) return;
    const el = $('#battle-announce');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 3500);
  }

  constructor(onNext: () => void, onReplay: () => void, onPrestige?: () => void) {
    $('#replay').addEventListener('click', onReplay);
    this.undoBtn.addEventListener('click', () => this.pending?.({ kind: 'undo' }));
    // Resigning takes a second tap, so a stray tap can't throw the game away.
    this.resignBtn.addEventListener('click', () => {
      if (!this.pending) return;
      if (this.resignBtn.dataset.confirm) {
        this.resetResign();
        this.pending({ kind: 'resign' });
        return;
      }
      this.resignBtn.dataset.confirm = '1';
      this.resignBtn.textContent = 'Tap again to resign';
      this.resignTimer = window.setTimeout(() => this.resetResign(), 3000);
    });
    this.playback.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.id === 'skip') this.skipping = true;
      else this.speed = Number(btn.dataset.speed);
      this.renderPlaybackButtons();
    });
    $('#prestige').addEventListener('click', () => onPrestige?.());
    $('#card-extras').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-extra]');
      if (btn) this.extras[Number(btn.dataset.extra)]?.onClick();
    });
    $('#next').addEventListener('click', () => {
      const override = this.nextOverride;
      this.nextOverride = null;
      if (override) override();
      else onNext();
    });
  }

  hide(): void {
    this.waiting = false;
    this.section.hidden = true;
    $('#revive').hidden = true;
  }

  /**
   * Shows and plays a battle from `fen` on `spec` until it ends; returns the result with every move
   * and eval. With `flip`, the player's army is black in the battle: the board is shown from their
   * side (their pieces at the bottom, in white) and the eval bar from their point of view.
   */
  async play(
    engine: MoveSource,
    fen: string,
    firstMover: Color,
    spec: BoardSpec,
    rng: Rng,
    {
      flip = false,
      opponent = '',
      announceSide = false,
      watching = '',
    }: { flip?: boolean; opponent?: string; announceSide?: boolean; watching?: string } = {},
  ): Promise<Playback> {
    // In a match the player's pieces are drawn in their real colour (black when they're Black); the
    // mirrored position puts them at the bottom either way.
    if (announceSide) setPlayerColor(flip ? 'b' : 'w');
    // Watching someone else's battle: real colours, White at the bottom.
    if (watching) setPlayerColor('w');
    this.aborted = false;
    const show = (f: string) => (flip ? mirrorFen(f, spec.files) : f);
    const square = (s: string) => (flip ? mirrorSquare(s, spec.ranks) : s);
    const mine = flip ? 'b' : 'w';
    this.waiting = false;
    this.speed = 1;
    this.skipping = false;
    this.renderPlaybackButtons();
    this.section.hidden = false;
    this.result.hidden = true;
    this.playback.hidden = false;
    this.manual.hidden = true;
    this.showSides(false);
    $('#eval').hidden = false;

    const limit = plyLimit(spec);
    this.view.render(show(fen), spec);
    // The bar's light side is White's: flip it when the player is Black.
    $('#eval-bar').classList.toggle('as-black', displayColor('w') === 'b');
    this.showEval(0);
    const against = opponent ? ` against ${opponent}` : '';
    if (watching) {
      this.status.textContent = watching;
      await sleep(INTRO_MS);
    } else if (announceSide) {
      // Multiplayer: sides are random each battle, so say which one before the first move.
      const side = mine === 'w' ? 'White' : 'Black';
      const first = firstMover === mine ? 'you move first' : 'they move first';
      this.status.textContent = `You're ${side}${against} · ${first}`;
      await sleep(SIDE_INTRO_MS);
    } else {
      this.status.textContent = firstMover === mine ? `You move first${against}` : `Opponent moves first${against}`;
      await sleep(INTRO_MS);
    }

    const moves: string[] = [];
    const evals: (number | null)[] = [];
    let worstDeficit = 0;
    let before = fen;
    $('#battle-announce').hidden = true;
    const result = await runBattle(
      fen,
      engine,
      rng,
      async (move, game, plies, evalScore) => {
        if (this.aborted) throw new BattleAborted();
        moves.push(move.uci);
        evals.push(evalScore);
        const after = game.fen();
        this.announce(royalCaptureText(before, after, watching ? null : mine));
        before = after;
        const now = material(game.fen());
        worstDeficit = Math.max(worstDeficit, now[mine === 'w' ? 'b' : 'w'] - now[mine]);
        const ms = this.skipping ? 0 : MOVE_MS / this.speed;
        this.view.render(show(game.fen()), game.spec, {
          last: { from: square(move.from), to: square(move.to) },
          animateMs: this.reduceMotion ? 0 : ms * 0.8,
          check: game.isCheck(),
        });
        if (evalScore !== null) this.showEval(flip ? -evalScore : evalScore);
        const mat = material(show(game.fen()));
        this.status.textContent = this.skipping
          ? 'Skipping…'
          : `Move ${Math.ceil(plies / 2)}/${limit / 2} · Material ${mat.w}–${mat.b}`;
        if (ms) await sleep(ms);
      },
      { plyLimit: limit },
      spec,
    );

    if (result.reason === 'checkmate' && result.winner !== 'draw') {
      this.showEval(checkmateEval(result.winner === mine ? 'w' : 'b'));
    }
    return { result, moves, evals, worstDeficit };
  }

  /**
   * Reviews a finished battle: it opens on the final position, and the player steps through the
   * moves (first / back / play / forward / last, or the slider) at their own pace. Done goes back to
   * the result card, or calls `onDone`. Manual games recorded no evals: with `analysis`, each
   * position is evaluated when first shown (cached, and handed to `analysis.save` to keep).
   */
  async replay(record: BattleRecord, onDone: () => void, analysis?: ReviewAnalysis): Promise<void> {
    const spec = recordBoard(record);
    if (!spec) return;
    // Every position up front, so stepping back and jumping are instant.
    const frames: { fen: string; last: { from: string; to: string } | null; check: boolean }[] = [];
    const game = new Game(spec, record.fen);
    try {
      frames.push({ fen: game.fen(), last: null, check: game.isCheck() });
      for (const uci of record.moves) {
        const move = game.play(uci);
        if (!move) break; // made under rules this build doesn't have
        frames.push({ fen: game.fen(), last: move, check: game.isCheck() });
      }
    } finally {
      game.delete();
    }

    const resultWasShown = !this.section.hidden && !this.result.hidden;
    this.section.hidden = false;
    this.result.hidden = true;
    this.manual.hidden = true;
    this.playback.hidden = true;
    this.replayDone.hidden = false;
    const review = $('#review');
    review.hidden = false;
    // Evals by move (index i = after move i+1); a manual game's are worked out on demand.
    const evals: (number | null)[] = record.moves.map((_, i) => record.evals[i] ?? null);
    const analyse = record.manual ? analysis : undefined;
    $('#eval').hidden = record.manual && !analyse;
    $('#eval-bar').classList.toggle('as-black', displayColor('w') === 'b');

    const slider = $<HTMLInputElement>('#review-slider');
    const playBtn = $<HTMLButtonElement>('#review-play');
    const last = frames.length - 1;
    slider.max = String(last);
    let index = last;
    let timer = 0;
    // On-demand analysis: one search at a time, always for the latest position asked for.
    let wanted: number | null = null;
    let running = false;
    let started = false;
    let closed = false;
    const request = (i: number) => {
      wanted = i;
      if (running || !analyse) return;
      running = true;
      void (async () => {
        try {
          while (wanted !== null && !closed) {
            const k = wanted;
            wanted = null;
            if (evals[k - 1] !== null) continue;
            if (!started) {
              await analyse.prepare(spec, record.fen);
              started = true;
            }
            evals[k - 1] = await analyse.evaluate(frames[k].fen, { fen: record.fen, moves: record.moves.slice(0, k) });
            if (!closed && index === k && evals[k - 1] !== null) this.showEval(evals[k - 1]!);
          }
          if (!closed) analyse.save(evals);
        } catch (err) {
          console.warn('Review analysis failed', err);
        } finally {
          running = false;
        }
      })();
    };
    const stop = () => {
      clearInterval(timer);
      timer = 0;
      playBtn.textContent = '▶︎ Play';
    };
    const show = (i: number, animate = false) => {
      index = Math.max(0, Math.min(last, i));
      const f = frames[index];
      this.view.render(f.fen, spec, {
        ...(f.last ? { last: f.last } : {}),
        animateMs: animate && !this.reduceMotion ? MOVE_MS * 0.4 : 0,
        check: f.check,
      });
      slider.value = String(index);
      const { result } = record;
      if (index === last && result.reason === 'checkmate' && result.winner !== 'draw')
        this.showEval(checkmateEval(result.winner));
      else if (index === 0 || evals[index - 1] !== null || !analyse) this.showEval(latestEval(evals, index));
      else {
        $('#eval-label').textContent = '…';
        request(index);
      }
      this.status.textContent =
        index === 0
          ? 'Start position'
          : `Move ${Math.ceil(index / 2)} of ${Math.ceil(last / 2)}${index === last ? ' · final position' : ''}`;
      for (const b of review.querySelectorAll<HTMLButtonElement>('[data-step="first"], [data-step="prev"]'))
        b.disabled = index === 0;
      for (const b of review.querySelectorAll<HTMLButtonElement>('[data-step="next"], [data-step="last"]'))
        b.disabled = index === last;
      if (index === last) stop();
    };
    review.onclick = (e) => {
      const step = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.step;
      if (!step) return;
      if (step === 'play') {
        if (timer) return stop();
        if (index === last) show(0);
        playBtn.textContent = '⏸ Pause';
        timer = window.setInterval(() => show(index + 1, true), MOVE_MS);
        return;
      }
      stop();
      if (step === 'first') show(0);
      else if (step === 'prev') show(index - 1);
      else if (step === 'next') show(index + 1, true);
      else show(last);
    };
    slider.oninput = () => {
      stop();
      show(Number(slider.value));
    };
    show(last);

    this.replayDone.onclick = () => {
      stop();
      closed = true;
      review.hidden = true;
      this.replayDone.hidden = true;
      if (resultWasShown) {
        this.result.hidden = false;
        this.status.textContent = 'Final position';
      } else onDone();
    };
  }

  /**
   * Shows a game where the player moves their own pieces and the engine plays the opponent, until it
   * ends. `onSave` gets the game after every move (and undo) so a reload can resume it. The eval bar
   * stays hidden until the game is over.
   */
  async playManual(
    engine: MoveSource,
    game: ManualBattle,
    onSave: (state: ManualState) => void,
  ): Promise<BattleResult> {
    this.section.hidden = false;
    this.result.hidden = true;
    this.playback.hidden = true;
    this.manual.hidden = false;
    $('#eval').hidden = true;
    $('#eval-bar').classList.toggle('as-black', displayColor('w') === 'b');
    await engine.newGame(game.variant);

    let before = game.fen;
    $('#battle-announce').hidden = true;
    const draw = (last?: Move) => {
      // In a Play it game the player is White in the FEN.
      this.announce(royalCaptureText(before, game.fen, 'w'));
      before = game.fen;
      this.view.render(game.fen, game.spec, {
        last,
        animateMs: last && !this.reduceMotion ? 150 : 0,
        check: game.isCheck(),
      });
      this.renderSides(game.fen, game.spec.files);
      const now = material(game.fen);
      this.manualWorstDeficit = Math.max(this.manualWorstDeficit, now.b - now.w);
    };
    this.manualWorstDeficit = 0;
    this.showSides(true);
    draw();

    this.inManual = true;
    this.pauseRequested = false;
    try {
      return await this.manualLoop(engine, game, onSave, draw);
    } finally {
      this.inManual = false;
      this.view.setInput(null);
    }
  }

  private async manualLoop(
    engine: MoveSource,
    game: ManualBattle,
    onSave: (state: ManualState) => void,
    draw: (last?: Move) => void,
  ): Promise<BattleResult> {
    let result = game.result();
    while (!result) {
      if (this.pauseRequested) throw new GamePaused();
      if (game.playerToMove) {
        this.status.textContent = game.isCheck() ? 'Your move: you are in check!' : 'Your move';
        this.undoBtn.disabled = !game.canUndo();
        this.resignBtn.disabled = false;
        const action = await this.waitForPlayer(game);
        this.view.setInput(null);
        if (action.kind === 'pause') throw new GamePaused();
        if (action.kind === 'resign') {
          result = game.resign();
          break;
        }
        if (action.kind === 'undo') {
          game.undo();
          draw();
        } else {
          draw(game.playerMove(action.uci) ?? undefined);
        }
      } else {
        this.status.textContent = 'Opponent is thinking…';
        this.undoBtn.disabled = true;
        this.resignBtn.disabled = true;
        draw(await game.opponentMove(engine));
      }
      onSave(game.state);
      result = game.result();
    }

    this.manual.hidden = true;
    this.promo.hidden = true;
    this.showSides(false);
    // The game's over: show the eval now.
    $('#eval').hidden = false;
    if (result.reason === 'checkmate' && result.winner !== 'draw') this.showEval(checkmateEval(result.winner));
    else this.showEval(whiteEval(await engine.candidates(game.fen, SEARCH_DEPTH, game.state), 'w') ?? 0);
    return result;
  }

  /** Shows or hides the piece lists above (opponent) and below (player) the board. */
  private showSides(shown: boolean): void {
    $('#side-them').hidden = !shown;
    $('#side-you').hidden = !shown;
  }

  /**
   * Each side's remaining pieces, grouped by type (most valuable first) with a count, and its total
   * points: the opponent's above the board, the player's below. The player is white in the FEN.
   */
  private renderSides(fen: string, files: number): void {
    const counts: Record<Color, Map<PieceType, number>> = { w: new Map(), b: new Map() };
    for (const row of parsePlacement(fen, files)) {
      for (const cell of row) if (cell) counts[cell.color].set(cell.type, (counts[cell.color].get(cell.type) ?? 0) + 1);
    }
    const mat = material(fen);
    const line = (side: Color, label: string) => {
      const types = [...counts[side].keys()].sort(
        (a, b) => Number(b === 'K') - Number(a === 'K') || PIECE_VALUE[b] - PIECE_VALUE[a],
      );
      const pieces = types
        .map((t) => {
          const n = counts[side].get(t)!;
          return `<span class="side-piece" title="${PIECE_NAME[t]}">${inlinePiece(t, side)}${n > 1 ? `<small>×${n}</small>` : ''}</span>`;
        })
        .join('');
      const lead = mat[side] - mat[side === 'w' ? 'b' : 'w'];
      const leadText = lead > 0 ? ` <span class="side-lead">+${lead}</span>` : '';
      return `<span class="side-label">${label}</span><span class="side-list">${pieces}</span><span class="side-points">${mat[side]} pts${leadText}</span>`;
    };
    $('#side-them').innerHTML = line('b', 'Opponent');
    $('#side-you').innerHTML = line('w', 'You');
  }

  /** Waits for the player's move (picking a promotion if there's a choice), Undo or Resign. */
  private waitForPlayer(game: ManualBattle): Promise<PlayerAction> {
    return new Promise((resolve) => {
      const done = (action: PlayerAction) => {
        this.pending = null;
        this.promo.hidden = true;
        resolve(action);
      };
      this.pending = done;
      const legal = game.legalMoves();
      this.view.setInput({
        legal,
        onPick: (from, to) => {
          const moves = (legal.get(from) ?? []).filter((uci) => uci.slice(from.length).startsWith(to));
          const exact = moves.filter((uci) => uci.length === from.length + to.length);
          if (moves.length === 1 || exact.length === moves.length) {
            done({ kind: 'move', uci: moves[0] });
            return;
          }
          // Several moves to the same square: a promotion. Ask which piece.
          this.status.textContent = 'Promote to:';
          this.promo.hidden = false;
          this.promo.innerHTML = moves
            .map((uci) => {
              const type = uci.slice(from.length + to.length).toUpperCase() as PieceType;
              return `<button type="button" data-uci="${uci}" aria-label="${PIECE_NAME[type]}">${inlinePiece(type)}</button>`;
            })
            .join('');
          this.promo.onclick = (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-uci]');
            if (btn) done({ kind: 'move', uci: btn.dataset.uci! });
          };
        },
      });
    });
  }

  private waiting = false;
  /** Set by abort(): the battle being played stops at its next move. */
  private aborted = false;
  /** The most points the player was behind in the last Play it game (for records). */
  manualWorstDeficit = 0;
  /** True while a Play it game is on screen; pauseRequested makes it stop at the player's next turn. */
  private inManual = false;
  private pauseRequested = false;

  /**
   * Leaves a Play it game for the menu: at once on the player's turn, or right after the opponent's
   * move. Returns false if no Play it game is running.
   */
  pauseManual(): boolean {
    if (!this.inManual) return false;
    this.pauseRequested = true;
    this.pending?.({ kind: 'pause' });
    return true;
  }

  /** Stops the battle being played (play() then rejects with BattleAborted). */
  abort(): void {
    this.aborted = true;
  }

  /** Hides the result card and shows `text` while waiting on other players (online matches). */
  showWaiting(text: string): void {
    this.section.hidden = false;
    this.result.hidden = true;
    this.playback.hidden = true;
    this.status.textContent = text;
    this.waiting = true;
  }

  isWaiting(): boolean {
    return this.waiting && !this.section.hidden;
  }

  /** Replaces the status line (e.g. while other battles finish). */
  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /**
   * Shows a result card with custom text (used by multiplayer matches): `tone` colours the title
   * like a win, loss or draw; the main button runs `onButton`. No replay button.
   */
  showCard(card: {
    title: string;
    detail: string;
    tone: 'w' | 'b' | 'draw';
    button: string;
    onButton: () => void;
    /** More buttons under the main ones (e.g. Watch for each other battle). */
    extras?: CardButton[];
  }): void {
    this.playback.hidden = true;
    this.manual.hidden = true;
    this.result.hidden = false;
    this.result.dataset.winner = card.tone;
    this.section.hidden = false; // a match battle that never started (both kings in check) shows only this card
    this.waiting = false;
    this.status.textContent = 'Final position';
    $('#result-title').textContent = card.title;
    $('#result-detail').textContent = card.detail;
    $('#replay').hidden = true;
    $('#prestige').hidden = true;
    $('#run-summary').hidden = true;
    $('#next').textContent = card.button;
    this.nextOverride = card.onButton;
    this.setCardExtras(card.extras ?? []);
  }

  /** Replaces the custom card's extra buttons. */
  setCardExtras(extras: CardButton[]): void {
    this.extras = extras;
    const box = $('#card-extras');
    box.hidden = extras.length === 0;
    box.innerHTML = extras
      .map((b, i) => `<button type="button" data-extra="${i}">${escapeHtml(b.label)}</button>`)
      .join('');
  }

  /** True while the result card is on screen. */
  cardShowing(): boolean {
    return !this.section.hidden && !this.result.hidden;
  }

  /** Updates the result card's text (e.g. as other battles' results come in). */
  setCardDetail(text: string): void {
    $('#result-detail').textContent = text;
  }

  /** Changes what the result card's main button says and does. */
  setCardButton(label: string, onButton: () => void): void {
    $('#next').textContent = label;
    this.nextOverride = onButton;
  }

  /** Shows how the battle ended and what it did to the run. `spec` is the board it was played on. */
  showResult(result: BattleResult, outcome: BattleOutcome, spec: BoardSpec, lives: number, best: number): void {
    this.setCardExtras([]);
    this.showAwards([]);
    const { winner, reason, material } = result;
    $('#replay').hidden = false;
    $('#prestige').hidden = true;
    const summary$ = $('#run-summary');
    summary$.hidden = !outcome.over;
    summary$.innerHTML = outcome.over ? runSummary(outcome.history) : '';
    this.nextOverride = null;
    this.playback.hidden = true;
    this.result.hidden = false;
    this.result.dataset.winner = outcome.won ? 'w' : outcome.over ? 'b' : winner;
    this.status.textContent = 'Final position';

    const moves = Math.ceil(result.plies / 2);
    const verb = winner === 'draw' ? 'Drawn' : winner === 'w' ? 'You won' : 'You lost';
    // A move-limit result is a normal way to win, so name it plainly instead of looking like a stuck game.
    const summary =
      reason === 'move-limit'
        ? `${verb} on points, ${material.w}–${material.b}, at the ${plyLimit(spec) / 2}-move limit.`
        : reason === 'insufficient' && winner !== 'draw'
          ? `${verb} on points, ${material.w}–${material.b}: neither side could checkmate any more.`
          : `${verb} ${REASON_TEXT[reason]}. Material ${material.w}–${material.b} after ${moves} moves.`;
    if (outcome.won) {
      const r = outcome.record;
      $('#result-title').textContent = '🏆 Run complete!';
      $('#result-detail').textContent =
        `${summary} You got through all ${FINAL_ROUND} rounds: ${r.w} won, ${r.l} lost, ${r.d} drawn. ${outcome.newBest ? 'New best!' : `Best: ${best}.`}`;
      $('#next').textContent = 'New game';
      const prestige = $<HTMLButtonElement>('#prestige');
      prestige.hidden = false;
      prestige.textContent = `Prestige ★${outcome.prestige + 1}: start over with a perk`;
    } else if (outcome.over) {
      const rounds = `${outcome.score} round${outcome.score === 1 ? '' : 's'}`;
      $('#result-title').textContent = 'Game over';
      $('#result-detail').textContent =
        `${summary} You won ${rounds}. ${outcome.newBest ? 'New best!' : `Best: ${best}.`}`;
      $('#next').textContent = 'New run';
    } else {
      const title = winner === 'w' ? 'Victory' : winner === 'b' ? 'Defeat' : 'Draw';
      $('#result-title').textContent = wonOnPoints(result) || reason === 'move-limit' ? `${title} on points` : title;
      const lifeNote = winner === 'b' ? ` −1 life (${lives} left).` : '';
      $('#result-detail').textContent = `${summary} +${outcome.income} gold.${lifeNote}`;
      $('#next').textContent = 'Next round';
    }
  }

  /** Lists the achievements this battle unlocked on the result card (the notices are easy to miss). */
  showAwards(names: string[]): void {
    const el = $('#result-awards');
    el.hidden = names.length === 0;
    el.textContent = names.length ? `🏆 New: ${names.join(', ')}` : '';
  }

  private resetResign(): void {
    clearTimeout(this.resignTimer);
    delete this.resignBtn.dataset.confirm;
    this.resignBtn.textContent = 'Resign';
  }

  private renderPlaybackButtons(): void {
    for (const b of this.playback.querySelectorAll<HTMLButtonElement>('.speed')) {
      b.classList.toggle('active', Number(b.dataset.speed) === this.speed && !this.skipping);
    }
    $<HTMLButtonElement>('#skip').disabled = this.skipping;
  }

  /** Updates the eval bar. Scores are from the player's (white's) side: positive = you're ahead. */
  private showEval(score: number): void {
    const bar = $('#eval-bar');
    const label = $('#eval-label');
    const share = evalShare(score);
    $('#eval-fill').style.width = `${share * 100}%`;
    const text = formatEval(score);
    label.textContent = text;
    label.dataset.side = share > 0.5 ? 'you' : share < 0.5 ? 'them' : 'even';
    bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    bar.setAttribute('aria-valuetext', `${text} (${share >= 0.5 ? 'you' : 'opponent'} ahead)`);
  }
}

/**
 * The end-of-run summary: your army's points against your opponents' round by round (losses
 * marked), the best win streak and the biggest army.
 */
function runSummary(history: RoundLog[]): string {
  if (history.length === 0) return '';
  const top = Math.max(1, ...history.flatMap((h) => [h.you, h.them]));
  const x = (i: number) => (history.length === 1 ? 50 : (i / (history.length - 1)) * 100);
  const y = (v: number) => 38 - (v / top) * 34;
  const line = (pick: (h: RoundLog) => number) =>
    history.map((h, i) => `${x(i).toFixed(1)},${y(pick(h)).toFixed(1)}`).join(' ');
  const losses = history
    .map((h, i) =>
      h.winner === 'b' ? `<circle cx="${x(i).toFixed(1)}" cy="${y(h.you).toFixed(1)}" r="1.6" class="loss" />` : '',
    )
    .join('');
  const peak = Math.max(...history.map((h) => h.you));
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Army points by round: you and your opponents">
      <polyline points="${line((h) => h.them)}" class="them" />
      <polyline points="${line((h) => h.you)}" class="you" />${losses}
    </svg>
    <p class="summary-legend"><span class="you">● You</span> <span class="them">● Opponents</span> · ${history.length} rounds</p>
    <p class="summary-stats">Best streak <strong>${bestStreak(history)}</strong> · Biggest army <strong>${peak} pts</strong></p>`;
}

/** The last recorded eval among the first `count` moves (0 before any). */
function latestEval(evals: (number | null)[], count: number): number {
  for (let i = Math.min(count, evals.length) - 1; i >= 0; i--) {
    const e = evals[i];
    if (e !== null && e !== undefined) return e;
  }
  return 0;
}
