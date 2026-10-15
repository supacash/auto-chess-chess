/**
 * Plays the same battles several ways and checks the moves match: a battle is reproducible from
 * (start position, seed), and the WASM build the game ships plays exactly what the native build plays
 * (the simulator and arena use the native one). Run: npm run check:determinism
 *
 * Each battle is played twice by the WASM engine (one engine reused, so earlier battles mustn't leak
 * into later ones) and once by the native engine (needs `cargo build --release -p acc-cli`).
 */
import { BOARDS, plyLimit } from '../../src/chess/boardSpec';
import { loadRulesForNode } from '../../src/chess/testRules';
import { ACC_LIMITS, AccEngine } from '../../src/engine/accEngine';
import { type MoveSource, runBattle } from '../../src/game/runBattle';
import { seededRng } from '../../src/rules/rng';
import { NodeEngine } from '../sim/nodeEngine';

const POSITIONS = [
  { spec: BOARDS[0], fen: 'r1k2/ppep1/5/1PXP1/1NK2 w - - 0 1' },
  { spec: BOARDS[3], fen: 'r1bqk1nr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1' },
  // White has an Heir: played under the two-kings rules.
  { spec: BOARDS[3], fen: 'r1bqk1nr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBJR w - - 0 1' },
  { spec: BOARDS[BOARDS.length - 1], fen: 'r1bqk1nr1/pppxpppp1/9/9/9/9/9/PPPPPPPPP/RNBQKXBNR w - - 0 1' },
];

async function play(engine: MoveSource, spec: (typeof BOARDS)[number], fen: string, seed: number) {
  const moves: string[] = [];
  const result = await runBattle(
    fen,
    engine,
    seededRng(seed),
    async (m) => void moves.push(m.uci),
    { plyLimit: plyLimit(spec) },
    spec,
  );
  return { moves: moves.join(' '), result };
}

await loadRulesForNode();
const wasm = new AccEngine(ACC_LIMITS);
const native = await NodeEngine.createAcc(ACC_LIMITS);
let ok = true;
for (const { spec, fen } of POSITIONS) {
  for (const seed of [1, 2, 3]) {
    const a = await play(wasm, spec, fen, seed);
    const b = await play(wasm, spec, fen, seed);
    const c = await play(native, spec, fen, seed);
    const same = a.moves === b.moves && a.moves === c.moves;
    ok &&= same;
    console.log(
      `${spec.variant} seed ${seed}: ${same ? 'same' : 'DIFFERENT'} (${a.result.winner} by ${a.result.reason}, ` +
        `${a.result.plies} plies)${a.moves === b.moves ? '' : ' [WASM runs differ]'}${a.moves === c.moves ? '' : ' [native differs]'}`,
    );
  }
}
wasm.terminate();
native.terminate();
process.exit(ok ? 0 : 1);
