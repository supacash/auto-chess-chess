/**
 * Rules parity: plays random games in our engine (WASM) and in ffish (Fairy-Stockfish's rules) side by
 * side and checks they agree at every position: legal moves, FEN, check, insufficient material and
 * threefold repetition, plus every child's legal moves at some positions. The Phase 1 gate
 * (docs/ENGINE-PLAN.md) is 0 mismatches.
 *
 *   npm run check:perft -- --positions 10000
 *
 * Positions come from three sources, in equal parts: battle starts as the game drafts them (every
 * round, so every board, fairy armies and Heirs), random placements of random pieces anywhere, and
 * small endgames. The walks prefer undoing the last move now and then, so repetitions come up.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import Module from 'ffish-es6';
import {
  BOARDS,
  type BoardSpec,
  battleVariant,
  boardForRound,
  engineFen,
  plyLimit,
  variantsIni,
} from '../../src/chess/boardSpec';
import { setRules } from '../../src/chess/rules';
import { benchBattle } from '../../src/engine/benchCorpus';
import { Board } from '../../src/engine/wasm/acc';
import { loadEngineForNode } from '../../src/engine/wasmNode';
import { isPawnLike, PIECE_TYPES, type PieceType } from '../../src/rules/pieces';
import { randomInt, type Rng, seededRng } from '../../src/rules/rng';

const { values: opts } = parseArgs({
  options: {
    positions: { type: 'string', default: '3000' },
    seed: { type: 'string', default: '1' },
    'max-report': { type: 'string', default: '20' },
  },
});
const POSITIONS = Number(opts.positions);
const SEED = Number(opts.seed);
const MAX_REPORT = Number(opts['max-report']);

type FfishBoard = InstanceType<Awaited<ReturnType<typeof Module>>['Board']>;

const require = createRequire(import.meta.url);
const ffish = await Module({ wasmBinary: readFileSync(require.resolve('ffish-es6/ffish.wasm')) } as Parameters<
  typeof Module
>[0]);
ffish.loadVariantConfig(variantsIni());
setRules(ffish); // benchBattle places armies with the game's rules (ffish)
loadEngineForNode();

let mismatches = 0;
let nodes = 0;
let childChecks = 0;
const seen = { check: 0, repetition: 0, insufficient: 0, mate: 0, stalemate: 0, twoKings: 0, enPassant: 0 };

/** Records a mismatch. Returns false, for `return report(...)` from a comparison. */
function report(what: string, fen: string, moves: string[], ours: unknown, theirs: unknown): false {
  mismatches++;
  if (mismatches <= MAX_REPORT) {
    console.log(`\nMISMATCH ${what}\n  start ${fen}\n  moves ${moves.join(' ')}\n  ours   ${ours}\n  ffish  ${theirs}`);
  }
  return false;
}

const sortMoves = (list: string) => list.split(' ').filter(Boolean).sort().join(' ');

/** Compares the two boards at the current position; false if they disagree. */
function compare(ours: Board, theirs: FfishBoard, start: string, moves: string[]): boolean {
  nodes++;
  const [a, b] = [sortMoves(ours.legalMoves()), sortMoves(theirs.legalMoves())];
  if (a !== b) return report('legal moves', start, moves, a, b);
  const [fa, fb] = [engineFen(ours.fen()), theirs.fen()];
  if (fa !== fb) return report('fen', start, moves, fa, fb);
  if (ours.isCheck() !== theirs.isCheck()) return report('check', start, moves, ours.isCheck(), theirs.isCheck());
  const ins = ours.isInsufficientMaterial();
  if (ins !== theirs.isInsufficientMaterial()) return report('insufficient', start, moves, ins, !ins);
  // ffish claims a repetition through isGameOver(true), which also covers the other endings.
  const otherEnd = a === '' || ins || theirs.halfmoveClock() >= 100;
  const rep = ours.isThreefold();
  if (!otherEnd && rep !== theirs.isGameOver(true)) return report('threefold', start, moves, rep, !rep);
  if (theirs.isCheck()) seen.check++;
  if (rep) seen.repetition++;
  if (ins) seen.insufficient++;
  if (a === '') seen[theirs.isCheck() ? 'mate' : 'stalemate']++;
  if (fb.split(' ')[3] !== '-') seen.enPassant++;
  return true;
}

/** At this position, checks every child's legal moves too (a depth-2 comparison). */
function compareChildren(ours: Board, theirs: FfishBoard, start: string, moves: string[]): boolean {
  childChecks++;
  for (const m of theirs.legalMoves().split(' ').filter(Boolean)) {
    if (!ours.push(m)) return report('push', start, [...moves, m], 'illegal', 'legal');
    theirs.push(m);
    const ok = compare(ours, theirs, start, [...moves, m]);
    ours.pop();
    theirs.pop();
    if (!ok) return false;
  }
  return true;
}

