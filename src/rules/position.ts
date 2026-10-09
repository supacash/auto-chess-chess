import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import { type Color, type FenPiece, placementField } from '../chess/fen';
import { kingInCheck } from '../chess/rules';
import type { Piece, Square } from './pieces';

/** Maps an AI-local square (its home rows start at rank 0) onto the board (counted from the top). */
export function mirror(sq: Square, spec: BoardSpec = BOARD_8): Square {
  return { file: sq.file, rank: spec.ranks - 1 - sq.rank };
}

/** FEN piece-placement field: player pieces as white, AI pieces (mirrored) as black. Benched pieces are skipped. */
export function placementFen(player: Piece[], ai: Piece[], spec: BoardSpec = BOARD_8): string {
  const grid: (FenPiece | null)[][] = Array.from({ length: spec.ranks }, () =>
    Array<FenPiece | null>(spec.files).fill(null),
  );
  for (const p of player) if (p.square) grid[p.square.rank][p.square.file] = { type: p.type, color: 'w' };
  for (const p of ai) {
    if (!p.square) continue;
    const sq = mirror(p.square, spec);
    grid[sq.rank][sq.file] = { type: p.type, color: 'b' };
  }
  return placementField(grid);
}

export type StartPosition = { ok: true; fen: string; firstMover: Color } | { ok: false; reason: 'both-in-check' };

/**
 * Builds the battle's starting FEN (no castling, no en passant). The player's pieces are always
 * white in the FEN; `playerFirst` says who moves first (the colour shown on screen is only a
 * display choice). A king that starts in check moves first regardless. Both kings in check is unplayable.
 * Needs the chess rules loaded (setRules).
 */
export function startPosition(
  player: Piece[],
  ai: Piece[],
  playerFirst: boolean,
  spec: BoardSpec = BOARD_8,
): StartPosition {
  const placement = placementFen(player, ai, spec);
  const whiteInCheck = kingInCheck(spec, placement, 'w');
  const blackInCheck = kingInCheck(spec, placement, 'b');

  if (whiteInCheck && blackInCheck) return { ok: false, reason: 'both-in-check' };
  const firstMover: Color = whiteInCheck ? 'w' : blackInCheck ? 'b' : playerFirst ? 'w' : 'b';
  return { ok: true, fen: `${placement} ${firstMover} - - 0 1`, firstMover };
}
