import type { BoardSpec } from '../chess/boardSpec';
import { type Color, material, parsePlacement, royalCaptured } from '../chess/fen';
import { Game } from '../chess/rules';
import type { BattleResult } from '../rules/battle';
import { FUSIONS } from '../rules/economy';
import { type Piece, PIECE_VALUE, type PieceType } from '../rules/pieces';
import { armyCap } from '../rules/placement';

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
  | 'stackman'
  // Battles
  | 'davidGoliath'
  | 'comeback'
  | 'pawnStorm'
  | 'longLive'
  | 'royalWedding'
  | 'photoFinish'
  // Runs
  | 'undefeated'
  | 'prestigious'
  | 'diy'
  | 'hoarder'
  | 'shopaholic'
  // Multiplayer
  | 'lastStanding'
  | 'untouchable'
  | 'poolShark'
  | 'kingmaker'
  | 'specter'
  // Collections
  | 'zooKeeper'
  | 'fusionChef'
  | 'barnyard'
  | 'absoluteUnit'
  | 'allHands';

export type AchievementGroup = 'pieces' | 'battles' | 'runs' | 'multiplayer' | 'collections';

/** Headings for the groups, in the order the Profile lists them. */
export const ACHIEVEMENT_GROUPS: { id: AchievementGroup; name: string }[] = [
  { id: 'pieces', name: 'Armies and merges' },
  { id: 'battles', name: 'Battles' },
  { id: 'runs', name: 'Runs' },
  { id: 'multiplayer', name: 'Multiplayer' },
  { id: 'collections', name: 'Collections' },
];

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  /** Not reachable yet (shown as a secret until it is). */
  secret?: boolean;
}

/** Pieces on the board for the "15 of a kind" achievements. */
export const CROWD = 15;
export const COMEBACK_POINTS = 10;
export const HOARD_GOLD = 50;
export const SHOPAHOLIC_REROLLS = 10;
export const PRESTIGIOUS_LEVEL = 3;
export const SPECTER_WATCHES = 5;
export const ABSOLUTE_UNIT_POINTS = 120;

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
  // Battles
  { id: 'davidGoliath', name: 'David and Goliath', description: 'Beat an army worth twice your points.' },
  {
    id: 'comeback',
    name: 'Comeback Kid',
    description: `Win a battle after being ${COMEBACK_POINTS} or more points behind.`,
  },
  { id: 'pawnStorm', name: 'Pawn Storm', description: 'Checkmate with a pawn.' },
  {
    id: 'longLive',
    name: 'Long Live the King',
    description: 'Win a battle after losing your King: the Heir finishes it.',
  },
  { id: 'royalWedding', name: 'Royal Wedding', description: 'Promote a pawn on the last rank.' },
  { id: 'photoFinish', name: 'Photo Finish', description: 'Win on points at the move limit by a single point.' },
  // Runs
  { id: 'undefeated', name: 'The Undefeated', description: 'Win a run without losing a battle.' },
  { id: 'prestigious', name: 'Prestigious', description: `Reach prestige ★${PRESTIGIOUS_LEVEL}.` },
  { id: 'diy', name: 'Do It Yourself', description: 'Win a battle you played yourself (Play it).' },
  { id: 'hoarder', name: 'Hoarder', description: `Have ${HOARD_GOLD} gold at once.` },
  { id: 'shopaholic', name: 'Shopaholic', description: `Reroll the shop ${SHOPAHOLIC_REROLLS} times in one round.` },
  // Multiplayer
  { id: 'lastStanding', name: 'Last One Standing', description: 'Win a multiplayer match.' },
  { id: 'untouchable', name: 'Untouchable', description: 'Win a match without losing a battle.' },
  { id: 'poolShark', name: 'Pool Shark', description: 'Buy the last one left in the shared pool.' },
  { id: 'kingmaker', name: 'Kingmaker', description: 'Finish a match 2nd, with the winner down to 1 HP.' },
  {
    id: 'specter',
    name: 'Specter',
    description: `Watch ${SPECTER_WATCHES} battles after being knocked out of a match.`,
  },
  // Collections
  { id: 'zooKeeper', name: 'Zoo Keeper', description: 'Over time, field every fairy piece the shop sells.' },
  { id: 'fusionChef', name: 'Fusion Chef', description: 'Over time, make every fusion.' },
  { id: 'barnyard', name: 'Barnyard', description: 'Field a Camel, a Wildebeest and a Centaur in the same army.' },
  {
    id: 'absoluteUnit',
    name: 'Absolute Unit',
    description: `Have an army worth ${ABSOLUTE_UNIT_POINTS} points or more on the board.`,
  },
  {
    id: 'allHands',
    name: 'All Hands on Deck',
    description: 'Fill every square of your home rows (the small boards allow it).',
  },
];

