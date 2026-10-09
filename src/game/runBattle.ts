import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import { Game, type Move } from '../chess/rules';
import type { Candidate } from '../engine/pick';
import { pickMove, whiteEval } from '../engine/pick';
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
  /** Starts a fresh game on the given Fairy-Stockfish variant. */
  newGame(variant: string): Promise<void>;
  candidates(fen: string, depth: number): Promise<Candidate[]>;
}

/**
 * Plays a battle from `fen` to completion on `spec`. `onMove` runs after each move (e.g. to animate);
 * the engine searches the next move while it runs. `limits` defaults to the game's rules.
 * `evalScore` is the engine's score for white from the search that chose the move (null if the engine gave none).
 * `game` is only valid during the callback. Needs the chess rules loaded (setRules).
 */
export async function runBattle(
  fen: string,
  engine: MoveSource,
  rng: Rng,
  onMove: (move: Move, game: Game, plies: number, evalScore: number | null) => Promise<void>,
  limits: BattleLimits = DEFAULT_LIMITS,
  spec: BoardSpec = BOARD_8,
): Promise<BattleResult> {
  const game = new Game(spec, fen);
  try {
    await engine.newGame(spec.variant);

    let plies = 0;
    let streak = NO_STREAK;
    let result = battleResult(game, plies, limits);
    let search = result ? null : engine.candidates(game.fen(), SEARCH_DEPTH);

    while (!result && search) {
      const candidates = await search;
      const evalScore = whiteEval(candidates, game.turn());
      const move = playMove(game, candidates, rng);
      plies++;
      if (limits.decisive) streak = nextLeadStreak(streak, material(game.fen()), limits.decisive.lead);
      result = battleResult(game, plies, limits, streak);
      search = result ? null : engine.candidates(game.fen(), SEARCH_DEPTH);
      await onMove(move, game, plies, evalScore);
    }
    return result!;
  } finally {
    game.delete();
  }
}

/** Plays the picked engine move, falling back to a random legal move if the engine gives none or an illegal one. */
function playMove(game: Game, candidates: Candidate[], rng: Rng): Move {
  const uci = pickMove(candidates, rng);
  const played = uci ? game.play(uci) : null;
  if (played) return played;
  const legal = game.legalMoves();
  return game.play(legal[randomInt(rng, legal.length)])!;
}
