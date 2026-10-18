import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import { type Color, type FenPiece, placementField } from '../chess/fen';
import { kingInCheck } from '../chess/rules';
import type { Piece, Square } from './pieces';
import { applyUpgrades, type SynergyUpgrade, synergyUpgrades } from './synergy';

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

/** A piece a synergy upgrades for the battle, on the battle board (black's squares mirrored). */
export interface BattleUpgrade extends Omit<SynergyUpgrade, 'square'> {
  side: Color;
  square: Square;
}

/** What synergies did to a start position: the pieces they upgraded (the FEN has them upgraded), and the placement before. */
export interface StartSynergies {
  upgrades: BattleUpgrade[];
  /** The FEN's placement field as the armies were placed, before the upgrades. */
  before: string;
}

export type StartPosition =
  | { ok: true; fen: string; firstMover: Color; synergies?: StartSynergies }
  | { ok: false; reason: 'both-in-check' };

/**
 * Builds the battle's starting FEN (no castling, no en passant). The player's pieces are always
 * white in the FEN; `playerFirst` says who moves first (the colour shown on screen is only a
 * display choice). A king that starts in check moves first regardless. Both kings in check is unplayable.
 * With `synergies` (synergy.ts), both armies fight with their synergy upgrades.
 * Needs the chess rules loaded (setRules).
 */
export function startPosition(
  player: Piece[],
  ai: Piece[],
  playerFirst: boolean,
  spec: BoardSpec = BOARD_8,
  synergies = false,
): StartPosition {
  const mine = synergies ? synergyUpgrades(player, spec) : [];
  const theirs = synergies ? synergyUpgrades(ai, spec) : [];
  const placement = placementFen(applyUpgrades(player, mine), applyUpgrades(ai, theirs), spec);
  const whiteInCheck = kingInCheck(spec, placement, 'w');
  const blackInCheck = kingInCheck(spec, placement, 'b');

  if (whiteInCheck && blackInCheck) return { ok: false, reason: 'both-in-check' };
  const firstMover: Color = whiteInCheck ? 'w' : blackInCheck ? 'b' : playerFirst ? 'w' : 'b';
  const fen = `${placement} ${firstMover} - - 0 1`;
  if (!synergies) return { ok: true, fen, firstMover };
  const upgrades: BattleUpgrade[] = [
    ...mine.map((u) => ({ ...u, side: 'w' as const })),
    ...theirs.map((u) => ({ ...u, side: 'b' as const, square: mirror(u.square, spec) })),
  ];
  return { ok: true, fen, firstMover, synergies: { upgrades, before: placementFen(player, ai, spec) } };
}
