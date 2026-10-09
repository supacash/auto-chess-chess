import { type BoardSpec, plyLimit } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import { Game, type Move } from '../chess/rules';
import { mirrorFen, mirrorSquare } from '../chess/fen';
import { checkmateEval, evalShare, formatEval, whiteEval } from '../engine/pick';
import type { ManualBattle, ManualState } from '../game/manualBattle';
import { type BattleRecord, recordBoard } from '../game/record';
import { type MoveSource, runBattle, SEARCH_DEPTH } from '../game/runBattle';
import { type BattleResult, type EndReason, material, wonOnPoints } from '../rules/battle';
import { roundIncome } from '../rules/economy';
import type { Rng } from '../rules/rng';
import { PIECE_NAME, type PieceType } from '../rules/pieces';
import { BattleView } from '../ui/battleView';
import { displayColor, inlinePiece, setPlayerColor } from '../ui/boardDom';
import { $, sleep } from './dom';
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
}

/** Thrown by play() when the battle was stopped with abort(). */
export class BattleAborted extends Error {
  constructor() {
    super('Battle stopped');
  }
}

type PlayerAction = { kind: 'move'; uci: string } | { kind: 'undo' } | { kind: 'resign' };

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

  constructor(onNext: () => void, onReplay: () => void) {
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
    }: { flip?: boolean; opponent?: string; announceSide?: boolean } = {},
  ): Promise<Playback> {
    // In a match the player's pieces are drawn in their real colour (black when they're Black); the
    // mirrored position puts them at the bottom either way.
    if (announceSide) setPlayerColor(flip ? 'b' : 'w');
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
    $('#eval').hidden = false;

    const limit = plyLimit(spec);
    this.view.render(show(fen), spec);
    // The bar's light side is White's: flip it when the player is Black.
    $('#eval-bar').classList.toggle('as-black', displayColor('w') === 'b');
    this.showEval(0);
    const against = opponent ? ` against ${opponent}` : '';
    if (announceSide) {
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
    const result = await runBattle(
      fen,
      engine,
      rng,
      async (move, game, plies, evalScore) => {
        if (this.aborted) throw new BattleAborted();
        moves.push(move.uci);
        evals.push(evalScore);
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
    return { result, moves, evals };
  }

  /**
   * Replays a finished battle move by move with the playback controls, then calls `onDone` from
   * the Done button. Manual games show no eval bar (none was recorded).
   */
  async replay(record: BattleRecord, onDone: () => void): Promise<void> {
    const spec = recordBoard(record);
    if (!spec) return;
    this.speed = 1;
    this.skipping = false;
    this.renderPlaybackButtons();
    const resultWasShown = !this.section.hidden && !this.result.hidden;
    this.section.hidden = false;
    this.result.hidden = true;
    this.manual.hidden = true;
    this.replayDone.hidden = true;
    this.playback.hidden = false;
    $('#eval').hidden = record.manual;
    $('#eval-bar').classList.toggle('as-black', displayColor('w') === 'b');
    this.showEval(0);

    const game = new Game(spec, record.fen);
    try {
      this.view.render(game.fen(), spec);
      this.status.textContent = 'Replay';
      await sleep(INTRO_MS);
      for (let i = 0; i < record.moves.length; i++) {
        const move = game.play(record.moves[i]);
        if (!move) break; // made under rules this build doesn't have
        const ms = this.skipping ? 0 : MOVE_MS / this.speed;
        this.view.render(game.fen(), spec, {
          last: move,
          animateMs: this.reduceMotion ? 0 : ms * 0.8,
          check: game.isCheck(),
        });
        const score = record.evals[i];
        if (score !== null && score !== undefined) this.showEval(score);
        this.status.textContent = this.skipping ? 'Skipping…' : `Replay · move ${Math.ceil((i + 1) / 2)}`;
        if (ms) await sleep(ms);
      }
    } finally {
      game.delete();
    }
    const { result } = record;
    if (result.reason === 'checkmate' && result.winner !== 'draw') this.showEval(checkmateEval(result.winner));
    this.status.textContent = 'Replay finished';
    this.playback.hidden = true;
    this.replayDone.hidden = false;
    this.replayDone.onclick = () => {
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
    await engine.newGame(game.spec.variant);

    const draw = (last?: Move) =>
      this.view.render(game.fen, game.spec, {
        last,
        animateMs: last && !this.reduceMotion ? 150 : 0,
        check: game.isCheck(),
      });
    draw();

    let result = game.result();
    while (!result) {
      if (game.playerToMove) {
        this.status.textContent = game.isCheck() ? 'Your move: you are in check!' : 'Your move';
        this.undoBtn.disabled = !game.canUndo();
        this.resignBtn.disabled = false;
        const action = await this.waitForPlayer(game);
        this.view.setInput(null);
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
    // The game's over: show the eval now.
    $('#eval').hidden = false;
    if (result.reason === 'checkmate' && result.winner !== 'draw') this.showEval(checkmateEval(result.winner));
    else this.showEval(whiteEval(await engine.candidates(game.fen, SEARCH_DEPTH, game.state), 'w') ?? 0);
    return result;
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

  /** Stops the battle being played (play() then rejects with BattleAborted). */
  abort(): void {
    this.aborted = true;
  }

  /** Hides the result card and shows `text` while waiting on other players (online matches). */
  showWaiting(text: string): void {
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
  }): void {
    this.playback.hidden = true;
    this.manual.hidden = true;
    this.result.hidden = false;
    this.result.dataset.winner = card.tone;
    this.waiting = false;
    this.status.textContent = 'Final position';
    $('#result-title').textContent = card.title;
    $('#result-detail').textContent = card.detail;
    $('#replay').hidden = true;
    $('#next').textContent = card.button;
    this.nextOverride = card.onButton;
  }

  /** Shows how the battle ended and what it did to the run. `spec` is the board it was played on. */
  showResult(result: BattleResult, outcome: BattleOutcome, spec: BoardSpec, lives: number, best: number): void {
    const { winner, reason, material } = result;
    $('#replay').hidden = false;
    this.nextOverride = null;
    this.playback.hidden = true;
    this.result.hidden = false;
    this.result.dataset.winner = outcome.over ? 'b' : winner;
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
    if (outcome.over) {
      const rounds = `${outcome.score} round${outcome.score === 1 ? '' : 's'}`;
      $('#result-title').textContent = 'Game over';
      $('#result-detail').textContent =
        `${summary} You won ${rounds}. ${outcome.newBest ? 'New best!' : `Best: ${best}.`}`;
      $('#next').textContent = 'New run';
    } else {
      const title = winner === 'w' ? 'Victory' : winner === 'b' ? 'Defeat' : 'Draw';
      $('#result-title').textContent = wonOnPoints(result) || reason === 'move-limit' ? `${title} on points` : title;
      const lifeNote = winner === 'b' ? ` −1 life (${lives} left).` : '';
      $('#result-detail').textContent = `${summary} +${roundIncome(winner)} gold.${lifeNote}`;
      $('#next').textContent = 'Next round';
    }
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
