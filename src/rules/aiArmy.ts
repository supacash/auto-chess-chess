import { BOARD_8, type BoardSpec, homeSquares, pawnSquares } from '../chess/boardSpec';
import { UPGRADES, upgradeCost } from './economy';
import { isPawnLike, makePiece, MAX_ARMY, type Piece, type PieceType, type Square, PIECE_VALUE } from './pieces';
import { BACK_RANK, canPlace, frontRank, pieceAt } from './placement';
import { type Rng, randomInt, weightedPick } from './rng';

// All squares here are AI-local: rank 0 is the AI's back row, rank homeRows − 1 its front row.
// Style preferences are written for 8 files and 3 home rows and scaled to smaller boards.

/** At most this many pawns, whatever the board (a standard chess side's worth). */
export const MAX_PAWNS = 8;

/** How an AI opponent drafts and lays out its army. */
export interface AiStyle {
  id: string;
  name: string;
  /** Share of the budget reserved for pawns. */
  pawnShare: number;
  /** Relative draft weights for the non-pawn pieces. */
  weights: Partial<Record<PieceType, number>>;
  /** Preferred king files (before random left/right flip) on rank `kingRank`. */
  kingFiles: number[];
  kingRank: number;
  /** Bonus per rank forward for non-pawn pieces (negative = hang back). */
  forward: number;
  /** Bonus for pawns on the front row. */
  pawnFront: number;
  /** Bonus for pawns directly in front of (or diagonal to) the king. */
  shield: number;
}

export const AI_STYLES: AiStyle[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    pawnShare: 0.35,
    weights: { N: 2, B: 2, R: 1.5, Q: 1 },
    kingFiles: [4, 3],
    kingRank: 0,
    forward: 0.2,
    pawnFront: 0,
    shield: 1,
  },
  {
    id: 'fortress',
    name: 'Fortress',
    pawnShare: 0.6,
    weights: { N: 1, B: 1.5, R: 1.5, Q: 0.5 },
    kingFiles: [6, 7],
    kingRank: 0,
    forward: -0.3,
    pawnFront: 0,
    shield: 2.5,
  },
  {
    id: 'heavy',
    name: 'Heavy Artillery',
    pawnShare: 0.15,
    weights: { N: 0.5, B: 0.5, R: 2.5, Q: 3 },
    kingFiles: [4, 3],
    kingRank: 0,
    forward: 0,
    pawnFront: 0,
    shield: 1,
  },
  {
    id: 'cavalry',
    name: 'Cavalry Charge',
    pawnShare: 0.25,
    weights: { N: 3, B: 2.5, R: 0.5, Q: 0.5 },
    kingFiles: [4, 3, 5],
    kingRank: 0,
    forward: 0.8,
    pawnFront: 1,
    shield: 0.5,
  },
];

/** Random jitter added to square scores so identical armies don't always line up the same. */
const PLACEMENT_NOISE = 0.6;
const CENTER = [0, 0.3, 0.7, 1, 1, 0.7, 0.3, 0];
/** Penalty for stacking a pawn on a file that already has one. */
const DOUBLED_PAWN = 2;

/**
 * AI army point budget for a round: perRound × round, ±1 random. Normal difficulty is 6 per round,
 * which tracks the player's income (see SIMULATION.md); see difficulty.ts for the others.
 */
/** Round 1 AI armies are this much smaller, so the first battle is less of a coin flip. */
export const ROUND_ONE_DISCOUNT = 1;

export function aiBudget(
  round: number,
  rng: Rng,
  perRound = 6,
  roundOneDiscount = ROUND_ONE_DISCOUNT,
  bonus = 0,
): number {
  return perRound * round + bonus + randomInt(rng, 3) - 1 - (round === 1 ? roundOneDiscount : 0);
}

export function pickStyle(rng: Rng): AiStyle {
  return AI_STYLES[randomInt(rng, AI_STYLES.length)];
}

/**
 * Picks piece types (always including the king) whose values sum to at most `budget` and that
 * fit `spec`'s home rows: non-pawn pieces by the style's weights, the rest as pawns, and any budget
 * left once the board or the pawn cap is full goes into upgrades.
 */
export function draftAiArmy(budget: number, style: AiStyle, rng: Rng, spec: BoardSpec = BOARD_8): PieceType[] {
  const types: PieceType[] = ['K'];
  const capacity = Math.min(MAX_ARMY, homeSquares(spec));
  const pawnCap = Math.min(MAX_PAWNS, pawnSquares(spec));
  let pieceBudget = budget - Math.round(budget * style.pawnShare);
  const options = (['Q', 'R', 'B', 'N'] as const).filter((t) => (style.weights[t] ?? 0) > 0);
  while (types.length < capacity) {
    const affordable = options.filter((t) => PIECE_VALUE[t] <= pieceBudget);
    if (affordable.length === 0) break;
    const pick = weightedPick(affordable, (t) => style.weights[t]!, rng);
    types.push(pick);
    pieceBudget -= PIECE_VALUE[pick];
  }

  let left = budget - points(types);
  const pawns = Math.max(0, Math.min(left, pawnCap, capacity - types.length));
  for (let i = 0; i < pawns; i++) types.push('P');
  left -= pawns;
  // Upgrades cost 2 or 4, so an odd leftover can't be spent; trade a pawn back to make it even.
  if (left % 2 === 1 && pawns > 0) {
    types.pop();
    left++;
  }

  // Spend leftovers on upgrades, cheapest pieces first.
  for (;;) {
    const order = types.map((t, i) => [t, i] as const).sort(([a], [b]) => PIECE_VALUE[a] - PIECE_VALUE[b]);
    const found = order
      .map(([from, i]) => ({
        i,
        to: UPGRADES[from].filter((to) => upgradeCost(from, to) <= left),
      }))
      .find((o) => o.to.length > 0);
    if (!found) break;
    const to = weightedPick(found.to, (t) => style.weights[t] ?? 0.1, rng);
    left -= upgradeCost(types[found.i], to);
    types[found.i] = to;
  }
  return types;
}

