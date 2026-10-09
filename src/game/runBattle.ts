import { Chess, type Move } from 'chess.js';
import type { Candidate } from '../engine/pick';
import { pickMove } from '../engine/pick';
import {
  type BattleLimits,
  type BattleResult,
  battleResult,
  DEFAULT_LIMITS,
  material,
  NO_STREAK,
  nextLeadStreak,
} from '../rules/battle';
import { type Rng, randomInt } from '../rules/rng';

/** Search depth per move. Shallow keeps rounds fast and games a little human. */
export const SEARCH_DEPTH = 8;

/** The part of Engine the battle loop needs (lets tests use a fake). */
export interface MoveSource {
  newGame(): Promise<void>;
  candidates(fen: string, depth: number): Promise<Candidate[]>;
}

/**
 * Plays a battle from `fen` to completion. `onMove` runs after each move (e.g. to animate);
 * the engine searches the next move while it runs. `limits` defaults to the game's rules.
 */
export async function runBattle(
  fen: string,
  engine: MoveSource,
  rng: Rng,
  onMove: (move: Move, chess: Chess, plies: number) => Promise<void>,
  limits: BattleLimits = DEFAULT_LIMITS,
): Promise<BattleResult> {
  const chess = new Chess(fen, { skipValidation: true });
  await engine.newGame();

  let plies = 0;
  let streak = NO_STREAK;
  let result = battleResult(chess, plies, limits);
  let search = result ? null : engine.candidates(chess.fen(), SEARCH_DEPTH);

  while (!result && search) {
    const move = playMove(chess, await search, rng);
    plies++;
    if (limits.decisive) streak = nextLeadStreak(streak, material(chess), limits.decisive.lead);
    result = battleResult(chess, plies, limits, streak);
    search = result ? null : engine.candidates(chess.fen(), SEARCH_DEPTH);
    await onMove(move, chess, plies);
  }
  return result!;
}

/** Plays the picked engine move, falling back to a random legal move if the engine gives none or an illegal one. */
function playMove(chess: Chess, candidates: Candidate[], rng: Rng): Move {
  const uci = pickMove(candidates, rng);
  if (uci) {
    try {
      return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      // fall through
    }
  }
  const legal = chess.moves({ verbose: true });
  return chess.move(legal[randomInt(rng, legal.length)]);
}
