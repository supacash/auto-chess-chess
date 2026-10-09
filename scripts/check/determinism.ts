/**
 * Plays the same battles twice with the same seeds and checks the moves match, i.e. that a battle
 * is reproducible from (start position, seed). Run: npx tsx scripts/check/determinism.ts
 */
import { BOARDS, plyLimit } from '../../src/chess/boardSpec';
import { loadRulesForNode } from '../../src/chess/testRules';
import { runBattle } from '../../src/game/runBattle';
import { seededRng } from '../../src/rules/rng';
import { NodeEngine } from '../sim/nodeEngine';

const POSITIONS = [
  { spec: BOARDS[0], fen: 'r1k2/ppep1/5/1PXP1/1NK2 w - - 0 1' },
  { spec: BOARDS[BOARDS.length - 1], fen: 'r1bqk1nr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1' },
];

await loadRulesForNode();
const engine = await NodeEngine.create();
let ok = true;
for (const { spec, fen } of POSITIONS) {
  for (const seed of [1, 2, 3]) {
    const runs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const moves: string[] = [];
      await runBattle(
        fen,
        engine,
        seededRng(seed),
        async (m) => void moves.push(m.uci),
        { plyLimit: plyLimit(spec) },
        spec,
      );
      runs.push(moves.join(' '));
    }
    const same = runs[0] === runs[1];
    ok &&= same;
    console.log(`${spec.variant} seed ${seed}: ${same ? 'same' : 'DIFFERENT'} (${runs[0].split(' ').length} plies)`);
  }
}
engine.terminate();
process.exit(ok ? 0 : 1);
