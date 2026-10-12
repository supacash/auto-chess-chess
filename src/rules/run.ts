import type { Color } from '../chess/fen';
import type { Winner } from './battle';
import { DEFAULT_SETTINGS, type RunSettings, type SideId } from './difficulty';
import { interest, roundIncome, type Shop, startingShop } from './economy';
import { gameMode } from './mode';
import { makePiece } from './pieces';
import { extraIncome, extraLives, type PerkId, perkCount, startGold } from './prestige';
import type { Rng } from './rng';

export const START_LIVES = 3;
/**
 * A run is won by getting through this round. By then both armies are a full board of queens and
 * battles stop being interesting, so the run ends on a high instead of fading out.
 */
export const FINAL_ROUND = 25;

/** Everything that persists across rounds of one run. */
export interface Run {
  round: number;
  lives: number;
  record: { w: number; l: number; d: number };
  shop: Shop;
  settings: RunSettings;
  /** The player's colour this round; white moves first. */
  color: Color;
  /** Set by the battle that won the run (see FINAL_ROUND). */
  won?: boolean;
  /** Prestige level (0 = a first run); see prestige.ts. */
  prestige: number;
  /** Perks kept from earlier prestiges, one per level. */
  perks: PerkId[];
  /** The round the Haggler perk's free reroll was last used in. */
  freeRerollRound?: number;
  /** One entry per battle fought, for the end-of-run summary. */
  history?: RoundLog[];
  /** True once the run has been revived (an extra life for a rewarded ad); it can't be again. */
  revived?: boolean;
}

/** A battle in the run's history: the armies' points and how it went. */
export interface RoundLog {
  /** Points the player fielded (placed pieces). */
  you: number;
  /** Points the opponent fielded. */
  them: number;
  winner: Winner;
}

/** The run's best win streak. */
export function bestStreak(history: readonly RoundLog[]): number {
  let best = 0;
  let current = 0;
  for (const h of history) {
    current = h.winner === 'w' ? current + 1 : h.winner === 'b' ? 0 : current;
    best = Math.max(best, current);
  }
  return best;
}

/** What a new run carries over from the one it prestiges from. */
export interface PrestigeCarry {
  prestige: number;
  perks: PerkId[];
}

/** The player's colour for a round under `side`. */
export function rollColor(side: SideId, rng: Rng): Color {
  if (side === 'random') return rng() < 0.5 ? 'w' : 'b';
  return side === 'black' ? 'b' : 'w';
}

export function newRun(
  settings: RunSettings = DEFAULT_SETTINGS,
  rng: Rng = Math.random,
  carry: PrestigeCarry = { prestige: 0, perks: [] },
): Run {
  const mode = gameMode(settings.mode);
  const shop = startingShop(mode.startArmy);
  const knights = Array.from({ length: perkCount(carry.perks, 'knight') }, () => makePiece('N'));
  return {
    round: 1,
    lives: maxLives(carry.perks),
    record: { w: 0, l: 0, d: 0 },
    shop: { ...shop, gold: startGold(carry.perks) + mode.extraGold, pieces: [...shop.pieces, ...knights] },
    settings,
    color: rollColor(settings.side, rng),
    prestige: carry.prestige,
    perks: [...carry.perks],
  };
}

/** Lives a run starts with: START_LIVES plus Second wind. */
export function maxLives(perks: readonly PerkId[]): number {
  return START_LIVES + extraLives(perks);
}

/** True once the player has fought a battle; settings can then only change by starting a new run. */
export function hasStarted(run: Run): boolean {
  const { w, l, d } = run.record;
  return run.round > 1 || w + l + d > 0;
}

/** Applies a finished battle: record, lives (a loss costs one) and income. The round advances separately. */
export function applyResult(run: Run, winner: Winner): Run {
  const record = { ...run.record };
  if (winner === 'w') record.w++;
  else if (winner === 'b') record.l++;
  else record.d++;
  const lives = winner === 'b' ? run.lives - 1 : run.lives;
  return {
    ...run,
    record,
    lives,
    shop: { ...run.shop, gold: run.shop.gold + battleIncome(run, winner) },
    // Decided here, when a battle ends: a run saved past the final round (from before runs ended)
    // wins with its next battle rather than ending the moment it loads.
    won: lives > 0 && record.w + record.l + record.d >= FINAL_ROUND,
  };
}

/** Gold a battle pays: round income, Tithe, and interest on the gold saved before it. */
export function battleIncome(run: Run, winner: Winner): number {
  return roundIncome(winner) + extraIncome(run.perks) + interest(run.shop.gold);
}

/** Moves on to the next round, picking the player's colour for it. */
export function nextRound(run: Run, rng: Rng = Math.random): Run {
  return { ...run, round: run.round + 1, color: rollColor(run.settings.side, rng) };
}

/** Rounds fought so far. */
export function roundsPlayed(run: Run): number {
  return run.record.w + run.record.l + run.record.d;
}

/** True once the player has got through FINAL_ROUND battles with a life left. */
export function isRunWon(run: Run): boolean {
  return run.won === true;
}

/** True when the run has ended: out of lives, or won. */
export function isRunOver(run: Run): boolean {
  return run.lives <= 0 || isRunWon(run);
}

/** True when a run lost on lives can be revived once with an extra life (a rewarded ad). */
export function canRevive(run: Run): boolean {
  return run.lives <= 0 && !isRunWon(run) && !run.revived;
}

/** Revives a run lost on lives: one life back, once per run. The round advances separately. */
export function revive(run: Run): Run {
  if (!canRevive(run)) return run;
  return { ...run, lives: 1, revived: true };
}

/** The score is the number of rounds won. */
export function runScore(run: Run): number {
  return run.record.w;
}
