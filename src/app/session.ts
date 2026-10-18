import type { BoardSpec } from '../chess/boardSpec';
import type { BattleRecord } from '../game/record';
import { snapshotArmy } from '../game/snapshot';
import {
  clearGame,
  loadBest,
  loadGame,
  loadReplay,
  SAVE_VERSION,
  saveBest,
  saveGame,
  type SaveSlot,
  saveReplay,
} from '../game/storage';
import { RULES_VERSION } from '../game/version';
import {
  AI_STYLES,
  type AiStyle,
  aiBudget,
  budgetForSide,
  draftAiArmy,
  pickStyle,
  placeAiArmy,
  placeForBattle,
} from '../rules/aiArmy';
import type { BattleResult } from '../rules/battle';
import { difficulty, type RunSettings } from '../rules/difficulty';
import { REROLL_COST, rerollOffers, restock, rollOffers, type Shop, type ShopResult } from '../rules/economy';
import {
  crownGold,
  freeRerolls,
  interestTerms,
  maxHeirs,
  offerOdds,
  type PerkId,
  prestigePerRound,
  revealsOpponent,
} from '../rules/prestige';
import { gameMode } from '../rules/mode';
import { armyPoints, type Piece } from '../rules/pieces';
import type { ManualState } from '../game/manualBattle';
import type { PlacementSession } from './placementSession';
import { armyErrors, fitToBoard } from '../rules/placement';
import { type StartPosition, startPosition } from '../rules/position';
import { type Rng, randomSeed } from '../rules/rng';
import { type DailyDay, dailyBattle, dailyDate, dailyDay, dailyOpponent, dailyRng, newDailyRun } from '../rules/daily';
import {
  applyResult,
  battleIncome,
  canRevive,
  isRunOver,
  isRunWon,
  newRun,
  nextRound,
  type PrestigeCarry,
  revive,
  type RoundLog,
  type Run,
  runScore,
} from '../rules/run';

/** What finishing a battle did to the run, for the result screen. */
export interface BattleOutcome {
  /** The round the battle was played in (the run has already moved on unless it's over). */
  playedRound: number;
  over: boolean;
  /** True when the run ended by getting through the final round (see FINAL_ROUND). */
  won: boolean;
  /** Rounds won this run. */
  score: number;
  newBest: boolean;
  /** The run's record after this battle. */
  record: { w: number; l: number; d: number };
  /** The run's prestige level (the victory card offers the next one). */
  prestige: number;
  /** Gold the battle paid (income, perks and interest). */
  income: number;
  /** Every battle of the run so far (the summary shows it when the run ends). */
  history: RoundLog[];
  /** True in a daily challenge (no lives; five battles). */
  isDaily: boolean;
  /** The finished day, when this battle ended a daily challenge. */
  daily?: DailyDay;
  /** The day streak with this day counted (filled in by the caller from the records). */
  dailyStreak?: number;
}

/**
 * The run in progress and everything that changes it: the opponent, the best score and saving.
 * No DOM here, so the run flow can be tested without a browser.
 */
export class Session implements PlacementSession {
  run: Run = newRun();
  best = 0;
  aiPieces: Piece[] = [];
  aiStyle: AiStyle = AI_STYLES[0];
  /** The game the player is playing themselves this round, if one is in progress. */
  manual: ManualState | null = null;
  /** The last finished battle, for Review (kept across reloads). */
  lastReplay: BattleRecord | null = null;
  /** True once the run has been saved (the player has started it), so the menu offers Resume. */
  saved = false;

  /**
   * `slot` 'daily' makes this the daily challenge's session: its own save, today's run (daily.ts) and
   * every random choice from the day's seed. `now` is the clock (for tests).
   */
  constructor(
    private readonly rng: Rng = Math.random,
    readonly slot: SaveSlot = 'run',
    private readonly now: () => number = Date.now,
  ) {}

  /** The UTC day it is now ("2026-10-16"). */
  today(): string {
    return dailyDate(this.now());
  }

