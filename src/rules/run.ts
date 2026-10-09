import type { Winner } from './battle';
import { roundIncome, type Shop, startingShop } from './economy';

export const START_LIVES = 3;

/** Everything that persists across rounds of one run. */
export interface Run {
  round: number;
  lives: number;
  record: { w: number; l: number; d: number };
  shop: Shop;
}

export function newRun(): Run {
  return { round: 1, lives: START_LIVES, record: { w: 0, l: 0, d: 0 }, shop: startingShop() };
}

/** Applies a finished battle: record, lives (a loss costs one) and income. The round advances separately. */
export function applyResult(run: Run, winner: Winner): Run {
  const record = { ...run.record };
  if (winner === 'w') record.w++;
  else if (winner === 'b') record.l++;
  else record.d++;
  return {
    ...run,
    record,
    lives: winner === 'b' ? run.lives - 1 : run.lives,
    shop: { ...run.shop, gold: run.shop.gold + roundIncome(winner) },
  };
}

export function nextRound(run: Run): Run {
  return { ...run, round: run.round + 1 };
}

export function isRunOver(run: Run): boolean {
  return run.lives <= 0;
}

/** The score is the number of rounds won. */
export function runScore(run: Run): number {
  return run.record.w;
}