function walk(spec: BoardSpec, fen: string, rng: Rng): void {
  const variant = battleVariant(spec, fen);
  if (variant.endsWith('k2')) seen.twoKings++;
  let theirs: FfishBoard;
  try {
    theirs = new ffish.Board(variant, engineFen(fen));
  } catch {
    return;
  }
  const ours = new Board(variant, fen);
  const moves: string[] = [];
  try {
    for (let ply = 0; ply <= plyLimit(spec); ply++) {
      if (!compare(ours, theirs, fen, moves)) return;
      if (rng() < 0.03 && !compareChildren(ours, theirs, fen, moves)) return;
      const legal = theirs.legalMoves().split(' ').filter(Boolean);
      if (legal.length === 0 || ours.isThreefold() || theirs.isInsufficientMaterial()) return;
      // Undo the side's own last move half the time (when it can), so positions repeat.
      const last = moves.at(-2);
      const back = last && `${last.slice(2, 4)}${last.slice(0, 2)}`;
      const move = back && legal.includes(back) && rng() < 0.5 ? back : legal[randomInt(rng, legal.length)];
      theirs.push(move);
      if (!ours.push(move)) return void report('push', fen, [...moves, move], 'illegal', 'legal');
      moves.push(move);
    }
  } finally {
    ours.delete();
    theirs.delete();
  }
}

const FAIRY = PIECE_TYPES.filter((t) => t !== 'K' && t !== 'J');

/** A random position: kings plus random pieces anywhere (pawns off the first and last ranks). */
function randomPlacement(spec: BoardSpec, rng: Rng, pieceCount: number, pool: readonly PieceType[]): string {
  for (;;) {
    const grid: (string | null)[][] = Array.from({ length: spec.ranks }, () => Array(spec.files).fill(null));
    const free = () => {
      for (;;) {
        const [f, r] = [randomInt(rng, spec.files), randomInt(rng, spec.ranks)];
        if (!grid[r][f]) return [f, r] as const;
      }
    };
    for (const color of ['w', 'b'] as const) {
      const kings = rng() < 0.2 ? ['K', 'J'] : ['K'];
      for (const k of kings) {
        const [f, r] = free();
        grid[r][f] = color === 'w' ? k : k.toLowerCase();
      }
    }
    for (let i = 0; i < pieceCount; i++) {
      const type = pool[randomInt(rng, pool.length)];
      const white = rng() < 0.5;
      let [f, r] = free();
      while (isPawnLike(type) && (r === 0 || r === spec.ranks - 1)) [f, r] = free();
      grid[r][f] = white ? type : type.toLowerCase();
    }
    const placement = grid
      .slice()
      .reverse()
      .map((row) => {
        let s = '';
        let empty = 0;
        for (const c of row) {
          if (!c) empty++;
          else {
            if (empty) s += empty;
            empty = 0;
            s += c;
          }
        }
        return empty ? s + empty : s;
      })
      .join('/');
    const side = rng() < 0.5 ? 'w' : 'b';
    const fen = `${placement} ${side} - - 0 1`;
    // The side not to move mustn't be in check (its king could be taken). Ask ffish.
    const other = new ffish.Board(
      battleVariant(spec, fen),
      engineFen(`${placement} ${side === 'w' ? 'b' : 'w'} - - 0 1`),
    );
    const illegal = other.isCheck();
    other.delete();
    if (!illegal) return fen;
  }
}

const t0 = Date.now();
const rng = seededRng(SEED);
const ENDGAME_POOL: PieceType[] = ['N', 'B', 'P', 'E', 'F', 'W', 'R', 'G'];
for (let i = 0; i < POSITIONS; i++) {
  const source = i % 3;
  if (source === 0) {
    const round = 1 + randomInt(rng, 25);
    walk(boardForRound(round), benchBattle(rng, round, rng() < 0.3, rng() < 0.5), rng);
  } else {
    const spec = BOARDS[randomInt(rng, BOARDS.length)];
    const fen =
      source === 1
        ? randomPlacement(spec, rng, 2 + randomInt(rng, spec.files * 2), FAIRY)
        : randomPlacement(spec, rng, randomInt(rng, 4), ENDGAME_POOL);
    walk(spec, fen, rng);
  }
  if (i % 50 === 0) process.stderr.write(`\r${i}/${POSITIONS} positions, ${nodes} nodes, ${mismatches} mismatches  `);
}
console.log(
  `\n${POSITIONS} positions, ${nodes} nodes compared (${childChecks} with every child), ${mismatches} mismatches, ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s.\nCovered: ${Object.entries(seen)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
);
process.exit(mismatches ? 1 : 0);