  /**
   * Where a random choice comes from: the session's Rng, or in a daily challenge the day's stream for
   * this battle and purpose, so everyone gets the same whatever they did before.
   */
  private stream(...purpose: (string | number)[]): Rng {
    const daily = this.run.daily;
    return daily ? dailyRng(daily.date, RULES_VERSION, dailyBattle(this.run.round), ...purpose) : this.rng;
  }

  /** The opponent shown during placement: the AI's style and army. */
  opponent(): { name: string; pieces: Piece[] } {
    return { name: this.aiStyle.name, pieces: this.aiPieces };
  }

  /** The board a round is played on (in Growing mode it grows every few rounds). */
  boardOf(round = this.run.round): BoardSpec {
    return gameMode(this.run.settings.mode).board(round);
  }

  get board(): BoardSpec {
    return this.boardOf();
  }

  /** Why the army can't fight yet (empty = ready). */
  armyErrors(): string[] {
    return armyErrors(this.run.shop.pieces, this.board, this.maxHeirs());
  }

  maxHeirs(): number {
    return maxHeirs(this.run.perks);
  }

  /** `battleInProgress` marks a battle as started, so leaving mid-battle counts as a loss on the next load. */
  persist(battleInProgress = false): void {
    this.saved = true;
    saveGame(
      {
        version: SAVE_VERSION,
        run: this.run,
        ai: { styleId: this.aiStyle.id, pieces: this.aiPieces },
        ...(battleInProgress ? { battleInProgress: true } : {}),
        ...(this.manual ? { manual: this.manual } : {}),
      },
      this.slot,
    );
  }