/**
 * Lays the army out in its home rows by scoring every square per piece for the style.
 * The king goes first onto a preferred file (randomly flipped left/right), then pieces
 * from most to least valuable take their best free square. Pieces with no legal square are dropped.
 */
export function placeAiArmy(types: PieceType[], style: AiStyle, rng: Rng, spec: BoardSpec = BOARD_8): Piece[] {
  const flip = rng() < 0.5;
  const placed: Piece[] = [];
  const free = (sq: Square, type: PieceType) => canPlace(type, sq, spec) && !pieceAt(placed, sq);

  if (types.includes('K')) {
    const preferred = style.kingFiles
      .map((f) => fromFile8(flip ? 7 - f : f, spec))
      .map((file) => ({ file, rank: style.kingRank }))
      .find((sq) => free(sq, 'K'));
    const king = preferred ?? allSquares(spec).find((sq) => free(sq, 'K'))!;
    placed.push(makePiece('K', king));
  }
  const kingSq = placed[0]?.square ?? null;

  const rest = types.filter((t) => t !== 'K').sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
  // Pawns go last and can't use the back row, so other pieces leave enough other squares for them.
  let pawnsLeft = rest.filter(isPawnLike).length;
  const pawnRoom = () => allSquares(spec).filter((sq) => sq.rank !== BACK_RANK && !pieceAt(placed, sq)).length;
  for (const type of rest) {
    if (isPawnLike(type)) pawnsLeft--;
    const crowded = !isPawnLike(type) && pawnRoom() <= pawnsLeft;
    let best: Square | null = null;
    let bestScore = -Infinity;
    for (const sq of allSquares(spec)) {
      if (!free(sq, type)) continue;
      if (crowded && sq.rank !== BACK_RANK) continue;
      const score = squareScore(type, sq, style, kingSq, placed, spec) + rng() * PLACEMENT_NOISE;
      if (score > bestScore) {
        best = sq;
        bestScore = score;
      }
    }
    if (best) placed.push(makePiece(type, best));
  }
  return placed;
}

/**
 * The standard piece whose placement habits a piece borrows: short-range pieces sit forward like
 * knights, long-range ones like bishops, rooks or queens. The scoring tables only know these six.
 */
const PLACEMENT_ANALOG: Record<PieceType, 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'> = {
  K: 'K',
  Q: 'Q',
  R: 'R',
  B: 'B',
  N: 'N',
  P: 'P',
  E: 'P',
  F: 'N',
  W: 'N',
  M: 'N',
  L: 'N',
  T: 'N',
  G: 'B',
  X: 'R',
  A: 'B',
  C: 'R',
  Z: 'Q',
};

/** Maps a file on an 8-wide board to the nearest file on `spec`. */
function fromFile8(file8: number, spec: BoardSpec): number {
  return Math.round((file8 * (spec.files - 1)) / 7);
}

/**
 * How much `style` likes `type` on `sq`. Tables are left/right symmetric and written for 8 files
 * and 3 home rows: other boards are read through the nearest 8-file column, with the front row
 * always treated as row 2.
 */
export function squareScore(
  type: PieceType,
  sq: Square,
  style: AiStyle,
  king: Square | null,
  placed: Piece[] = [],
  spec: BoardSpec = BOARD_8,
): number {
  const file = Math.round((sq.file * 7) / (spec.files - 1));
  const rank = sq.rank === frontRank(spec) ? 2 : sq.rank;
  switch (PLACEMENT_ANALOG[type]) {
    case 'P': {
      const shields = king && Math.abs(sq.file - king.file) <= 1 && sq.rank === king.rank + 1;
      const doubled = placed.some((p) => isPawnLike(p.type) && p.square?.file === sq.file);
      return (
        (rank === 1 ? 2 : 1) +
        CENTER[file] * 0.5 +
        (rank === 2 ? style.pawnFront : 0) +
        (shields ? style.shield : 0) -
        (doubled ? DOUBLED_PAWN : 0)
      );
    }
    case 'N':
      return ([1, 2, 5, 6].includes(file) ? 1.5 : 0) + [0, 1, 0.6][rank] + CENTER[file] * 0.5 + style.forward * rank;
    case 'B':
      return ([2, 5].includes(file) ? 1.5 : 0) + [1, 0.8, 0][rank] + style.forward * rank;
    case 'R':
      return (
        (rank === 0 ? 2 : 0) + ([0, 7].includes(file) ? 1 : [3, 4].includes(file) ? 1.2 : 0) + style.forward * rank
      );
    case 'Q':
      return [1.5, 1, 0][rank] + CENTER[file] * 1.5 + style.forward * rank;
    case 'K':
      return 0;
  }
}

function allSquares(spec: BoardSpec): Square[] {
  const out: Square[] = [];
  for (let rank = 0; rank < spec.homeRows; rank++)
    for (let file = 0; file < spec.files; file++) out.push({ file, rank });
  return out;
}

function points(types: PieceType[]): number {
  return types.reduce((s, t) => s + PIECE_VALUE[t], 0);
}
