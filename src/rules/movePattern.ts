import type { PieceType } from './pieces';

/**
 * How a piece reaches a square on its move diagram: `any` moves there or captures there, `move` only
 * moves there, `capture` only captures there, and `hop` lands there by jumping over a piece (the
 * Grasshopper). The Cannon and Siege Cannon slide to move and capture only by jumping over one piece;
 * their diagrams show the slides (`move`) and the description says how they capture.
 */
export type Reach = 'any' | 'move' | 'capture' | 'hop';

type Offset = readonly [dx: number, dy: number];

/** One way of moving: offsets (dy is forward), how far along each it goes, and what it can do there. */
interface Atom {
  offsets: readonly Offset[];
  /** Slides any distance along each offset (a rider), instead of jumping just once. */
  ride?: boolean;
  /** Only from this distance on (the Grasshopper lands beyond the piece it hops). */
  from?: number;
  reach: Reach;
}

/** The eight (or four) offsets of an (a, b) leaper, both ways round and in every direction. */
function leaper(a: number, b: number): Offset[] {
  const out = new Map<string, Offset>();
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) out.set(`${sx * x},${sy * y}`, [sx * x, sy * y]);
  }
  return [...out.values()];
}

const W = leaper(1, 0);
const F = leaper(1, 1);
const N = leaper(2, 1);
const CAMEL = leaper(3, 1);
const ALFIL = leaper(2, 2);
const DABBABA = leaper(2, 0);
const KING = [...W, ...F];

const step = (offsets: readonly Offset[], reach: Reach = 'any'): Atom => ({ offsets, reach });
const slide = (offsets: readonly Offset[], reach: Reach = 'any'): Atom => ({ offsets, ride: true, reach });

/** Every piece's moves, matching its Betza notation in pieces.ts (and the standard pieces' rules). */
const ATOMS: Record<PieceType, Atom[]> = {
  K: [step(KING)],
  Q: [slide(KING)],
  R: [slide(W)],
  B: [slide(F)],
  N: [step(N)],
  // Forward one (two on its first move), captures one diagonally forward.
  P: [
    step(
      [
        [0, 1],
        [0, 2],
      ],
      'move',
    ),
    step(
      [
        [1, 1],
        [-1, 1],
      ],
      'capture',
    ),
  ],
  // The reverse: diagonally forward (two on its first move), captures straight ahead.
  E: [
    step(
      [
        [1, 1],
        [-1, 1],
        [2, 2],
        [-2, 2],
      ],
      'move',
    ),
    step([[0, 1]], 'capture'),
  ],
  F: [step(F)],
  W: [step(W)],
  M: [step(KING)],
  L: [step(CAMEL)],
  G: [{ offsets: KING, ride: true, from: 2, reach: 'hop' }],
  X: [slide(W, 'move')],
  T: [step(KING), step(N)],
  A: [slide(F), step(N)],
  C: [slide(W), step(N)],
  Z: [slide(KING), step(N)],
  D: [slide(W), step(F)],
  H: [slide(F), step(W)],
  U: [step(N), step(CAMEL)],
  S: [slide(KING, 'move')],
  Y: [step(KING), step(N), step(ALFIL), step(DABBABA)],
  J: [step(KING)],
};

/**
 * Where a piece standing in the middle of an empty `size`×`size` board can go, rows top first, with
 * forward up: each square's Reach, or null. The piece's own square is null.
 */
export function movePattern(type: PieceType, size = 7): (Reach | null)[][] {
  const mid = Math.floor(size / 2);
  const grid: (Reach | null)[][] = Array.from({ length: size }, () => Array<Reach | null>(size).fill(null));
  const mark = (dx: number, dy: number, reach: Reach) => {
    const col = mid + dx;
    const row = mid - dy;
    if (row < 0 || row >= size || col < 0 || col >= size) return false;
    const was = grid[row][col];
    // Moving there one way and capturing there another is reaching it either way.
    grid[row][col] = was === null || was === reach ? reach : 'any';
    return true;
  };
  for (const atom of ATOMS[type]) {
    for (const [dx, dy] of atom.offsets) {
      if (!atom.ride) {
        mark(dx, dy, atom.reach);
        continue;
      }
      for (let k = 1; k <= size; k++) {
        if (k < (atom.from ?? 1)) continue;
        if (!mark(dx * k, dy * k, atom.reach)) break;
      }
    }
  }
  return grid;
}
