import type { Chess, Color } from 'chess.js';
import { PIECE_VALUE, type PieceType } from './pieces';

/** Total half-moves before the round ends on material. */
export const PLY_LIMIT = 60;

export type Winner = Color | 'draw';
export type EndReason = 'checkmate' | 'stalemate' | 'repetition' | 'insufficient' | 'fifty-move' | 'move-limit';

export interface BattleResult {
  winner: Winner;
  reason: EndReason;
  material: Record<Color, number>;
  plies: number;
}

export function material(chess: Chess): Record<Color, number> {
  const out: Record<Color, number> = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) out[cell.color] += PIECE_VALUE[cell.type.toUpperCase() as PieceType];
    }
  }
  return out;
}

/** The battle's result if it is over after `plies` half-moves, otherwise null. */
export function battleResult(chess: Chess, plies: number): BattleResult | null {
  const mat = material(chess);
  const end = (winner: Winner, reason: EndReason): BattleResult => ({ winner, reason, material: mat, plies });

  if (chess.isCheckmate()) return end(chess.turn() === 'w' ? 'b' : 'w', 'checkmate');
  if (chess.isStalemate()) return end('draw', 'stalemate');
  if (chess.isInsufficientMaterial()) return end('draw', 'insufficient');
  if (chess.isThreefoldRepetition()) return end('draw', 'repetition');
  if (chess.isDrawByFiftyMoves()) return end('draw', 'fifty-move');
  if (plies >= PLY_LIMIT) {
    return end(mat.w > mat.b ? 'w' : mat.b > mat.w ? 'b' : 'draw', 'move-limit');
  }
  return null;
}
