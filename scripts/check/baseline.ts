/**
 * Baseline for replacing Fairy-Stockfish (docs/ENGINE-PLAN.md, phase 0): how long the current engine
 * takes per move, and how even its battles are by colour and by who moves first. Our own engine has
 * to match the speed and the fairness.
 *
 *   npm run check:baseline -- --games 400 --json docs/baseline/fairy-desktop.json
 *   npm run check:baseline -- --engine acc     (our engine: WASM for speed, the native build for fairness)
 *
 * Speed: one engine, no other load, timing a search of every position in the bench corpus
 * (src/engine/benchCorpus.ts; bench.html times the same corpus in a browser or on a phone).
 * Fairness: mirrored armies (both sides draft the same pieces) across rounds 1–25, in parallel.
 */
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { BOARDS, battleVariant, boardForRound, plyLimit } from '../../src/chess/boardSpec';
import { loadRulesForNode } from '../../src/chess/testRules';
import { ACC_LIMITS, AccEngine } from '../../src/engine/accEngine';
import { benchBattle, benchCorpus, percentile } from '../../src/engine/benchCorpus';
import { runBattle, SEARCH_DEPTH } from '../../src/game/runBattle';
import type { BattleResult } from '../../src/rules/battle';
import { seededRng } from '../../src/rules/rng';
import { EngineFailure, NodeEngine } from '../sim/nodeEngine';

const { values: opts } = parseArgs({
  options: {
    games: { type: 'string', default: '400' },
    seed: { type: 'string', default: '1' },
    'per-board': { type: 'string', default: '10' },
    workers: { type: 'string' },
    json: { type: 'string' },
    'skip-speed': { type: 'boolean', default: false },
    /** Write the speed corpus to this file ("variant<TAB>fen" lines, for `acc bench`) and stop. */
    dump: { type: 'string' },
    /** 'fairy' (Fairy-Stockfish) or 'acc' (our engine at ACC_LIMITS). */
    engine: { type: 'string', default: 'fairy' },
  },
});
const GAMES = Number(opts.games);
const SEED = Number(opts.seed);
const WORKERS = Math.min(GAMES, opts.workers ? Number(opts.workers) : Math.max(1, availableParallelism() - 2));
const ACC = opts.engine === 'acc';
const LABEL = ACC
  ? `our engine (WASM), depth ${ACC_LIMITS.depth}, ${ACC_LIMITS.nodes} nodes`
  : `Fairy-Stockfish, depth ${SEARCH_DEPTH}`;

interface SpeedRow {
  board: string;
  positions: number;
  failed: number;
  p50: number;
  p95: number;
  max: number;
}

async function speed(): Promise<SpeedRow[]> {
  const engine = ACC ? new AccEngine() : await NodeEngine.create();
  const corpus = benchCorpus(SEED, Number(opts['per-board']));
  const times = new Map<string, number[]>();
  const failed = new Map<string, number>();
  for (const [i, pos] of corpus.entries()) {
    await engine.newGame(battleVariant(pos.spec, pos.fen));
    const t0 = performance.now();
    try {
      await engine.candidates(pos.fen, SEARCH_DEPTH);
      times.set(pos.spec.variant, [...(times.get(pos.spec.variant) ?? []), performance.now() - t0]);
    } catch (e) {
      if (!(e instanceof EngineFailure)) throw e;
      failed.set(pos.spec.variant, (failed.get(pos.spec.variant) ?? 0) + 1);
    }
    process.stderr.write(`\rspeed ${i + 1}/${corpus.length}  `);
  }
  engine.terminate();
  return BOARDS.map((b) => {
    const t = times.get(b.variant) ?? [];
    return {
      board: `${b.files}×${b.ranks}`,
      positions: t.length,
      failed: failed.get(b.variant) ?? 0,
      p50: Math.round(percentile(t, 50)),
      p95: Math.round(percentile(t, 95)),
      max: Math.round(percentile(t, 100)),
    };
  });
}

interface GameRow {
  round: number;
  board: string;
  firstMover: 'w' | 'b';
  winner: BattleResult['winner'] | 'failed';
  reason: BattleResult['reason'] | 'failed';
  plies: number;
}

