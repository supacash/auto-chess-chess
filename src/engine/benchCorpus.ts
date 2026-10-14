import { BOARDS, type BoardSpec, boardForRound, ROUNDS_PER_BOARD } from '../chess/boardSpec';
import { Game } from '../chess/rules';
import { aiBudget, draftAiArmy, pickStyle, placeAiArmy, placeForBattle } from '../rules/aiArmy';
import type { PieceType } from '../rules/pieces';
import { randomInt, type Rng, seededRng } from '../rules/rng';

/**
 * Fixed positions for timing engines against each other (Fairy-Stockfish now, our own engine later;
 * docs/ENGINE-PLAN.md). Built only from the seed and the game's army code, never from an engine, so the
 * same corpus can be timed in Node (scripts/check/baseline.ts) and on a phone (bench.html).
 */
export interface BenchPosition {
  spec: BoardSpec;
  fen: string;
  /** The round the armies were drafted for. */
  round: number;
  /** Random plies played from the start position. */
  plies: number;
}

/** A round played on `spec`: its two rounds, or rounds 9–25 on the last (9×9) board. */
function roundOn(spec: BoardSpec, rng: Rng): number {
  const index = BOARDS.indexOf(spec);
  if (index === BOARDS.length - 1) return index * ROUNDS_PER_BOARD + 1 + randomInt(rng, 17);
  return index * ROUNDS_PER_BOARD + 1 + randomInt(rng, ROUNDS_PER_BOARD);
}

/**
 * A battle start as the game drafts it for `round`: fairy armies at the AI's budget for that round.
 * `mirrored` gives both sides the same piece types (placed separately), so results show only the
 * engine's and the colours' bias. Needs the chess rules loaded.
 */
export function benchBattle(rng: Rng, round: number, mirrored: boolean, playerFirst: boolean): string {
  const spec = boardForRound(round);
  const style = pickStyle(rng, true);
  const budget = aiBudget(round, rng);
  const whiteTypes: PieceType[] = draftAiArmy(budget, style, rng, spec, true, round);
  const blackStyle = mirrored ? style : pickStyle(rng, true);
  const blackTypes = mirrored ? whiteTypes : draftAiArmy(budget, blackStyle, rng, spec, true, round);
  const white = placeAiArmy(whiteTypes, style, rng, spec);
  return placeForBattle(white, blackTypes, blackStyle, rng, spec, playerFirst).start.fen;
}

/** `perBoard` positions per board for each entry of `plies`. Needs the chess rules loaded. */
export function benchCorpus(seed = 1, perBoard = 10, plies: readonly number[] = [0, 16]): BenchPosition[] {
  const rng = seededRng(seed);
  const corpus: BenchPosition[] = [];
  for (const spec of BOARDS) {
    for (let i = 0; i < perBoard; i++) {
      const round = roundOn(spec, rng);
      const start = benchBattle(rng, round, false, rng() < 0.5);
      for (const n of plies) corpus.push({ spec, round, plies: n, fen: randomPlies(spec, start, n, rng) });
    }
  }
  return corpus;
}

/** Plays up to `n` random legal moves from `fen` (stopping early if the game ends). */
function randomPlies(spec: BoardSpec, fen: string, n: number, rng: Rng): string {
  const game = new Game(spec, fen);
  try {
    for (let i = 0; i < n; i++) {
      const legal = game.legalMoves();
      if (legal.length === 0) break;
      game.play(legal[randomInt(rng, legal.length)]);
    }
    return game.fen();
  } finally {
    game.delete();
  }
}

/** p-th percentile (0–100) of `values`, nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
