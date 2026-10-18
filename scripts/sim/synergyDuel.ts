/**
 * Synergy duel: what is one family's synergy worth? Each game drafts a random fairy army with enough
 * of the family for the tier asked, places it, and plays it against an exact copy of itself where
 * only one side gets that family's upgrades (synergy.ts). Games alternate which side gets them and
 * who moves first, so colour evens out.
 *
 *   npm run sim:synergy -- --family cavalry --tier 1 --games 200 --budget 30
 *
 * Reports the upgraded side's wins, draws, losses and score (win = 1, draw = ½), and the points its
 * upgrades added on average.
 */
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { BOARDS, plyLimit } from '../../src/chess/boardSpec';
import { loadRulesForNode } from '../../src/chess/testRules';
import { ACC_LIMITS } from '../../src/engine/accSettings';
import { runBattle } from '../../src/game/runBattle';
import { draftAiArmy, MAX_PAWNS, pickStyle, placeAiArmy } from '../../src/rules/aiArmy';
import { isPawnLike, makePiece, type Piece, type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import { armyCap } from '../../src/rules/placement';
import { startPosition } from '../../src/rules/position';
import { type Rng, seededRng } from '../../src/rules/rng';
import { applyUpgrades, FAMILIES, synergyUpgrades, upgradePoints } from '../../src/rules/synergy';
import { EngineFailure, NodeEngine } from './nodeEngine';

const { values: opts } = parseArgs({
  options: {
    family: { type: 'string', default: 'cavalry' },
    tier: { type: 'string', default: '1' },
    games: { type: 'string', default: '200' },
    budget: { type: 'string', default: '30' },
    board: { type: 'string', default: '8' },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string' },
  },
});
const FAMILY = FAMILIES.find((f) => f.id === opts.family);
if (!FAMILY) throw new Error(`--family must be one of: ${FAMILIES.map((f) => f.id).join(', ')}`);
const TIER = Number(opts.tier);
if (!(TIER >= 1 && TIER <= FAMILY.tiers.length)) throw new Error(`--tier must be 1–${FAMILY.tiers.length}`);
const NEEDED = FAMILY.tiers[TIER - 1];
const GAMES = Number(opts.games);
const BUDGET = Number(opts.budget);
const SEED = Number(opts.seed);
const spec = BOARDS.find((b) => b.files === Number(opts.board));
if (!spec) throw new Error('--board must be 5, 6, 7, 8 or 9');
const WORKERS = Math.min(GAMES, opts.workers ? Number(opts.workers) : Math.max(1, availableParallelism() - 2));
/** The member added to reach the tier: the family's first piece that gets upgraded (a pawn, Knight, Ferz, Cannon). */
const SOURCE = Object.keys(FAMILY.upgrades)[0] as PieceType;

type Outcome = { result: 'up' | 'base' | 'draw' | 'failed'; points: number };

/** A drafted army topped up with SOURCE pieces until it has NEEDED of the family, all placed. */
function army(rng: Rng): Piece[] | null {
  const style = pickStyle(rng, true);
  const count = (types: PieceType[]) => types.filter((t) => FAMILY!.members.includes(t)).length;
  // Leave room in the budget (and on the board) for the pieces added.
  const extra = NEEDED * PIECE_VALUE[SOURCE];
  const types = draftAiArmy(Math.max(4, BUDGET - extra), style, rng, spec!, true);
  while (count(types) < NEEDED) {
    if (types.length >= armyCap(spec!)) {
      // Make room by dropping the cheapest piece outside the family (never the King).
      const drop = types
        .map((t, i) => [t, i] as const)
        .filter(([t]) => t !== 'K' && !FAMILY!.members.includes(t))
        .sort(([a], [b]) => PIECE_VALUE[a] - PIECE_VALUE[b])[0];
      if (!drop) return null;
      types.splice(drop[1], 1);
    }
    if (isPawnLike(SOURCE) && types.filter(isPawnLike).length >= MAX_PAWNS) return null;
    types.push(SOURCE);
  }
  const placed = placeAiArmy(types, style, rng, spec!);
  return count(placed.map((p) => p.type)) >= NEEDED ? placed : null;
}

async function playGame(game: number, engine: NodeEngine): Promise<Outcome> {
  const rng = seededRng(SEED * 100_003 + game);
  let placed: Piece[] | null = null;
  for (let tries = 0; !placed && tries < 20; tries++) placed = army(rng);
  if (!placed) return { result: 'failed', points: 0 };
  // Only this family's upgrades, so the duel measures it alone.
  const upgrades = synergyUpgrades(placed, spec!).filter((u) => u.family === FAMILY!.id);
  const upgraded = applyUpgrades(placed, upgrades);
  const copy = placed.map((p) => makePiece(p.type, p.square, p.affinity));
  // White is the "player" side in startPosition; alternate who gets the upgrades and who moves first.
  const whiteUp = game % 2 === 0;
  const start = startPosition(whiteUp ? upgraded : copy, whiteUp ? copy : upgraded, game % 4 < 2, spec!);
  if (!start.ok) return { result: 'failed', points: 0 };
  try {
    const result = await runBattle(start.fen, engine, rng, async () => {}, { plyLimit: plyLimit(spec!) }, spec!);
    const points = upgradePoints(upgrades);
    if (result.winner === 'draw') return { result: 'draw', points };
    return { result: (result.winner === 'w') === whiteUp ? 'up' : 'base', points };
  } catch (e) {
    if (e instanceof EngineFailure) return { result: 'failed', points: 0 };
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
  const count = (r: Outcome['result']) => outcomes.filter((o) => o.result === r).length;
  const [w, d, l, f] = [count('up'), count('draw'), count('base'), count('failed')];
  const played = w + d + l;
  const score = played ? (w + d / 2) / played : 0;
  // 95% margin on the score (normal approximation).
  const margin = played ? 1.96 * Math.sqrt((score * (1 - score)) / played) : 0;
  const points = outcomes.filter((o) => o.result !== 'failed').reduce((s, o) => s + o.points, 0) / (played || 1);
  console.log(
    `\n${FAMILY!.name} tier ${TIER} (${NEEDED}+ ${FAMILY!.kind}), ${BUDGET}-point fairy armies on ${spec!.files}×${spec!.ranks}, ` +
      `${played} games${f ? ` (${f} couldn't be set up or played)` : ''}:\n` +
      `Upgraded side: ${w} won, ${d} drawn, ${l} lost; score ${(score * 100).toFixed(0)}% ±${(margin * 100).toFixed(0)}, ` +
      `upgrades worth +${points.toFixed(1)} points on average\n` +
      `Took ${((Date.now() - t0) / 1000).toFixed(0)}s with ${WORKERS} engines.`,
  );
}

void main();
