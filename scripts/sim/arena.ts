/**
 * Arena: the game's own engine (native build) against Fairy-Stockfish at the game's depth, on battles
 * drafted as the game drafts them (docs/ENGINE-PLAN.md, phases 3–4). Each start is played twice with
 * the engines swapping sides, so army and colour advantages cancel out.
 *
 *   cargo build --release -p acc-cli   (in engine/)
 *   npm run sim:arena -- --pairs 200 --acc-depth 8 --acc-nodes 200000
 *   npm run sim:arena -- --pairs 200 --opponent path/to/old/acc.exe   (our engine against an older build)
 *
 * Reports our engine's score (win 1, draw ½) with a 95% margin and the Elo difference, by board, and
 * each engine's time per move (parallel games slow both alike, so compare them with each other).
 */
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { BOARDS, boardForRound, plyLimit } from '../../src/chess/boardSpec';
import { fenTurn } from '../../src/chess/fen';
import { loadRulesForNode } from '../../src/chess/testRules';
import { benchBattle } from '../../src/engine/benchCorpus';
import type { Candidate, History } from '../../src/engine/pick';
import { type MoveSource, runBattle } from '../../src/game/runBattle';
import type { BattleResult } from '../../src/rules/battle';
import { randomInt, seededRng } from '../../src/rules/rng';
import { EngineFailure, NodeEngine } from './nodeEngine';

const { values: opts } = parseArgs({
  options: {
    pairs: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string' },
    'acc-depth': { type: 'string', default: '8' },
    'acc-nodes': { type: 'string', default: '0' },
    /** Rounds to draw battles from, "first-last" (1–25 covers every board). */
    rounds: { type: 'string', default: '1-25' },
    /** 'fairy' (Fairy-Stockfish at the game's depth) or the path of another acc build, at the same limits. */
    opponent: { type: 'string', default: 'fairy' },
    /** The largest board (files), e.g. 8: later rounds are played on it with their own armies. */
    'max-board': { type: 'string', default: '9' },
    json: { type: 'string' },
  },
});
const PAIRS = Number(opts.pairs);
const SEED = Number(opts.seed);
const WORKERS = Math.min(PAIRS, opts.workers ? Number(opts.workers) : Math.max(1, availableParallelism() - 2));
const ACC = { depth: Number(opts['acc-depth']), nodes: Number(opts['acc-nodes']) };
const [FIRST_ROUND, LAST_ROUND] = opts.rounds.split('-').map(Number);

/** Plays each side with its own engine, timing every search. */
class Duel implements MoveSource {
  readonly ms = { acc: [] as number[], fairy: [] as number[] };
  constructor(
    private readonly acc: NodeEngine,
    private readonly fairy: NodeEngine,
    private readonly accColor: 'w' | 'b',
  ) {}
  async newGame(variant: string, plyLimit?: number): Promise<void> {
    await Promise.all([this.acc.newGame(variant, plyLimit), this.fairy.newGame(variant, plyLimit)]);
  }
  async candidates(fen: string, depth: number, history?: History): Promise<Candidate[]> {
    const who = fenTurn(fen) === this.accColor ? 'acc' : 'fairy';
    const t0 = performance.now();
    const c = await this[who].candidates(fen, depth, history);
    this.ms[who].push(performance.now() - t0);
    return c;
  }
}

interface GameRow {
  pair: number;
  round: number;
  board: string;
  accColor: 'w' | 'b';
  /** Our engine's result: 1 win, ½ draw, 0 loss; null if Fairy-Stockfish couldn't play the position. */
  score: number | null;
  reason: BattleResult['reason'] | 'failed';
  plies: number;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await loadRulesForNode();
  const workers = await Promise.all(
    Array.from({ length: WORKERS }, async () => ({
      acc: await NodeEngine.createAcc(ACC),
      fairy:
        opts.opponent === 'fairy'
          ? await NodeEngine.create()
          : await NodeEngine.createAcc({ ...ACC, path: opts.opponent }),
    })),
  );
  const rows: GameRow[] = [];
  const times = { acc: [] as number[], fairy: [] as number[] };
  let next = 0;
  await Promise.all(
    workers.map(async ({ acc, fairy }) => {
      while (next < PAIRS) {
        const pair = next++;
        const setup = seededRng(SEED * 100_003 + pair);
        const round = FIRST_ROUND + randomInt(setup, LAST_ROUND - FIRST_ROUND + 1);
        const largest = BOARDS.filter((b) => b.files <= Number(opts['max-board'])).at(-1)!;
        const board = boardForRound(round);
        const spec = board.files > largest.files ? largest : board;
        const fen = benchBattle(setup, round, false, setup() < 0.5, spec);
        for (const accColor of ['w', 'b'] as const) {
          const duel = new Duel(acc, fairy, accColor);
          const rng = seededRng(SEED * 7_919 + pair);
          const row: GameRow = {
            pair,
            round,
            board: `${spec.files}×${spec.ranks}`,
            accColor,
            score: null,
            reason: 'failed',
            plies: 0,
          };
          try {
            const r = await runBattle(fen, duel, rng, async () => {}, { plyLimit: plyLimit(spec) }, spec);
            row.score = r.winner === 'draw' ? 0.5 : r.winner === accColor ? 1 : 0;
            row.reason = r.reason;
            row.plies = r.plies;
          } catch (e) {
            if (!(e instanceof EngineFailure)) throw e;
          }
          rows.push(row);
          times.acc.push(...duel.ms.acc);
          times.fairy.push(...duel.ms.fairy);
        }
        process.stderr.write(`\r${rows.length}/${PAIRS * 2} games  `);
      }
    }),
  );
  for (const w of workers) {
    w.acc.terminate();
    w.fairy.terminate();
  }

  const summary = (list: GameRow[]) => {
    const played = list.filter((r) => r.score !== null);
    const s = played.reduce((a, r) => a + (r.score ?? 0), 0) / Math.max(1, played.length);
    const margin = played.length ? 1.96 * Math.sqrt((s * (1 - s)) / played.length) : 0;
    const elo = s <= 0 || s >= 1 ? (s <= 0 ? -Infinity : Infinity) : -400 * Math.log10(1 / s - 1);
    const w = played.filter((r) => r.score === 1).length;
    const d = played.filter((r) => r.score === 0.5).length;
    return `${(s * 100).toFixed(1)}% ±${(margin * 100).toFixed(1)} (Elo ${elo.toFixed(0)}; +${w} =${d} -${played.length - w - d}${
      list.length > played.length ? `, ${list.length - played.length} failed` : ''
    })`;
  };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(
    `\nOur engine (depth ${ACC.depth}, nodes ${ACC.nodes || '∞'}) vs ${opts.opponent === 'fairy' ? 'Fairy-Stockfish (depth 8)' : opts.opponent}, ${rows.length} games:`,
  );
  console.log(`  all:   ${summary(rows)}`);
  for (const board of [...new Set(rows.map((r) => r.board))].sort()) {
    console.log(`  ${board}: ${summary(rows.filter((r) => r.board === board))}`);
  }
  console.log(
    `  ms per move: ours ${mean(times.acc).toFixed(0)}, opponent ${mean(times.fairy).toFixed(0)} ` +
      `(${WORKERS} games at once)\nTook ${((Date.now() - t0) / 1000).toFixed(0)}s.`,
  );
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify({ acc: ACC, seed: SEED, rows }, null, 2)}\n`);
}

void main();
