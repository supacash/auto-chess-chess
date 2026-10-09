import type { Chess, Color } from 'chess.js';
import { PIECE_VALUE, type PieceType } from './pieces';

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
  | 'decisive';

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

export function material(chess: Chess): Record<Color, number> {
  const out: Record<Color, number> = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) out[cell.color] += PIECE_VALUE[cell.type.toUpperCase() as PieceType];
    }
  }
  return out;
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
  chess: Chess,
  plies: number,
  limits: BattleLimits = DEFAULT_LIMITS,
  streak: LeadStreak = NO_STREAK,
): BattleResult | null {
  const mat = material(chess);
  const end = (winner: Winner, reason: EndReason): BattleResult => ({ winner, reason, material: mat, plies });

  if (chess.isCheckmate()) return end(chess.turn() === 'w' ? 'b' : 'w', 'checkmate');
  if (chess.isStalemate()) return end('draw', 'stalemate');
  if (chess.isInsufficientMaterial()) return end('draw', 'insufficient');
  if (chess.isThreefoldRepetition()) return end('draw', 'repetition');
  if (chess.isDrawByFiftyMoves()) return end('draw', 'fifty-move');
  if (limits.decisive && streak.side && streak.plies >= limits.decisive.plies) return end(streak.side, 'decisive');
  if (plies >= limits.plyLimit) {
    return end(mat.w > mat.b ? 'w' : mat.b > mat.w ? 'b' : 'draw', 'move-limit');
  }
  return null;
}
