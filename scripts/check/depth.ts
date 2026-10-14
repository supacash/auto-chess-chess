/**
 * How deep our engine gets within its node budget, compared with Fairy-Stockfish's time to depth 8, on
 * battle starts and positions a few moves in (docs/ENGINE-PLAN.md, phase 4).
 *
 *   npm run check:depth -- --rounds 7-25 --max-board 8 --nodes 300000
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BOARDS, battleVariant, boardForRound } from '../../src/chess/boardSpec';
import { Game } from '../../src/chess/rules';
import { loadRulesForNode } from '../../src/chess/testRules';
import { benchBattle } from '../../src/engine/benchCorpus';
import { randomInt, seededRng } from '../../src/rules/rng';

const { values: opts } = parseArgs({
  options: {
    rounds: { type: 'string', default: '7-25' },
    'max-board': { type: 'string', default: '8' },
    count: { type: 'string', default: '12' },
    nodes: { type: 'string', default: '300000' },
    depth: { type: 'string', default: '12' },
    seed: { type: 'string', default: '3' },
  },
});
const ACC = fileURLToPath(
  new URL(`../../engine/target/release/acc${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url),
);
const [first, last] = opts.rounds.split('-').map(Number);

await loadRulesForNode();
const rng = seededRng(Number(opts.seed));
const largest = BOARDS.filter((b) => b.files <= Number(opts['max-board'])).at(-1)!;
const depths: number[] = [];
for (let i = 0; i < Number(opts.count); i++) {
  const round = first + randomInt(rng, last - first + 1);
  const board = boardForRound(round);
  const spec = board.files > largest.files ? largest : board;
  const start = benchBattle(rng, round, false, true, spec);
  // A few random moves in, so not every position is a start.
  const game = new Game(spec, start);
  for (let p = 0; p < 2 * (i % 4); p++) {
    const legal = game.legalMoves();
    if (legal.length) game.play(legal[randomInt(rng, legal.length)]);
  }
  const fen = game.fen();
  game.delete();
  const input = [
    `setoption name UCI_Variant value ${battleVariant(spec, fen)}`,
    'setoption name MultiPV value 3',
    'ucinewgame',
    `position fen ${fen}`,
    `go depth ${opts.depth} nodes ${opts.nodes}`,
    'quit',
  ].join('\n');
  const t0 = performance.now();
  const out = spawnSync(ACC, ['uci'], { input, encoding: 'utf8' }).stdout;
  const ms = performance.now() - t0;
  const line = out.split('\n').find((l) => l.includes('multipv 1')) ?? '';
  const depth = Number(/depth (\d+)/.exec(line)?.[1] ?? 0);
  depths.push(depth);
  console.log(
    `round ${round} ${spec.files}×${spec.ranks}: depth ${depth}, ${Math.round(ms)} ms  ${line.split(' pv ')[1] ?? ''}`,
  );
}
console.log(`mean depth ${(depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1)}`);
