/**
 * Writes battle starts as the game drafts them, for the engine's native self-play and tuning
 * (docs/ENGINE-PLAN.md, phase 4): one line per battle, `variant;plyLimit;fen`.
 *
 *   npm run sim:starts -- --count 20000 --out starts.txt
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { battleVariant, boardForRound, plyLimit } from '../../src/chess/boardSpec';
import { loadRulesForNode } from '../../src/chess/testRules';
import { benchBattle } from '../../src/engine/benchCorpus';
import { randomInt, seededRng } from '../../src/rules/rng';

const { values: opts } = parseArgs({
  options: {
    count: { type: 'string', default: '10000' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string', default: 'starts.txt' },
  },
});

await loadRulesForNode();
const rng = seededRng(Number(opts.seed));
const lines: string[] = [];
for (let i = 0; i < Number(opts.count); i++) {
  const round = 1 + randomInt(rng, 25);
  const spec = boardForRound(round);
  const fen = benchBattle(rng, round, rng() < 0.3, rng() < 0.5);
  lines.push(`${battleVariant(spec, fen)};${plyLimit(spec)};${fen}`);
}
writeFileSync(opts.out, `${lines.join('\n')}\n`);
console.log(`${lines.length} starts written to ${opts.out}`);
