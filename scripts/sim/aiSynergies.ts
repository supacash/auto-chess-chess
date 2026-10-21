/**
 * AI synergies: what synergies give AI armies, round by round, without playing any battles. Drafts
 * and places `--armies` AI armies a round (random fairy styles, the AI's Normal budget as in a run
 * where the player moves first) with the drafter building for synergies (`draftAiArmy(…, synergies)`,
 * its allowance included) and without (it only gets them by chance), and reports the upgrade points a
 * battle, how often a family is active, and the points left unspent.
 *
 *   npm run sim:ai-synergies -- --board schedule --armies 2000
 *
 * See SIMULATION.md §28.
 */
import { parseArgs } from 'node:util';
import {
  AI_STYLES,
  aiBudget,
  draftAiArmy,
  maxArmyValue,
  pickStyle,
  placeAiArmy,
  synergyAllowance,
} from '../../src/rules/aiArmy';
import { difficulty } from '../../src/rules/difficulty';
import { gameMode } from '../../src/rules/mode';
import { armyPoints } from '../../src/rules/pieces';
import { seededRng } from '../../src/rules/rng';
import { FAMILIES, familyStatus, synergyUpgrades, upgradePoints } from '../../src/rules/synergy';

const { values: opts } = parseArgs({
  options: {
    board: { type: 'string', default: 'schedule' },
    armies: { type: 'string', default: '2000' },
    rounds: { type: 'string', default: '1,2,3,5,7,9,11,13,15,20,25' },
    seed: { type: 'string', default: '1' },
    'by-style': { type: 'boolean', default: false },
  },
});
const MODE = gameMode(opts.board === '8' ? 'classic' : 'growing');
const ARMIES = Number(opts.armies);
const ROUNDS = opts.rounds!.split(',').map(Number);
const PER_ROUND = difficulty('normal').perRound;

interface Tally {
  n: number;
  upgrade: number;
  unspent: number;
  active: Map<string, number>;
}
const tally = (): Tally => ({ n: 0, upgrade: 0, unspent: 0, active: new Map() });

function measure(round: number, synergies: boolean, seed: number): Map<string, Tally> {
  const rng = seededRng(seed * 100_003 + round);
  const spec = MODE.board(round);
  const out = new Map<string, Tally>([['all', tally()], ...AI_STYLES.map((s) => [s.id, tally()] as const)]);
  for (let i = 0; i < ARMIES; i++) {
    const style = pickStyle(rng, true);
    const budget = aiBudget(round, rng, PER_ROUND, MODE.roundOneDiscount, MODE.aiBonus);
    const types = draftAiArmy(budget, style, rng, spec, true, round, synergies);
    const placed = placeAiArmy(types, style, rng, spec);
    const points = upgradePoints(synergyUpgrades(placed, spec));
    // What the drafter could spend (with the synergy allowance, a full board of queens at most), less
    // what the placed army is worth.
    const spendable = Math.min(budget + (synergies ? synergyAllowance(round) : 0), maxArmyValue(spec));
    const unspent = spendable - armyPoints(placed.map((p) => p.type));
    const active = familyStatus(placed.map((p) => p.type)).filter((s) => s.tier > 0);
    for (const t of [out.get('all')!, out.get(style.id)!]) {
      t.n++;
      t.upgrade += points;
      t.unspent += unspent;
      for (const s of active) t.active.set(s.family.id, (t.active.get(s.family.id) ?? 0) + 1);
    }
  }
  return out;
}

const seed = Number(opts.seed);
const pct = (x: number, n: number) => `${Math.round((100 * x) / (n || 1))}%`;
console.log(`AI synergies, ${MODE.name}, Normal, fairy, ${ARMIES} armies a round, seed ${seed}`);
console.log('round  upgrade pts (by chance → building)  unspent (→)  active families when building');
for (const round of ROUNDS) {
  const before = measure(round, false, seed).get('all')!;
  const after = measure(round, true, seed);
  const all = after.get('all')!;
  const fams = FAMILIES.map((f) => `${f.name} ${pct(all.active.get(f.id) ?? 0, all.n)}`).join(', ');
  console.log(
    `${String(round).padStart(5)}  ${`+${(before.upgrade / before.n).toFixed(1)} → +${(all.upgrade / all.n).toFixed(1)}`.padEnd(33)}` +
      `  ${`${(before.unspent / before.n).toFixed(1)} → ${(all.unspent / all.n).toFixed(1)}`.padEnd(11)}  ${fams}`,
  );
  if (opts['by-style']) {
    for (const s of AI_STYLES) {
      const t = after.get(s.id)!;
      console.log(
        `         ${s.name.padEnd(16)} +${(t.upgrade / t.n).toFixed(1)}, unspent ${(t.unspent / t.n).toFixed(1)}`,
      );
    }
  }
}
