import { type Rng, randomInt } from '../rules/rng';

/** One engine line: a UCI move and its score in centipawns for the side to move. */
export interface Candidate {
  move: string;
  score: number;
}

/** Moves scoring within this many centipawns of the best are picked at random, for variety. */
export const PICK_MARGIN = 50;

const MATE_SCORE = 100_000;

export function pickMove(candidates: Candidate[], rng: Rng, margin = PICK_MARGIN): string | null {
  if (candidates.length === 0) return null;
  const best = Math.max(...candidates.map((c) => c.score));
  const pool = candidates.filter((c) => c.score >= best - margin);
  return pool[randomInt(rng, pool.length)].move;
}

/**
 * Parses a UCI `info` line with a score and PV. Mate scores map far outside centipawn range,
 * spaced so shorter mates always beat longer ones by more than PICK_MARGIN.
 */
export function parseInfo(line: string): { multipv: number; candidate: Candidate } | null {
  const m = /\bmultipv (\d+)\b.*?\bscore (cp|mate) (-?\d+)\b.*?\bpv (\S+)/.exec(line);
  if (!m) return null;
  const value = Number(m[3]);
  const score = m[2] === 'cp' ? value : value > 0 ? MATE_SCORE - value * 100 : -MATE_SCORE - value * 100;
  return { multipv: Number(m[1]), candidate: { move: m[4], score } };
}

// ---- evaluation display ----
// Scores below are from white's (the player's) point of view: positive = player ahead.

/** The best line's score for white, given candidates searched with `turn` to move. Null with no candidates. */
export function whiteEval(candidates: Candidate[], turn: 'w' | 'b'): number | null {
  if (candidates.length === 0) return null;
  const best = Math.max(...candidates.map((c) => c.score));
  return turn === 'w' ? best : -best;
}

/** Moves to mate encoded in a score: positive = white mates, negative = black mates, null = no mate. */
export function mateIn(score: number): number | null {
  if (score > MATE_SCORE / 2) return Math.round((MATE_SCORE - score) / 100);
  if (score < -MATE_SCORE / 2) return Math.round((-MATE_SCORE - score) / 100);
  return null;
}

/** Score for a delivered checkmate, for showing a finished game. */
export function checkmateEval(winner: 'w' | 'b'): number {
  return winner === 'w' ? MATE_SCORE : -MATE_SCORE;
}

/** White's share of an eval bar, 0..1. Uses the same win-chance curve as Lichess so small edges stay visible. */
export function evalShare(score: number): number {
  const mate = mateIn(score);
  if (mate !== null) return score > 0 ? 1 : 0;
  const winChance = 2 / (1 + Math.exp(-0.00368208 * score)) - 1;
  return 0.5 + 0.5 * winChance;
}

/** Short label: "+1.3", "−0.4", "0.0", "M3" (white mates in 3), "−M2", or "#" when the mate has happened. */
export function formatEval(score: number): string {
  const mate = mateIn(score);
  if (mate !== null) {
    if (mate === 0) return '#';
    return `${mate < 0 ? '−' : ''}M${Math.abs(mate)}`;
  }
  const pawns = score / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`;
}
