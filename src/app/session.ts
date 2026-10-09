import type { BoardSpec } from '../chess/boardSpec';
import { clearGame, loadBest, loadGame, SAVE_VERSION, saveBest, saveGame } from '../game/storage';
import { AI_STYLES, type AiStyle, aiBudget, draftAiArmy, pickStyle, placeAiArmy } from '../rules/aiArmy';
import type { BattleResult } from '../rules/battle';
import { difficulty, type RunSettings } from '../rules/difficulty';
import type { Shop } from '../rules/economy';
import { gameMode } from '../rules/mode';
import type { Piece } from '../rules/pieces';
import { armyErrors, fitToBoard } from '../rules/placement';
import { type StartPosition, startPosition } from '../rules/position';
import type { Rng } from '../rules/rng';
import { applyResult, isRunOver, newRun, nextRound, type Run, runScore } from '../rules/run';

/** What finishing a battle did to the run, for the result screen. */
export interface BattleOutcome {
  /** The round the battle was played in (the run has already moved on unless it's over). */
  playedRound: number;
  over: boolean;
  /** Rounds won this run. */
  score: number;
  newBest: boolean;
}

/**
 * The run in progress and everything that changes it: the opponent, the best score and saving.
 * No DOM here, so the run flow can be tested without a browser.
 */
export class Session {
  run: Run = newRun();
  best = 0;
  aiPieces: Piece[] = [];
  aiStyle: AiStyle = AI_STYLES[0];

  constructor(private readonly rng: Rng = Math.random) {}

  /** The board a round is played on (in Growing mode it grows every few rounds). */
  boardOf(round = this.run.round): BoardSpec {
    return gameMode(this.run.settings.mode).board(round);
  }

  get board(): BoardSpec {
    return this.boardOf();
  }

  /** Why the army can't fight yet (empty = ready). */
  armyErrors(): string[] {
    return armyErrors(this.run.shop.pieces, this.board);
  }

  /** `battleInProgress` marks a battle as started, so leaving mid-battle counts as a loss on the next load. */
  persist(battleInProgress = false): void {
    saveGame({
      version: SAVE_VERSION,
      run: this.run,
      ai: { styleId: this.aiStyle.id, pieces: this.aiPieces },
      ...(battleInProgress ? { battleInProgress: true } : {}),
    });
  }

  /**
   * Resumes the saved run, or starts a default one (`firstVisit`). A battle left unfinished counts
   * as a loss; `notice` explains that.
   */
  restore(): { notice: string; firstVisit: boolean } {
    const saved = loadGame();
    const style = saved && AI_STYLES.find((s) => s.id === saved.ai.styleId);
    if (!saved || !style) {
      this.run = newRun();
      this.draftOpponent();
      this.best = this.loadBest();
      return { notice: '', firstVisit: true };
    }
    this.run = saved.run;
    this.aiStyle = style;
    this.aiPieces = saved.ai.pieces;
    this.best = this.loadBest();
    if (!saved.battleInProgress) return { notice: '', firstVisit: false };

    // The page was closed or reloaded mid-battle: count it as a loss.
    this.run = applyResult(this.run, 'b');
    if (isRunOver(this.run)) {
      const score = runScore(this.run);
      const newBest = this.recordScore(score);
      this.run = newRun(this.run.settings, this.rng);
      this.draftOpponent();
      this.persist();
      const rounds = `${score} round${score === 1 ? '' : 's'}`;
      return {
        notice: `Your last battle was interrupted and counted as a loss. Game over: you won ${rounds}${newBest ? ' (new best!).' : '.'}`,
        firstVisit: false,
      };
    }
    this.run = nextRound(this.run, this.rng);
    this.draftOpponent();
    this.persist();
    return {
      notice: `Your last battle was interrupted and counted as a loss (−1 life, ${this.run.lives} left).`,
      firstVisit: false,
    };
  }

  /** Starts over, keeping the current settings unless new ones are given. */
  startNewRun(settings: RunSettings = this.run.settings): void {
    clearGame();
    this.run = newRun(settings, this.rng);
    this.best = this.loadBest();
    this.draftOpponent();
  }

  draftOpponent(): void {
    const spec = this.board;
    const { settings } = this.run;
    const mode = gameMode(settings.mode);
    this.aiStyle = pickStyle(this.rng);
    const budget = aiBudget(
      this.run.round,
      this.rng,
      difficulty(settings.difficulty).perRound,
      mode.roundOneDiscount,
      mode.aiBonus,
    );
    this.aiPieces = placeAiArmy(draftAiArmy(budget, this.aiStyle, this.rng, spec), this.aiStyle, this.rng, spec);
  }

  setPieces(pieces: Piece[]): void {
    this.run = { ...this.run, shop: { ...this.run.shop, pieces } };
    this.persist();
  }

  setShop(shop: Shop): void {
    this.run = { ...this.run, shop };
    this.persist();
  }

  /** Boards only grow, so placed pieces stay valid; this repairs saves from older versions. */
  fitPiecesToBoard(): void {
    this.run = { ...this.run, shop: { ...this.run.shop, pieces: fitToBoard(this.run.shop.pieces, this.board) } };
  }

  /** The battle's start position, re-placing the AI army if both kings would start in check. */
  resolveStart(): Extract<StartPosition, { ok: true }> {
    for (;;) {
      const spec = this.board;
      const start = startPosition(this.run.shop.pieces, this.aiPieces, this.run.color === 'w', spec);
      if (start.ok) return start;
      this.aiPieces = placeAiArmy(
        this.aiPieces.map((p) => p.type),
        this.aiStyle,
        this.rng,
        spec,
      );
    }
  }

  /**
   * Applies a finished battle and, unless the run is over, immediately advances to the next round
   * and drafts its opponent, so reloading on the result screen can't replay the round.
   */
  finishBattle(result: BattleResult): BattleOutcome {
    const playedRound = this.run.round;
    this.run = applyResult(this.run, result.winner);
    const over = isRunOver(this.run);
    const score = runScore(this.run);
    let newBest = false;
    if (over) {
      newBest = this.recordScore(score);
      clearGame();
    } else {
      this.run = nextRound(this.run, this.rng);
      this.draftOpponent();
      this.persist();
    }
    return { playedRound, over, score, newBest };
  }

  private loadBest(): number {
    return loadBest(this.run.settings.difficulty, this.run.settings.mode);
  }

  /** Saves `score` if it beats the best for this mode and difficulty. */
  private recordScore(score: number): boolean {
    if (score <= this.best) return false;
    this.best = score;
    saveBest(score, this.run.settings.difficulty, this.run.settings.mode);
    return true;
  }
}
