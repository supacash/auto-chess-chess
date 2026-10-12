import type { BoardSpec } from '../chess/boardSpec';
import { type Color, parsePlacement } from '../chess/fen';
import { Game } from '../chess/rules';
import type { Piece, PieceType } from '../rules/pieces';

// Achievements: easy, fun goals that unlock once and stay unlocked (kept in the records, so they sync
// with the rest). Piece "families" count fusions too: an Archbishop is a bishop for Vatican, a
// Centaur a knight for Call the Cavalry, and so on.

export type AchievementId =
  | 'cavalry'
  | 'boulder'
  | 'wall'
  | 'solomon'
  | 'holyDiver'
  | 'silkRoad'
  | 'son'
  | 'secondSon'
  | 'pawns'
  | 'sausage'
  | 'vatican'
  | 'dragons'
  | 'stackman';

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  /** Not reachable yet (shown as a secret until it is). */
  secret?: boolean;
}

/** Pieces on the board for the "15 of a kind" achievements. */
export const CROWD = 15;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'cavalry', name: 'Call the Cavalry!', description: `Have ${CROWD} knights on the board.` },
  { id: 'boulder', name: 'It’s not a boulder…', description: 'Merge three rook-pawns into a Rook.' },
  { id: 'wall', name: 'The Wall', description: `Have ${CROWD} rooks on the board.` },
  { id: 'solomon', name: 'Solomon', description: `Have ${CROWD} queens on the board.` },
  {
    id: 'holyDiver',
    name: 'Holy Diver',
    description: 'A bishop takes a piece in one corner, all the way from the opposite corner.',
  },
  { id: 'silkRoad', name: 'Silk Road', description: `Have ${CROWD} camels on the board.` },
  { id: 'son', name: 'Finally a son', description: 'Create an Heir by merging three Queens.' },
  { id: 'secondSon', name: 'The infamous second son', description: 'Create a second Heir.', secret: true },
  { id: 'pawns', name: 'Oops, all pawns', description: `Have ${CROWD} pawns on the board.` },
  { id: 'sausage', name: 'Sausage Party', description: `Have ${CROWD} men on the board.` },
  { id: 'vatican', name: 'Vatican', description: `Have ${CROWD} bishops on the board.` },
  { id: 'dragons', name: 'Dragons now?', description: 'Field a Dragon King and a Dragon Horse in the same army.' },
  { id: 'stackman', name: 'I’m the Stackman', description: 'Create a Stackman by merging three Men.' },
];

/** The pieces that count for each family (fusions included). */
export const FAMILIES = {
  knight: ['N', 'A', 'C', 'Z', 'T', 'U'],
  rook: ['R', 'C', 'D'],
  queen: ['Q', 'Z'],
  bishop: ['B', 'A', 'H', 'S'],
  camel: ['L', 'U'],
  man: ['M', 'T', 'Y'],
  pawn: ['P', 'E'],
} satisfies Record<string, PieceType[]>;

const CROWDS: [AchievementId, PieceType[]][] = [
  ['cavalry', FAMILIES.knight],
  ['wall', FAMILIES.rook],
  ['solomon', FAMILIES.queen],
  ['silkRoad', FAMILIES.camel],
  ['pawns', FAMILIES.pawn],
  ['sausage', FAMILIES.man],
  ['vatican', FAMILIES.bishop],
];

export function achievement(id: AchievementId): Achievement {
  return ACHIEVEMENTS.find((a) => a.id === id)!;
}

export function isAchievementId(v: unknown): v is AchievementId {
  return ACHIEVEMENTS.some((a) => a.id === v);
}

/** Achievements earned by the army on the board (placed pieces only). */
export function armyAchievements(pieces: readonly Piece[]): AchievementId[] {
  const placed = pieces.filter((p) => p.square).map((p) => p.type);
  const out: AchievementId[] = CROWDS.filter(
    ([, family]) => placed.filter((t) => family.includes(t)).length >= CROWD,
  ).map(([id]) => id);
  if (placed.includes('D') && placed.includes('H')) out.push('dragons');
  return out;
}

/** Achievements earned by a three-piece merge into `result` (with `pieces` the army after it). */
export function mergeAchievements(result: PieceType, pieces: readonly Piece[]): AchievementId[] {
  if (result === 'R') return ['boulder']; // only three rook-pawns merge into a Rook
  if (result === 'Y') return ['stackman'];
  if (result === 'J') return pieces.filter((p) => p.type === 'J').length >= 2 ? ['son', 'secondSon'] : ['son'];
  return [];
}

/**
 * Achievements earned in a battle by `side` (the player's colour in the FEN): Holy Diver, a piece of
 * the bishop family taking something in a corner, coming from the opposite corner.
 */
export function battleAchievements(
  fen: string,
  moves: readonly string[],
  spec: BoardSpec,
  side: Color,
): AchievementId[] {
  const last = { file: spec.files - 1, rank: spec.ranks - 1 };
  const opposite = (file: number, rank: number) =>
    (file === 0 || file === last.file) && (rank === 0 || rank === last.rank)
      ? { file: last.file - file, rank: last.rank - rank }
      : null;
  const game = new Game(spec, fen);
  try {
    for (const uci of moves) {
      const grid = parsePlacement(game.fen(), spec.files).reverse(); // [rank][file], rank 0 at the bottom
      const mover = game.turn();
      const move = game.play(uci);
      if (!move) break;
      if (mover !== side) continue;
      const from = { file: move.from.charCodeAt(0) - 97, rank: Number(move.from.slice(1)) - 1 };
      const to = { file: move.to.charCodeAt(0) - 97, rank: Number(move.to.slice(1)) - 1 };
      const target = opposite(from.file, from.rank);
      const piece = grid[from.rank]?.[from.file];
      const captured = grid[to.rank]?.[to.file];
      if (
        target &&
        target.file === to.file &&
        target.rank === to.rank &&
        piece &&
        (FAMILIES.bishop as PieceType[]).includes(piece.type) &&
        captured &&
        captured.color !== side
      ) {
        return ['holyDiver'];
      }
    }
  } finally {
    game.delete();
  }
  return [];
}