async function fairness(): Promise<GameRow[]> {
  const engines = await Promise.all(
    Array.from({ length: WORKERS }, () => (ACC ? NodeEngine.createAcc(ACC_LIMITS) : NodeEngine.create())),
  );
  const rows: GameRow[] = [];
  let next = 0;
  let done = 0;
  await Promise.all(
    engines.map(async (engine) => {
      while (next < GAMES) {
        const game = next++;
        const rng = seededRng(SEED * 100_003 + game);
        const round = 1 + (game % 25);
        const spec = boardForRound(round);
        const fen = benchBattle(rng, round, true, game % 2 === 0);
        const firstMover = fen.split(' ')[1] as 'w' | 'b';
        const board = `${spec.files}×${spec.ranks}`;
        try {
          const r = await runBattle(fen, engine, rng, async () => {}, { plyLimit: plyLimit(spec) }, spec);
          rows[game] = { round, board, firstMover, winner: r.winner, reason: r.reason, plies: r.plies };
        } catch (e) {
          if (!(e instanceof EngineFailure)) throw e;
          rows[game] = { round, board, firstMover, winner: 'failed', reason: 'failed', plies: 0 };
        }
        process.stderr.write(`\rfairness ${++done}/${GAMES} games  `);
      }
    }),
  );
  for (const e of engines) e.terminate();
  return rows;
}

/** Score (win 1, draw ½) of the side `pick` chooses, with its 95% margin. */
function score(rows: GameRow[], pick: (r: GameRow) => 'w' | 'b'): { score: number; margin: number; games: number } {
  const played = rows.filter((r) => r.winner !== 'failed');
  const points = played.reduce((s, r) => s + (r.winner === 'draw' ? 0.5 : r.winner === pick(r) ? 1 : 0), 0);
  const s = played.length ? points / played.length : 0;
  return {
    score: s,
    margin: played.length ? 1.96 * Math.sqrt((s * (1 - s)) / played.length) : 0,
    games: played.length,
  };
}

const pct = (x: { score: number; margin: number; games: number }) =>
  `${(x.score * 100).toFixed(1)}% ±${(x.margin * 100).toFixed(1)} (${x.games} games)`;

async function main(): Promise<void> {
  const t0 = Date.now();
  await loadRulesForNode();
  if (opts.dump) {
    const corpus = benchCorpus(SEED, Number(opts['per-board']));
    writeFileSync(opts.dump, corpus.map((p) => `${battleVariant(p.spec, p.fen)}\t${p.fen}\n`).join(''));
    console.log(`${corpus.length} positions written to ${opts.dump}`);
    return;
  }
  const speedRows = opts['skip-speed'] ? [] : await speed();
  const games = await fairness();

  if (speedRows.length) {
    console.log(`\n${LABEL}, one engine, ms per search:`);
    console.table(speedRows);
  }
  const white = score(games, () => 'w');
  const first = score(games, (r) => r.firstMover);
  const reasons: Record<string, number> = {};
  for (const g of games) reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
  const played = games.filter((g) => g.winner !== 'failed');
  console.log(
    `\nMirrored armies, rounds 1–25, ${games.length} games:\n` +
      `  White (the player's side): ${pct(white)}\n` +
      `  First mover:               ${pct(first)}\n` +
      `  Draws: ${games.filter((g) => g.winner === 'draw').length}, ` +
      `average length ${(played.reduce((s, g) => s + g.plies, 0) / Math.max(1, played.length)).toFixed(0)} plies\n` +
      `  End reasons: ${Object.entries(reasons)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}\n` +
      `Took ${((Date.now() - t0) / 1000).toFixed(0)}s (${WORKERS} engines for the fairness games).`,
  );
  if (opts.json) {
    writeFileSync(
      opts.json,
      `${JSON.stringify({ engine: ACC ? { acc: ACC_LIMITS } : 'fairy-stockfish', depth: SEARCH_DEPTH, seed: SEED, speed: speedRows, white, first, reasons, games }, null, 2)}\n`,
    );
  }
}

void main();
