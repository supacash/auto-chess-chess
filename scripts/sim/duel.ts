/**
 * Piece duel: is one piece worth more than another at equal armies? Each game drafts one random
 * fairy army, then gives one side a copy plus piece A and the other a copy plus piece B, and the
 * engine plays it out. Games alternate which side moves first, so colour evens out.
 *
 *   npm run sim:duel -- --a Y --b Q --games 40 --budget 40
 *
 * Reports piece A's side: wins, draws, losses and score (win = 1, draw = ½).
 */
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { BOARD_8, plyLimit } from '../../src/chess/boardSpec';
import { loadRulesForNode } from '../../src/chess/testRules';
import { runBattle } from '../../src/game/runBattle';
import { draftAiArmy, pickStyle, placeAiArmy, placeForBattle } from '../../src/rules/aiArmy';
import { isPieceType, PIECE_NAME, type PieceType } from '../../src/rules/pieces';
import { seededRng } from '../../src/rules/rng';
import { ACC_LIMITS } from '../../src/engine/accSettings';
import { EngineFailure, NodeEngine } from './nodeEngine';

const { values: opts } = parseArgs({
  options: {
    a: { type: 'string', default: 'Y' },
    b: { type: 'string', default: 'Q' },
    games: { type: 'string', default: '40' },
    budget: { type: 'string', default: '40' },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string' },
  },
});
if (!isPieceType(opts.a) || !isPieceType(opts.b)) throw new Error('--a and --b must be piece letters (e.g. Y, Q)');
const A: PieceType = opts.a;
const B: PieceType = opts.b;
const GAMES = Number(opts.games);
const BUDGET = Number(opts.budget);
const SEED = Number(opts.seed);
const WORKERS = Math.min(GAMES, opts.workers ? Number(opts.workers) : Math.max(1, availableParallelism() - 2));
const spec = BOARD_8;

type Outcome = 'a' | 'b' | 'draw' | 'failed';

async function playGame(game: number, engine: NodeEngine): Promise<Outcome> {
  const rng = seededRng(SEED * 100_003 + game);
  const style = pickStyle(rng, true);
  const base = draftAiArmy(BUDGET, style, rng, spec, true);
  // White is the "player" side in startPosition; alternate which piece White gets.
  const whiteGetsA = game % 2 === 0;
  const white = placeAiArmy([...base, whiteGetsA ? A : B], style, rng, spec);
  const blackTypes = [...base, whiteGetsA ? B : A];
  const { start } = placeForBattle(white, blackTypes, style, rng, spec, game % 4 < 2);
  try {
    const result = await runBattle(start.fen, engine, rng, async () => {}, { plyLimit: plyLimit(spec) }, spec);
    if (result.winner === 'draw') return 'draw';
    return (result.winner === 'w') === whiteGetsA ? 'a' : 'b';
  } catch (e) {
    if (e instanceof EngineFailure) return 'failed';
    throw e;
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await loadRulesForNode();
  const engines = await Promise.all(Array.from({ length: WORKERS }, () => NodeEngine.createAcc(ACC_LIMITS)));
  const outcomes: Outcome[] = [];
  let next = 0;
  await Promise.all(
    engines.map(async (engine) => {
      while (next < GAMES) {
        const game = next++;
        outcomes[game] = await playGame(game, engine);
        process.stderr.write(`\r${outcomes.filter(Boolean).length}/${GAMES} games  `);
      }
    }),
  );
  for (const e of engines) e.terminate();
  const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
  const [w, d, l, f] = [count('a'), count('draw'), count('b'), count('failed')];
  const played = w + d + l;
  const score = played ? (w + d / 2) / played : 0;
  // 95% margin on the score (normal approximation).
  const margin = played ? 1.96 * Math.sqrt((score * (1 - score)) / played) : 0;
  console.log(
    `\n${PIECE_NAME[A]} (+${A}) vs ${PIECE_NAME[B]} (+${B}), ${BUDGET}-point fairy armies, ${played} games` +
      `${f ? ` (${f} the engine couldn't play)` : ''}:\n` +
      `${PIECE_NAME[A]} side: ${w} won, ${d} drawn, ${l} lost; score ${(score * 100).toFixed(0)}% ±${(margin * 100).toFixed(0)}\n` +
      `Took ${((Date.now() - t0) / 1000).toFixed(0)}s with ${WORKERS} engines.`,
  );
}

void main();
