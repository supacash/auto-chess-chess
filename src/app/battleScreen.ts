import { type BoardSpec, plyLimit } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import type { Move } from '../chess/rules';
import { checkmateEval, evalShare, formatEval, whiteEval } from '../engine/pick';
import type { ManualBattle, ManualState } from '../game/manualBattle';
import { type MoveSource, runBattle, SEARCH_DEPTH } from '../game/runBattle';
import { type BattleResult, type EndReason, material, wonOnPoints } from '../rules/battle';
import { roundIncome } from '../rules/economy';
import type { Rng } from '../rules/rng';
import { PIECE_NAME, type PieceType } from '../rules/pieces';
import { BattleView } from '../ui/battleView';
import { displayColor, inlinePiece } from '../ui/boardDom';
import { $, sleep } from './dom';
import type { BattleOutcome } from './session';

/** Base playback time per move at 1× speed. */
const MOVE_MS = 400;
/** Pause on the starting position before the first move. */
const INTRO_MS = 700;

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
  private speed = 1;
  private skipping = false;
  /** Resolves the player's pending turn in a manual game. */
  private pending: ((action: PlayerAction) => void) | null = null;
  private resignTimer = 0;

  constructor(onNext: () => void) {
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
    $('#next').addEventListener('click', onNext);
  }

  hide(): void {
    this.section.hidden = true;
  }

  /** Shows and plays a battle from `fen` on `spec` until it ends. */
  async play(engine: MoveSource, fen: string, firstMover: Color, spec: BoardSpec, rng: Rng): Promise<BattleResult> {
    this.speed = 1;
    this.skipping = false;
    this.renderPlaybackButtons();
    this.section.hidden = false;
    this.result.hidden = true;
    this.playback.hidden = false;
    this.manual.hidden = true;
    $('#eval').hidden = false;

    const limit = plyLimit(spec);
    this.view.render(fen, spec);
    // The bar's light side is White's: flip it when the player is Black.
    $('#eval-bar').classList.toggle('as-black', displayColor('w') === 'b');
    this.showEval(0);
    this.status.textContent = firstMover === 'w' ? 'You move first' : 'Opponent moves first';
    await sleep(INTRO_MS);

    const result = await runBattle(
      fen,
      engine,
      rng,
      async (move, game, plies, evalScore) => {
        const ms = this.skipping ? 0 : MOVE_MS / this.speed;
        this.view.render(game.fen(), game.spec, {
          last: move,
          animateMs: this.reduceMotion ? 0 : ms * 0.8,
          check: game.isCheck(),
        });
        if (evalScore !== null) this.showEval(evalScore);
        const mat = material(game.fen());
        this.status.textContent = this.skipping
          ? 'Skipping…'
          : `Move ${Math.ceil(plies / 2)}/${limit / 2} · Material ${mat.w}–${mat.b}`;
        if (ms) await sleep(ms);
      },
      { plyLimit: limit },
      spec,
    );

    if (result.reason === 'checkmate' && result.winner !== 'draw') this.showEval(checkmateEval(result.winner));
    return result;
  }

  /**
   * Shows a game where the player moves their own pieces and the engine plays the opponent, until it
   * ends. `onSave` gets the game after every move (and undo) so a reload can resume it. The eval bar
   * stays hidden until the game is over.
   */
  async playManual(
    engine: MoveSource,
    game: ManualBattle,
    rng: Rng,
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
        draw(await game.opponentMove(engine, rng));
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

  /** Shows how the battle ended and what it did to the run. `spec` is the board it was played on. */
  showResult(result: BattleResult, outcome: BattleOutcome, spec: BoardSpec, lives: number, best: number): void {
    const { winner, reason, material } = result;
    this.playback.hidden = true;
    this.result.hidden = false;
    this.result.dataset.winner = outcome.over ? 'b' : winner;
    this.status.textContent = '';

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