  /**
   * Resumes the saved run, or starts a default one (`firstVisit`). A battle left unfinished counts
   * as a loss; `notice` explains that.
   */
  restore(): { notice: string; firstVisit: boolean; daily?: DailyDay } {
    this.lastReplay = loadReplay();
    const saved = loadGame(this.slot);
    const style = saved && AI_STYLES.find((s) => s.id === saved.ai.styleId);
    if (!saved || !style || (this.slot === 'daily' && !saved.run.daily)) {
      this.saved = false;
      this.run = this.slot === 'daily' ? newDailyRun(this.today()) : newRun();
      this.draftOpponent();
      this.best = this.loadBest();
      return { notice: '', firstVisit: true };
    }
    this.run = saved.run;
    this.saved = true;
    this.aiStyle = style;
    this.aiPieces = saved.ai.pieces;
    this.manual = saved.manual ?? null;
    if (!this.run.shop.offers) {
      this.run = {
        ...this.run,
        shop: {
          ...this.run.shop,
          offers: rollOffers(this.run.round, this.stream('shop'), this.run.settings.fairy, offerOdds(this.run.perks)),
        },
      };
    }
    this.best = this.loadBest();
    if (!saved.battleInProgress) return { notice: '', firstVisit: false };

    // The page was closed or reloaded mid-battle: count it as a loss.
    this.run = applyResult(this.run, 'b');
    const day = dailyDay(this.run);
    if (day) {
      clearGame(this.slot);
      this.saved = false;
      return {
        notice: `Your last battle was interrupted and counted as a loss. The daily challenge is over: ${day.score} points.`,
        firstVisit: false,
        daily: day,
      };
    }
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
      notice: this.run.daily
        ? 'Your last battle was interrupted and counted as a loss.'
        : `Your last battle was interrupted and counted as a loss (−1 life, ${this.run.lives} left).`,
      firstVisit: false,
    };
  }

  /** Starts over, keeping the current settings unless new ones are given. */
  startNewRun(settings: RunSettings = this.run.settings, carry?: PrestigeCarry): void {
    clearGame(this.slot);
    this.manual = null;
    this.run = newRun(settings, this.rng, carry);
    this.best = this.loadBest();
    this.draftOpponent();
    this.persist(); // a run the player chose: the menu offers Resume from now on
  }

  /**
   * Starts today's daily challenge (a daily session only). False if it was already started, finished
   * (`done`, from the records) or a challenge from an earlier day is still in progress.
   */
  startDaily(done: boolean): boolean {
    if (this.slot !== 'daily' || done || this.saved) return false;
    this.manual = null;
    this.run = newDailyRun(this.today());
    this.draftOpponent();
    this.persist();
    return true;
  }

  /** The daily challenge's five opponents (empty for a normal run). */
  gauntlet(): ReturnType<typeof dailyOpponent>[] {
    const daily = this.run.daily;
    if (!daily) return [];
    return [1, 2, 3, 4, 5].map((battle) => dailyOpponent(daily.date, RULES_VERSION, battle));
  }

  /** Drafts this round's opponent and stocks the shop with fresh offers. */
  draftOpponent(): void {
    this.run = {
      ...this.run,
      shop: restock(
        this.run.shop,
        this.run.round,
        this.stream('shop'),
        this.run.settings.fairy,
        offerOdds(this.run.perks),
      ),
    };
    const daily = this.run.daily;
    if (daily) {
      const opponent = dailyOpponent(daily.date, RULES_VERSION, dailyBattle(this.run.round));
      this.aiStyle = opponent.style;
      this.aiPieces = opponent.pieces;
      return;
    }
    const spec = this.board;
    const { settings } = this.run;
    const mode = gameMode(settings.mode);
    this.aiStyle = pickStyle(this.rng, settings.fairy);
    const budget = budgetForSide(
      aiBudget(
        this.run.round,
        this.rng,
        prestigePerRound(difficulty(settings.difficulty).perRound, this.run.prestige),
        mode.roundOneDiscount,
        mode.aiBonus,
      ),
      this.run.color === 'w',
    );
    this.aiPieces = placeAiArmy(
      draftAiArmy(budget, this.aiStyle, this.rng, spec, settings.fairy, this.run.round),
      this.aiStyle,
      this.rng,
      spec,
    );
  }

  /** Pays for a fresh set of offers (doesn't apply it: see setShop). Haggler makes the first ones each round free. */
  rerollOffers(): ShopResult {
    const cost = this.rerollCost();
    const daily = this.run.daily;
    const result = rerollOffers(
      this.run.shop,
      this.run.round,
      this.stream('reroll', daily?.rerolls ?? 0),
      this.run.settings.fairy,
      cost,
      offerOdds(this.run.perks),
    );
    if (result.ok && daily) this.run = { ...this.run, daily: { ...daily, rerolls: daily.rerolls + 1 } };
    if (result.ok && cost === 0) {
      this.run = { ...this.run, freeRerolls: { round: this.run.round, used: this.freeRerollsUsed() + 1 } };
    }
    return result;
  }

  /** Haggler's free rerolls used this round. */
  private freeRerollsUsed(): number {
    const { freeRerolls: used, round } = this.run;
    return used?.round === round ? used.used : 0;
  }

  /** What the next reroll costs this round. */
  rerollCost(): number {
    return this.freeRerollsUsed() < freeRerolls(this.run.perks) ? 0 : REROLL_COST;
  }

  /** How interest is paid this run (Banker changes it). */
  interestTerms(): { step: number; max: number } {
    return interestTerms(this.run.perks);
  }

  /** True when placement shows the opponent's pieces: the Reveal setting, or Spyglass. */
  revealOpponent(): boolean {
    return this.run.settings.reveal || revealsOpponent(this.run.perks);
  }

  /** Gold paid for crowning an Heir (Dynasty). */
  crownGold(): number {
    return crownGold(this.run.perks);
  }

  /** Starts the next prestige level after a won run, keeping the perks plus `picked`. */
  startPrestige(picked: PerkId): void {
    this.startNewRun(this.run.settings, { prestige: this.run.prestige + 1, perks: [...this.run.perks, picked] });
  }

  /** Saves the manual game in progress (or clears it with null), so a reload resumes it. */
  saveManual(state: ManualState | null): void {
    this.manual = state;
    this.persist();
  }

  /** A fresh seed for a battle's move picking. */
  newSeed(): number {
    return randomSeed(this.stream('battle'));
  }

  /**
   * The parts of a battle record known when it starts (call before finishBattle, which moves the
   * run on to the next round): the round, board and the player's army as placed.
   */
  startRecord(fen: string, seed: number, manual: boolean): Omit<BattleRecord, 'moves' | 'evals' | 'result'> {
    const { settings, round, shop } = this.run;
    const spec = this.board;
    return {
      format: 1,
      rules: RULES_VERSION,
      board: spec.variant,
      round,
      fen,
      seed,
      manual,
      player: snapshotArmy(shop.pieces, spec, { mode: settings.mode, round, fairy: settings.fairy }),
    };
  }

  /** Keeps a finished battle for Review. */
  saveReplay(record: BattleRecord): void {
    this.lastReplay = record;
    saveReplay(record);
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
    const playerFirst = this.run.color === 'w';
    const synergies = this.run.settings.synergies === true;
    const start = startPosition(this.run.shop.pieces, this.aiPieces, playerFirst, this.board, synergies);
    if (start.ok) return start;
    const types = this.aiPieces.map((p) => p.type);
    const placed = placeForBattle(
      this.run.shop.pieces,
      types,
      this.aiStyle,
      this.stream('place'),
      this.board,
      playerFirst,
      synergies,
    );
    this.aiPieces = placed.ai;
    return placed.start;
  }

  /**
   * Applies a finished battle and, unless the run is over, immediately advances to the next round
   * and drafts its opponent, so reloading on the result screen can't replay the round.
   */
  finishBattle(result: BattleResult): BattleOutcome {
    const playedRound = this.run.round;
    const income = battleIncome(this.run, result.winner);
    const points = (pieces: Piece[]) => armyPoints(pieces.map((p) => p.type));
    const log: RoundLog = {
      you: points(this.run.shop.pieces.filter((p) => p.square)),
      them: points(this.aiPieces),
      winner: result.winner,
    };
    this.run = { ...this.run, history: [...(this.run.history ?? []), log] };
    this.manual = null;
    this.run = applyResult(this.run, result.winner);
    const over = isRunOver(this.run);
    const score = runScore(this.run);
    let newBest = false;
    const day = dailyDay(this.run) ?? undefined;
    if (over) {
      if (!day) newBest = this.recordScore(score);
      clearGame(this.slot);
      if (day) this.saved = false; // the daily is done: nothing to resume
    } else {
      this.run = nextRound(this.run, this.rng);
      this.draftOpponent();
      this.persist();
    }
    const won = isRunWon(this.run);
    return {
      playedRound,
      over,
      won,
      score,
      newBest,
      record: { ...this.run.record },
      prestige: this.run.prestige,
      income,
      history: this.run.history ?? [],
      isDaily: this.run.daily !== undefined,
      ...(day ? { daily: day } : {}),
    };
  }

  /** True when the run just lost on lives can still be revived (see canRevive). */
  canRevive(): boolean {
    return canRevive(this.run);
  }

  /**
   * Revives the run just lost on lives with one life (after a rewarded ad) and moves on to the next
   * round. False if it can't be revived.
   */
  revive(): boolean {
    if (!canRevive(this.run)) return false;
    this.run = nextRound(revive(this.run), this.rng);
    this.draftOpponent();
    this.persist();
    return true;
  }

  private loadBest(): number {
    return loadBest(this.run.settings.difficulty, this.run.settings.mode, this.run.settings.manual);
  }

  /** Saves `score` if it beats the best for this mode and difficulty. */
  private recordScore(score: number): boolean {
    if (score <= this.best) return false;
    this.best = score;
    saveBest(score, this.run.settings.difficulty, this.run.settings.mode, this.run.settings.manual);
    return true;
  }
}
