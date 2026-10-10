import { BOARD_8, type BoardSpec, pawnSquares } from '../chess/boardSpec';
import { isPawnLike, makePiece, type Piece, type PieceType, type Square, PIECE_VALUE } from './pieces';
import { armyCap, BACK_RANK, canPlace, frontRank, pieceAt } from './placement';
import { type StartPosition, startPosition } from './position';
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
  /** Extra draft weights for fairy pieces (fusion pieces included), used only with fairy pieces on. */
  fairyWeights: Partial<Record<PieceType, number>>;
  /** With fairy pieces on, the share of pawns drafted as Berolina pawns. */
  berolinaShare: number;
  /** Only drafted with fairy pieces on. */
  fairyOnly?: boolean;
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
    fairyWeights: { M: 0.6, L: 0.5, X: 0.7, T: 0.4, A: 0.5, C: 0.4 },
    berolinaShare: 0.2,
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
    // Short-range defenders and a cannon behind the pawn wall.
    fairyWeights: { F: 1, W: 1, M: 1.2, X: 1, C: 0.3 },
    berolinaShare: 0.15,
    kingFiles: [6, 7],
    kingRank: 0,
    forward: -0.3,
    pawnFront: 0,
    shield: 2.5,
  },
  {
    id: 'heavy',
    name: 'Heavy Artillery',
    // Was 0.15 pawns and Q 3: too few pieces and pawns to shield the king (players beat it 71%).
    pawnShare: 0.2,
    weights: { N: 0.5, B: 0.8, R: 2.5, Q: 2 },
    fairyWeights: { X: 1.5, C: 1.5, A: 0.8, Z: 1.2 },
    berolinaShare: 0.2,
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
    // Was N 3, B 2.5, R 0.5: at equal points it beat players 59% of the time.
    weights: { N: 2, B: 2, R: 1, Q: 0.7 },
    // Jumpers and knight compounds.
    fairyWeights: { L: 1.5, T: 1.2, A: 1.5 },
    berolinaShare: 0.3,
    kingFiles: [4, 3, 5],
    kingRank: 0,
    forward: 0.8,
    pawnFront: 1,
    shield: 0.5,
  },
  {
    id: 'menagerie',
    name: 'Menagerie',
    fairyOnly: true,
    pawnShare: 0.3,
    weights: { N: 0.5, B: 0.5, R: 0.5, Q: 0.3 },
    fairyWeights: { F: 1, W: 1, M: 1.2, L: 1.2, X: 1.2, T: 1, A: 0.8, C: 0.8, Z: 0.5 },
    berolinaShare: 0.6,
    kingFiles: [4, 3],
    kingRank: 0,
    forward: 0.3,
    pawnFront: 0.5,
    shield: 1,
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
  return (
    Math.round(perRound * round * rampFactor(round)) +
    bonus +
    randomInt(rng, 3) -
    1 -
    (round === 1 ? roundOneDiscount : 0)
  );
}

/**
 * Shapes the budget over a run so the difficulty is steady: with a flat perRound × round, every
 * difficulty was hardest in rounds 3–5 (the player has few pieces and no merges yet) and easiest from
 * round 7 (merged rooks and queens beat drafted armies at equal points). So it dips in rounds 2–4,
 * peaks around round 7, and is back to 1 from round 10: holding the peak made the AI outgrow the
 * player's income and the late game a wall (SIMULATION.md §15). The last factor holds from then on.
 */
export const RAMP = [1, 0.93, 0.92, 0.94, 1, 1.06, 1.1, 1.08, 1.04, 1];

export function rampFactor(round: number): number {
  return RAMP[Math.min(round, RAMP.length) - 1] ?? 1;
}

/**
 * Moving second is a small handicap (with merge-first upgrades Black won 74% to White's 78% at the
 * same budget: SIMULATION.md §14), so when the player is Black the AI's army is a little smaller.
 */
export const BLACK_DISCOUNT = 0.02;

/** The AI's budget once the player's side is known: smaller when the player moves second. */
export function budgetForSide(budget: number, playerFirst: boolean, discount = BLACK_DISCOUNT): number {
  return playerFirst ? budget : budget - Math.round(budget * discount);
}

/** The most an army can be worth on `spec`: a full board of queens around the king. */
export function maxArmyValue(spec: BoardSpec): number {
  return (armyCap(spec) - 1) * PIECE_VALUE.Q;
}

/** A random style; fairy-only styles only when `fairy` is on. */
export function pickStyle(rng: Rng, fairy = false): AiStyle {
  const styles = AI_STYLES.filter((s) => fairy || !s.fairyOnly);
  return styles[randomInt(rng, styles.length)];
}

/**
 * The upgrades an AI army is drafted as if it had made: merges up the standard ladder (it stands for a
 * player who merged), plus, with fairy pieces on, the fusions it could have made (partner bought outright).
 */
const LADDER: Partial<Record<PieceType, PieceType[]>> = { P: ['N', 'B'], N: ['R'], B: ['R'], R: ['Q'] };

/** Fusions, with fairy pieces on. */
const FAIRY_UPGRADES: Partial<Record<PieceType, PieceType[]>> = {
  F: ['M'],
  W: ['M'],
  N: ['T', 'A', 'C'],
  B: ['A'],
  R: ['C'],
  Q: ['Z'],
};