const GROUP_OF: Partial<Record<AchievementId, AchievementGroup>> = {
  holyDiver: 'battles',
  davidGoliath: 'battles',
  comeback: 'battles',
  pawnStorm: 'battles',
  longLive: 'battles',
  royalWedding: 'battles',
  photoFinish: 'battles',
  undefeated: 'runs',
  prestigious: 'runs',
  diy: 'runs',
  hoarder: 'runs',
  shopaholic: 'runs',
  lastStanding: 'multiplayer',
  untouchable: 'multiplayer',
  poolShark: 'multiplayer',
  kingmaker: 'multiplayer',
  specter: 'multiplayer',
  zooKeeper: 'collections',
  fusionChef: 'collections',
};

/** The group an achievement is listed under (armies and merges unless stated). */
export function achievementGroup(id: AchievementId): AchievementGroup {
  return GROUP_OF[id] ?? 'pieces';
}

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

/** Fairy pieces the shop sells (for Zoo Keeper; the Grasshopper isn't sold any more). */
export const SHOP_FAIRY: PieceType[] = ['E', 'F', 'W', 'M', 'L', 'X', 'Y'];
/** Every fusion's result (for Fusion Chef). */
export const FUSION_RESULTS: PieceType[] = FUSIONS.map((f) => f.result);

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

/** Achievements earned by the army on the board (placed pieces only) on `spec`. */
export function armyAchievements(pieces: readonly Piece[], spec?: BoardSpec): AchievementId[] {
  const placed = pieces.filter((p) => p.square).map((p) => p.type);
  const out: AchievementId[] = CROWDS.filter(
    ([, family]) => placed.filter((t) => family.includes(t)).length >= CROWD,
  ).map(([id]) => id);
  const has = (t: PieceType) => placed.includes(t);
  if (has('D') && has('H')) out.push('dragons');
  if (has('L') && has('U') && has('T')) out.push('barnyard');
  if (placed.reduce((sum, t) => sum + PIECE_VALUE[t], 0) >= ABSOLUTE_UNIT_POINTS) out.push('absoluteUnit');
  if (spec && placed.length >= spec.files * spec.homeRows && armyCap(spec) >= spec.files * spec.homeRows) {
    out.push('allHands');
  }
  return out;
}

/** Achievements earned by the shop as it stands: Hoarder. */
export function shopAchievements(gold: number, rerollsThisRound: number): AchievementId[] {
  const out: AchievementId[] = [];
  if (gold >= HOARD_GOLD) out.push('hoarder');
  if (rerollsThisRound >= SHOPAHOLIC_REROLLS) out.push('shopaholic');
  return out;
}

/** Achievements earned by a three-piece merge into `result` (with `pieces` the army after it). */
export function mergeAchievements(result: PieceType, pieces: readonly Piece[]): AchievementId[] {
  if (result === 'R') return ['boulder']; // only three rook-pawns merge into a Rook
  if (result === 'Y') return ['stackman'];
  if (result === 'J') return pieces.filter((p) => p.type === 'J').length >= 2 ? ['son', 'secondSon'] : ['son'];
  return [];
}

