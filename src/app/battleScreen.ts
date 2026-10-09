import { type BoardSpec, plyLimit } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import { checkmateEval, evalShare, formatEval } from '../engine/pick';
import { type MoveSource, runBattle } from '../game/runBattle';
import { type BattleResult, type EndReason, material } from '../rules/battle';
import { roundIncome } from '../rules/economy';
import type { Rng } from '../rules/rng';
import { BattleView } from '../ui/battleView';
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
};

/** The battle screen: animated board, eval bar, playback speed, and the result. */
export class BattleScreen {
  private readonly section = $('#battle');
  private readonly status = $('#battle-status');
  private readonly result = $('#result');
  private readonly playback = $('#playback');
  private readonly view = new BattleView($('#battle-root'));
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private speed = 1;
  private skipping = false;

  constructor(onNext: () => void) {
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

    const limit = plyLimit(spec);
    this.view.render(fen, spec);
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
        : `${verb} ${REASON_TEXT[reason]}. Material ${material.w}–${material.b} after ${moves} moves.`;
    if (outcome.over) {
      const rounds = `${outcome.score} round${outcome.score === 1 ? '' : 's'}`;
      $('#result-title').textContent = 'Game over';
      $('#result-detail').textContent =
        `${summary} You won ${rounds}. ${outcome.newBest ? 'New best!' : `Best: ${best}.`}`;
      $('#next').textContent = 'New run';
    } else {
      const title = winner === 'w' ? 'Victory' : winner === 'b' ? 'Defeat' : 'Draw';
      $('#result-title').textContent = reason === 'move-limit' ? `${title} on points` : title;
      const lifeNote = winner === 'b' ? ` −1 life (${lives} left).` : '';
      $('#result-detail').textContent = `${summary} +${roundIncome(winner)} gold.${lifeNote}`;
      $('#next').textContent = 'Next round';
    }
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