/**
 * What an upgrade costs the AI: the difference in value. Players pay a premium for gold upgrades, but
 * the AI stands for an army built mostly by merging, which keeps (or nearly keeps) the points.
 */
function valueGain(from: PieceType, to: PieceType): number {
  return PIECE_VALUE[to] - PIECE_VALUE[from];
}

function upgradesFor(type: PieceType, fairy: boolean): PieceType[] {
  const ladder = LADDER[type] ?? [];
  return fairy ? [...ladder, ...(FAIRY_UPGRADES[type] ?? [])] : ladder;
}

/**
 * Picks piece types (always including the king) whose values sum to at most `budget` and that
 * fit `spec`'s home rows: non-pawn pieces by the style's weights, the rest as pawns, and any budget
 * left once the board or the pawn cap is full goes into upgrades. With `fairy`, the style's fairy
 * pieces join the draft, some pawns are Berolina pawns, and upgrades include fusions.
 */
export function draftAiArmy(
  budget: number,
  style: AiStyle,
  rng: Rng,
  spec: BoardSpec = BOARD_8,
  fairy = false,
): PieceType[] {
  // Budget past a full board of queens can't be spent; capping it keeps the numbers honest.
  budget = Math.min(budget, maxArmyValue(spec));
  const types: PieceType[] = ['K'];
  const capacity = armyCap(spec);
  const pawnCap = Math.min(MAX_PAWNS, pawnSquares(spec));
  let pieceBudget = budget - Math.round(budget * style.pawnShare);
  const weights: Partial<Record<PieceType, number>> = fairy
    ? { ...style.weights, ...style.fairyWeights }
    : style.weights;
  const options = (Object.keys(weights) as PieceType[]).filter((t) => (weights[t] ?? 0) > 0 && !isPawnLike(t));
  while (types.length < capacity) {
    const affordable = options.filter((t) => PIECE_VALUE[t] <= pieceBudget);
    if (affordable.length === 0) break;
    const pick = weightedPick(affordable, (t) => weights[t]!, rng);
    types.push(pick);
    pieceBudget -= PIECE_VALUE[pick];
  }

  let left = budget - points(types);
  const pawns = Math.max(0, Math.min(left, pawnCap, capacity - types.length));
  for (let i = 0; i < pawns; i++) types.push(fairy && rng() < style.berolinaShare ? 'E' : 'P');
  left -= pawns;
  // Pawns capped out with squares still free: more of the style's pieces before any upgrades, so
  // armies keep their character as budgets grow (upgrades turn everything into rooks and queens).
  while (types.length < capacity) {
    const affordable = options.filter((t) => PIECE_VALUE[t] <= left);
    if (affordable.length === 0) break;
    const pick = weightedPick(affordable, (t) => weights[t]!, rng);
    types.push(pick);
    left -= PIECE_VALUE[pick];
  }
  // Gold upgrades cost 2 or 4, so an odd leftover can't be spent; trade a pawn back to make it even.
  // (Fusion upgrades include odd costs, so with fairy pieces on the leftover usually gets spent anyway.)
  if (!fairy && left % 2 === 1 && pawns > 0 && types.at(-1) !== undefined && isPawnLike(types.at(-1)!)) {
    types.pop();
    left++;
  }

  // Spend leftovers on upgrades, cheapest pieces first but pawns last: upgrading pawns first used to
  // strip pawn-heavy styles of every pawn once the budget grew (Fortress had none at 40 points).
  for (;;) {
    const order = types
      .map((t, i) => [t, i] as const)
      .sort(([a], [b]) => Number(isPawnLike(a)) - Number(isPawnLike(b)) || PIECE_VALUE[a] - PIECE_VALUE[b]);
    const found = order
      .map(([from, i]) => ({
        i,
        to: upgradesFor(from, fairy).filter((to) => valueGain(from, to) <= left),
      }))
      .find((o) => o.to.length > 0);
    if (!found) break;
    const to = weightedPick(found.to, (t) => weights[t] ?? 0.1, rng);
    left -= valueGain(types[found.i], to);
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

/**
 * Places the AI army against `player` so the battle can start: both kings may not begin in check.
 * Re-places a few times in the style, then in the other styles' layouts (their kings stand on other
 * files), and as a last resort drops the AI's least valuable pieces until the start is legal (a lone
 * king can't give check, so this always ends). Needs the chess rules loaded.
 */
export function placeForBattle(
  player: Piece[],
  aiTypes: PieceType[],
  style: AiStyle,
  rng: Rng,
  spec: BoardSpec,
  playerFirst: boolean,
): { ai: Piece[]; start: Extract<StartPosition, { ok: true }> } {
  for (let attempt = 0; attempt < 60; attempt++) {
    const layout = attempt < 20 ? style : AI_STYLES[attempt % AI_STYLES.length];
    const ai = placeAiArmy(aiTypes, layout, rng, spec);
    const start = startPosition(player, ai, playerFirst, spec);
    if (start.ok) return { ai, start };
  }
  const types = [...aiTypes].sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
  for (;;) {
    const ai = placeAiArmy(types, style, rng, spec);
    const start = startPosition(player, ai, playerFirst, spec);
    if (start.ok) return { ai, start };
    let drop = types.length - 1;
    while (drop >= 0 && types[drop] === 'K') drop--;
    if (drop < 0) throw new Error('No legal start position');
    types.splice(drop, 1);
  }
}
