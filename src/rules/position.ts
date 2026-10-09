import { Chess, type Color, type Square as ChessSquare } from 'chess.js';
import type { Piece, Square } from './pieces';
import { type Rng } from './rng';

export function toChessSquare(sq: Square): ChessSquare {
  return ('abcdefgh'[sq.file] + (sq.rank + 1)) as ChessSquare;
}

/** Maps an AI-local square (its home rows are ranks 0-2) onto the board (ranks 7-5). */
export function mirror(sq: Square): Square {
  return { file: sq.file, rank: 7 - sq.rank };
}

/** FEN piece-placement field: player pieces as white, AI pieces (mirrored) as black. Benched pieces are skipped. */
export function placementFen(player: Piece[], ai: Piece[]): string {
  const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array<string | null>(8).fill(null));
  for (const p of player) if (p.square) grid[p.square.rank][p.square.file] = p.type;
  for (const p of ai) {
    if (!p.square) continue;
    const sq = mirror(p.square);
    grid[sq.rank][sq.file] = p.type.toLowerCase();
  }

  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (const cell of grid[rank]) {
      if (!cell) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      row += cell;
      empty = 0;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

export type StartPosition = { ok: true; fen: string; firstMover: Color } | { ok: false; reason: 'both-in-check' };

/**
 * Builds the battle's starting FEN (no castling, no en passant) and picks who moves first:
 * random, unless a king starts in check — then that side moves. Both kings in check is unplayable.
 */
export function startPosition(player: Piece[], ai: Piece[], rng: Rng): StartPosition {
  const placement = placementFen(player, ai);
  const probe = new Chess(`${placement} w - - 0 1`, { skipValidation: true });
  const whiteInCheck = kingAttacked(probe, 'w');
  const blackInCheck = kingAttacked(probe, 'b');

  if (whiteInCheck && blackInCheck) return { ok: false, reason: 'both-in-check' };
  const firstMover: Color = whiteInCheck ? 'w' : blackInCheck ? 'b' : rng() < 0.5 ? 'w' : 'b';
  return { ok: true, fen: `${placement} ${firstMover} - - 0 1`, firstMover };
}

function kingAttacked(chess: Chess, color: Color): boolean {
  const [king] = chess.findPiece({ type: 'k', color });
  return king !== undefined && chess.isAttacked(king, color === 'w' ? 'b' : 'w');
}
