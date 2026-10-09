import { type Color, material } from '../chess/fen';
import type { Terminal } from '../chess/rules';

export { material };

/** Total half-moves before the round ends on material. */
export const PLY_LIMIT = 90;

export type Winner = Color | 'draw';
export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'insufficient'
  | 'fifty-move'
  | 'move-limit'
  | 'decisive'
  /** The player gave up a game they were playing themselves. */
  | 'resign';

export interface BattleResult {
  winner: Winner;
  reason: EndReason;
  material: Record<Color, number>;
  plies: number;
}

/** When a battle is cut short. The game uses DEFAULT_LIMITS; other values are for balance experiments. */
export interface BattleLimits {
  /** Half-moves before the round ends on material. */
  plyLimit: number;
  /** End early once one side leads by ≥ `lead` points for `plies` consecutive half-moves. Off when absent. */
  decisive?: { lead: number; plies: number };
}

export const DEFAULT_LIMITS: BattleLimits = { plyLimit: PLY_LIMIT };

/** Consecutive half-moves a side has held a material lead of at least the decisive threshold. */
export interface LeadStreak {
  side: Color | null;
  plies: number;
}

export const NO_STREAK: LeadStreak = { side: null, plies: 0 };

/** What battleResult needs to know about a position (implemented by chess/rules Game). */
export interface BattleState {
  fen(): string;
  turn(): Color;
  terminal(): Terminal | null;
}

/** The streak after one more half-move that left material at `mat`. */
export function nextLeadStreak(prev: LeadStreak, mat: Record<Color, number>, minLead: number): LeadStreak {
  const side: Color | null = mat.w - mat.b >= minLead ? 'w' : mat.b - mat.w >= minLead ? 'b' : null;
  if (!side) return NO_STREAK;
  return { side, plies: prev.side === side ? prev.plies + 1 : 1 };
}

/**
 * The battle's result if it is over after `plies` half-moves, otherwise null.
 * `streak` is only read when `limits.decisive` is set.
 */
export function battleResult(
  state: BattleState,
  plies: number,
  limits: BattleLimits = DEFAULT_LIMITS,
  streak: LeadStreak = NO_STREAK,
): BattleResult | null {
  const mat = material(state.fen());
  const end = (winner: Winner, reason: EndReason): BattleResult => ({ winner, reason, material: mat, plies });

  const onPoints: Winner = mat.w > mat.b ? 'w' : mat.b > mat.w ? 'b' : 'draw';

  const terminal = state.terminal();
  if (terminal === 'checkmate') return end(state.turn() === 'w' ? 'b' : 'w', 'checkmate');
  // Nobody can mate any more (e.g. king + knight vs king): decide on points, as at the move limit.
  if (terminal === 'insufficient') return end(onPoints, 'insufficient');
  if (terminal) return end('draw', terminal);
  if (limits.decisive && streak.side && streak.plies >= limits.decisive.plies) return end(streak.side, 'decisive');
  if (plies >= limits.plyLimit) return end(onPoints, 'move-limit');
  return null;
}

/** True when a result was decided on material rather than on the board. */
export function wonOnPoints(result: BattleResult): boolean {
  return result.winner !== 'draw' && (result.reason === 'move-limit' || result.reason === 'insufficient');
}
