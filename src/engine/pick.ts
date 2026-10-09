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