/** Career collections (Zoo Keeper, Fusion Chef): unlocked once every piece in them has been seen. */
export interface Collections {
  /** Fairy pieces the player has fielded. */
  fielded: PieceType[];
  /** Fusions the player has made. */
  fused: PieceType[];
}

export function collectionAchievements(c: Collections): AchievementId[] {
  const out: AchievementId[] = [];
  if (SHOP_FAIRY.every((t) => c.fielded.includes(t))) out.push('zooKeeper');
  if (FUSION_RESULTS.every((t) => c.fused.includes(t))) out.push('fusionChef');
  return out;
}

export interface BattleFacts {
  fen: string;
  moves: readonly string[];
  spec: BoardSpec;
  /** The player's colour in the FEN. */
  side: Color;
  result: BattleResult;
  /** The most points the player was behind during the battle. */
  worstDeficit: number;
}

/** Achievements earned in a battle by the player (`side`). */
export function battleAchievements({ fen, moves, spec, side, result, worstDeficit }: BattleFacts): AchievementId[] {
  const out = new Set<AchievementId>();
  const won = result.winner === side;
  const other: Color = side === 'w' ? 'b' : 'w';
  const start = material(fen);
  if (won && start[side] > 0 && start[other] >= 2 * start[side]) out.add('davidGoliath');
  if (won && worstDeficit >= COMEBACK_POINTS) out.add('comeback');
  if (won && result.reason === 'move-limit' && result.material[side] - result.material[other] === 1) {
    out.add('photoFinish');
  }

  const last = { file: spec.files - 1, rank: spec.ranks - 1 };
  const opposite = (file: number, rank: number) =>
    (file === 0 || file === last.file) && (rank === 0 || rank === last.rank)
      ? { file: last.file - file, rank: last.rank - rank }
      : null;
  const square = (name: string) => ({ file: name.charCodeAt(0) - 97, rank: Number(name.slice(1)) - 1 });
  const game = new Game(spec, fen);
  let lostKing = false;
  let lastMover: PieceType | null = null;
  try {
    for (const uci of moves) {
      const before = game.fen();
      const grid = parsePlacement(before, spec.files).reverse(); // [rank][file], rank 0 at the bottom
      const mover = game.turn();
      const move = game.play(uci);
      if (!move) break;
      const capture = royalCaptured(before, game.fen());
      if (capture?.side === side && capture.lost === 'King') lostKing = true;
      if (mover !== side) continue;
      const from = square(move.from);
      const to = square(move.to);
      const piece = grid[from.rank]?.[from.file];
      const captured = grid[to.rank]?.[to.file];
      lastMover = piece?.type ?? null;
      if (
        piece &&
        (FAMILIES.pawn as PieceType[]).includes(piece.type) &&
        uci.length > move.from.length + move.to.length
      ) {
        out.add('royalWedding');
      }
      const target = opposite(from.file, from.rank);
      if (
        target &&
        target.file === to.file &&
        target.rank === to.rank &&
        piece &&
        (FAMILIES.bishop as PieceType[]).includes(piece.type) &&
        captured &&
        captured.color !== side
      ) {
        out.add('holyDiver');
      }
    }
  } finally {
    game.delete();
  }
  if (won && lostKing) out.add('longLive');
  // The mating move was the player's last one, made by a pawn.
  if (won && result.reason === 'checkmate' && lastMover && (FAMILIES.pawn as PieceType[]).includes(lastMover)) {
    out.add('pawnStorm');
  }
  return [...out];
}

/** Achievements for a finished match: `place` (1 = won), battles lost, and the winner's health. */
export function matchAchievements(place: number, losses: number, winnerHp: number): AchievementId[] {
  const out: AchievementId[] = [];
  if (place === 1) out.push('lastStanding');
  if (place === 1 && losses === 0) out.push('untouchable');
  if (place === 2 && winnerHp === 1) out.push('kingmaker');
  return out;
}
