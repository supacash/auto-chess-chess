/**
 * Headless balance simulator: plays whole runs (player vs AI-drafted armies, round after round)
 * with Stockfish playing both sides, and reports W/D/L by round and AI style.
 *
 *   npm run sim -- --rounds 10 --games 50
 *
 * The "player" is a stand-in with an AI style, placed with placeAiArmy. `--player redraft`
 * re-drafts its whole army each round at its current army value (start army + gold + income so far);
 * `--player shop` keeps a persistent Shop and spends gold greedily (shopPlayer.ts).
 * See SIMULATION.md.
 */
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { runBattle, SEARCH_DEPTH } from '../../src/game/runBattle';
import { aiBudget, AI_STYLES, draftAiArmy, pickStyle, placeAiArmy } from '../../src/rules/aiArmy';
import { type BoardSpec, plyLimit } from '../../src/chess/boardSpec';
import { gameMode } from '../../src/rules/mode';
import { type BattleLimits, type BattleResult, material } from '../../src/rules/battle';
import { roundIncome, START_GOLD, startingShop } from '../../src/rules/economy';
import { type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import { startPosition } from '../../src/rules/position';
import { randomInt, seededRng } from '../../src/rules/rng';
import { formatMargin, meanMargin } from './stats';
import { loadRulesForNode } from '../../src/chess/testRules';
import { EngineFailure, NodeEngine } from './nodeEngine';
import { armyValue, spendGold } from './shopPlayer';

const LIVES = 3;
/** Placement retries when both kings start in check (the game re-places the AI army). */
const MAX_REPLACE = 20;

const { values: opts } = parseArgs({
  options: {
    rounds: { type: 'string', default: '10' },
    games: { type: 'string', default: '20' },
    seed: { type: 'string', default: '1' },
    depth: { type: 'string' },
    workers: { type: 'string' },
    player: { type: 'string', default: 'redraft' },
    'player-style': { type: 'string', default: 'random' },
    'ai-style': { type: 'string', default: 'random' },
    lead: { type: 'string', default: '5' },
    'player-points': { type: 'string', default: 'economy' },
    'ai-budget': { type: 'string' },
    plies: { type: 'string' },
    board: { type: 'string', default: 'schedule' },
    decisive: { type: 'string' },
    fairy: { type: 'string', default: 'none' },
    json: { type: 'boolean', default: false },
  },
});

const ROUNDS = Number(opts.rounds);
const RUNS = Number(opts.games);
const SEED = Number(opts.seed);
const DEPTH = opts.depth ? Number(opts.depth) : undefined;
const WORKERS = Math.min(RUNS, opts.workers ? Number(opts.workers) : Math.max(1, availableParallelism() - 2));
const LEAD = Number(opts.lead);
const PLAYER_STYLE = opts['player-style']!;
/** `--ai-style <id>` makes every AI opponent use one style (to measure it on its own). */
const AI_STYLE = opts['ai-style']!;
if (AI_STYLE !== 'random' && !AI_STYLES.some((s) => s.id === AI_STYLE)) {
  throw new Error(`--ai-style must be random or one of: ${AI_STYLES.map((s) => s.id).join(', ')}`);
}
/** economy = start army + gold + income so far; ai = same budget as this round's AI (isolates engine/style balance). */
const PLAYER_POINTS = opts['player-points']!;
/** `--ai-budget base,perRound` replaces aiBudget's 6×round (the ±1 noise is kept). */
const AI_BUDGET = opts['ai-budget']?.split(',').map(Number);
if (AI_BUDGET && (AI_BUDGET.length !== 2 || AI_BUDGET.some(Number.isNaN))) {
  throw new Error('--ai-budget must be base,perRound (e.g. 0,6)');
}
/** redraft = re-draft the whole army each round at full value; shop = persistent Shop, greedy spending. */
const PLAYER = opts.player!;
if (PLAYER !== 'redraft' && PLAYER !== 'shop') throw new Error('--player must be redraft or shop');
if (PLAYER === 'shop' && PLAYER_POINTS !== 'economy') throw new Error('--player shop needs --player-points economy');
/** `--plies N` replaces the 60-ply limit; `--decisive lead,plies` ends a battle once a side holds that lead that long. */
const DECISIVE = opts.decisive?.split(',').map(Number);
if (DECISIVE && (DECISIVE.length !== 2 || DECISIVE.some(Number.isNaN))) {
  throw new Error('--decisive must be lead,plies (e.g. 10,6)');
}
/** `--board schedule` (default) plays the Growing mode (5×5 → 8×8); `--board 8` plays Classic (8×8 throughout). */
const BOARD_MODE = opts.board!;
if (BOARD_MODE !== 'schedule' && BOARD_MODE !== '8') throw new Error('--board must be schedule or 8');
/** `--fairy ai` lets AI armies draft fairy pieces; `both` also the redraft player. The shop player stays standard. */
const FAIRY = opts.fairy!;
if (!['none', 'ai', 'both'].includes(FAIRY)) throw new Error('--fairy must be none, ai or both');
const AI_FAIRY = FAIRY !== 'none';
const PLAYER_FAIRY = FAIRY === 'both';
const MODE = gameMode(BOARD_MODE === '8' ? 'classic' : 'growing');
const boardFor = (round: number): BoardSpec => MODE.board(round);
/** `--plies N` replaces the board's move limit (10 × size + 10). */
const PLY_OVERRIDE = opts.plies ? Number(opts.plies) : null;
if (PLY_OVERRIDE !== null && !(PLY_OVERRIDE > 0)) throw new Error('--plies must be a positive number');
const limitsFor = (spec: BoardSpec): BattleLimits => ({
  plyLimit: PLY_OVERRIDE ?? plyLimit(spec),
  decisive: DECISIVE && { lead: DECISIVE[0], plies: DECISIVE[1] },
});
if (PLAYER_POINTS !== 'economy' && PLAYER_POINTS !== 'ai') throw new Error('--player-points must be economy or ai');
if (PLAYER_STYLE !== 'random' && !AI_STYLES.some((s) => s.id === PLAYER_STYLE)) {
  throw new Error(`--player-style must be random or one of: ${AI_STYLES.map((s) => s.id).join(', ')}`);
}

interface GameRecord {
  round: number;
  aiStyle: string;
  playerStyle: string;
  /** Value of the player's pieces on the board (benched pieces that didn't fit are left out). */
  playerPoints: number;
  aiPoints: number;
  result: BattleResult;
  /** Largest material lead either side held at any point, and who held it ('w' = player). */
  peakLead: number;
  peakLeader: 'w' | 'b' | null;
}

/** A battle Stockfish could not play out (see EngineFailure); it is left out of W/D/L. */
interface RejectedRecord {
  kind: 'rejected' | 'hung';
  round: number;
  plies: number;
  fen: string;
  /** For `rejected`: whose army Stockfish objected to. */
  side: 'player' | 'AI' | null;
}

interface RunRecord {
  games: GameRecord[];
  rejected: RejectedRecord[];
}

/** One run: rounds 1..ROUNDS in order, carrying the player's gold from round to round. */
async function playRun(run: number, engine: NodeEngine, onGame: () => void): Promise<RunRecord> {
  const rng = seededRng(SEED * 100_003 + run);
  const records: GameRecord[] = [];
  const rejected: RejectedRecord[] = [];
  const runStyle = PLAYER_STYLE === 'random' ? pickStyle(rng) : AI_STYLES.find((s) => s.id === PLAYER_STYLE)!;
  let playerPoints = MODE.startArmy.reduce((s, t) => s + PIECE_VALUE[t], 0) + START_GOLD;
  let shop = startingShop(MODE.startArmy);

  for (let round = 1; round <= ROUNDS; round++) {
    const spec = boardFor(round);
    const aiStyle = AI_STYLE === 'random' ? pickStyle(rng, AI_FAIRY) : AI_STYLES.find((s) => s.id === AI_STYLE)!;
    const aiPoints = AI_BUDGET
      ? Math.max(1, AI_BUDGET[0] + AI_BUDGET[1] * round + randomInt(rng, 3) - 1)
      : aiBudget(round, rng, 6, MODE.roundOneDiscount, MODE.aiBonus);
    if (PLAYER_POINTS === 'ai') playerPoints = aiPoints;
    let playerTypes: PieceType[];
    if (PLAYER === 'shop') {
      shop = spendGold(shop, runStyle, rng, spec);
      playerPoints = armyValue(shop);
      playerTypes = shop.pieces.map((p) => p.type);
    } else {
      playerTypes = draftAiArmy(playerPoints, runStyle, rng, spec, PLAYER_FAIRY);
    }
    // A shop army bigger than the board leaves its cheapest pieces on the bench (placement drops them).
    let player = placeAiArmy(playerTypes, runStyle, rng, spec);
    const aiTypes = draftAiArmy(aiPoints, aiStyle, rng, spec, AI_FAIRY);

    let start = startPosition(player, placeAiArmy(aiTypes, aiStyle, rng, spec), rng() < 0.5, spec);
    for (let i = 0; !start.ok && i < MAX_REPLACE; i++) {
      // Big armies can make every AI placement fail against one player placement; re-place both then.
      if (i >= MAX_REPLACE / 2) player = placeAiArmy(playerTypes, runStyle, rng, spec);
      start = startPosition(player, placeAiArmy(aiTypes, aiStyle, rng, spec), rng() < 0.5, spec);
    }
    if (!start.ok) throw new Error(`run ${run} round ${round}: could not place armies`);

    let peakLead = 0;
    let peakLeader: 'w' | 'b' | null = null;
    let plies = 0;
    let result: BattleResult;
    try {
      result = await runBattle(
        start.fen,
        engine,
        rng,
        async (_move, game, ply) => {
          plies = ply;
          const m = material(game.fen());
          const lead = Math.abs(m.w - m.b);
          if (lead > peakLead) {
            peakLead = lead;
            peakLeader = m.w > m.b ? 'w' : 'b';
          }
        },
        limitsFor(spec),
        spec,
      );
    } catch (e) {
      if (!(e instanceof EngineFailure)) throw e;
      const side = e.kind === 'hung' ? null : /WHITE/.test(e.detail) ? 'player' : 'AI';
      rejected.push({ kind: e.kind, round, plies, fen: e.fen, side });
      playerPoints += roundIncome('draw');
      shop = { ...shop, gold: shop.gold + roundIncome('draw') };
      onGame();
      continue;
    }
    onGame();

    records.push({
      round,
      aiStyle: aiStyle.name,
      playerStyle: runStyle.name,
      playerPoints: player.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0),
      aiPoints,
      result,
      peakLead,
      peakLeader,
    });
    playerPoints += roundIncome(result.winner);
    shop = { ...shop, gold: shop.gold + roundIncome(result.winner) };
  }
  return { games: records, rejected };
}

// ---------- aggregation ----------

interface Bucket {
  n: number;
  w: number;
  d: number;
  l: number;
  plies: number;
  limit: number;
  mate: number;
  playerPts: number;
  aiPts: number;
  /** Games where some side led by ≥ LEAD at some point… */
  bigLead: number;
  /** …and that side did not win by checkmate. */
  bigLeadNoMate: number;
  /** …and that side did not win at all (draw or loss). */
  bigLeadNoWin: number;
}

const emptyBucket = (): Bucket => ({
  n: 0,
  w: 0,
  d: 0,
  l: 0,
  plies: 0,
  limit: 0,
  mate: 0,
  playerPts: 0,
  aiPts: 0,
  bigLead: 0,
  bigLeadNoMate: 0,
  bigLeadNoWin: 0,
});

function add(b: Bucket, g: GameRecord): void {
  const r = g.result;
  b.n++;
  if (r.winner === 'w') b.w++;
  else if (r.winner === 'b') b.l++;
  else b.d++;
  b.plies += r.plies;
  if (r.reason === 'move-limit') b.limit++;
  if (r.reason === 'checkmate') b.mate++;
  b.playerPts += g.playerPoints;
  b.aiPts += g.aiPoints;
  if (g.peakLead >= LEAD && g.peakLeader) {
    b.bigLead++;
    if (!(r.winner === g.peakLeader && r.reason === 'checkmate')) b.bigLeadNoMate++;
    if (r.winner !== g.peakLeader) b.bigLeadNoWin++;
  }
}

const pct = (x: number, n: number) => (n ? `${Math.round((100 * x) / n)}%` : '-');

function table(title: string, rows: [string, Bucket][]): string {
  const head = [
    '',
    'games',
    'pts P/AI',
    'win',
    '±win',
    'draw',
    'loss',
    'avg ply',
    'limit',
    'mate',
    `lead≥${LEAD}`,
    'no mate',
    'no win',
  ];
  const body = rows.map(([label, b]) => [
    label,
    String(b.n),
    b.n ? `${(b.playerPts / b.n).toFixed(1)}/${(b.aiPts / b.n).toFixed(1)}` : '-',
    pct(b.w, b.n),
    formatMargin(b.w, b.n),
    pct(b.d, b.n),
    pct(b.l, b.n),
    b.n ? (b.plies / b.n).toFixed(1) : '-',
    pct(b.limit, b.n),
    pct(b.mate, b.n),
    pct(b.bigLead, b.n),
    pct(b.bigLeadNoMate, b.bigLead),
    pct(b.bigLeadNoWin, b.bigLead),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [`\n${title}`, fmt(head), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(fmt)].join('\n');
}

function report(records: RunRecord[]): string {
  const runs = records.map((r) => r.games);
  const games = runs.flat();
  const rejected = records.flatMap((r) => r.rejected);
  const total = emptyBucket();
  const byRound = new Map<number, Bucket>();
  const byStyle = new Map<string, Bucket>(AI_STYLES.map((s) => [s.name, emptyBucket()]));
  const byPlayerStyle = new Map<string, Bucket>();
  const reasons = new Map<string, number>();
  for (const g of games) {
    add(total, g);
    if (!byRound.has(g.round)) byRound.set(g.round, emptyBucket());
    add(byRound.get(g.round)!, g);
    add(byStyle.get(g.aiStyle)!, g);
    if (!byPlayerStyle.has(g.playerStyle)) byPlayerStyle.set(g.playerStyle, emptyBucket());
    add(byPlayerStyle.get(g.playerStyle)!, g);
    reasons.set(g.result.reason, (reasons.get(g.result.reason) ?? 0) + 1);
  }

  // Run score as the game would count it: rounds won before the LIVES-th loss.
  const scores = runs.map((rs) => {
    let lives = LIVES;
    let score = 0;
    for (const g of rs) {
      if (g.result.winner === 'w') score++;
      else if (g.result.winner === 'b' && --lives === 0) break;
    }
    return { score, survived: lives > 0 };
  });
  const avgScore = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const scoreMargin = meanMargin(scores.map((x) => x.score));

  const out = [
    `Auto Chess Chess sim — ${RUNS} runs × ${ROUNDS} rounds, seed ${SEED}, depth ${DEPTH ?? SEARCH_DEPTH}, ` +
      `mode ${MODE.name}, ply limit ${PLY_OVERRIDE ?? '10 × size + 10'}${DECISIVE ? `, decisive lead ${DECISIVE[0]} for ${DECISIVE[1]} plies` : ''}, player ${PLAYER}, player style ${PLAYER_STYLE}, player points ${PLAYER_POINTS}, ` +
      `AI budget ${AI_BUDGET ? `${AI_BUDGET[0]} + ${AI_BUDGET[1]}×round ±1` : `6×round${MODE.aiBonus ? ` + ${MODE.aiBonus}` : ''} ±1 (round 1: −${MODE.roundOneDiscount})`}`,
    'W/D/L are from the player\'s side. "lead≥N" = games where a side was ever ≥N points of material ahead;',
    '"no mate"/"no win" = share of those where that side failed to checkmate / failed to win at all.',
    '"±win" = 95% margin of error on the win rate, in points. Treat gaps smaller than the margins as noise.',
    table(
      'By round',
      [...byRound.entries()].sort(([a], [b]) => a - b).map(([r, b]) => [`round ${r}`, b]),
    ),
    table('By AI style', [...byStyle.entries()]),
    table('By player stand-in style', [...byPlayerStyle.entries()]),
    table('Total', [['all', total]]),
    `\nEnd reasons: ${[...reasons.entries()].map(([r, n]) => `${r} ${pct(n, games.length)}`).join(', ')}`,
    `Run score (wins before ${LIVES} losses): avg ${avgScore.toFixed(2)} ±${scoreMargin.toFixed(2)}, ` +
      `${pct(scores.filter((s) => s.survived).length, scores.length)} of runs still alive after round ${ROUNDS}`,
  ];
  const all = games.length + rejected.length;
  const refused = rejected.filter((r) => r.kind === 'rejected');
  const hung = rejected.filter((r) => r.kind === 'hung');
  if (refused.length) {
    const atStart = refused.filter((r) => r.plies === 0).length;
    const byAi = refused.filter((r) => r.side === 'AI').length;
    out.push(
      `\nStockfish REJECTED ${refused.length} of ${all} battles as unsupported positions ` +
        `(${atStart} at the starting position, the rest after a promotion; ${byAi} for the AI's army, ` +
        `${refused.length - byAi} for the player's). Examples:`,
      ...refused.slice(0, 3).map((r) => `  round ${r.round}, ply ${r.plies}: ${r.fen}`),
    );
  }
  if (hung.length) {
    out.push(
      `\nStockfish HUNG (no bestmove, even after a restart) in ${hung.length} of ${all} battles. Examples:`,
      ...hung.slice(0, 3).map((r) => `  round ${r.round}, ply ${r.plies}: ${r.fen}`),
    );
  }
  if (rejected.length) out.push('These battles are left out of the tables above and count as draws for income.');
  return out.join('\n');
}

// ---------- main ----------

async function main(): Promise<void> {
  const t0 = Date.now();
  await loadRulesForNode();
  const engines = await Promise.all(Array.from({ length: WORKERS }, () => NodeEngine.create(DEPTH)));
  const results: RunRecord[] = new Array(RUNS);
  let next = 0;
  let done = 0;
  let games = 0;
  const progress = () => {
    if (opts.json) return;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    process.stderr.write(`\r${done}/${RUNS} runs, ${games}/${RUNS * ROUNDS} games (${secs}s)  `);
  };
  await Promise.all(
    engines.map(async (engine) => {
      while (next < RUNS) {
        const run = next++;
        results[run] = await playRun(run, engine, () => {
          games++;
          progress();
        });
        done++;
        progress();
      }
    }),
  );
  for (const e of engines) e.terminate();
  if (!opts.json) process.stderr.write('\n');

  if (opts.json) console.log(JSON.stringify(results, null, 1));
  else
    console.log(
      report(results) +
        `\n\nTook ${((Date.now() - t0) / 1000).toFixed(0)}s with ${WORKERS} engines ` +
        `(${engines.reduce((s, e) => s + e.restarts, 0)} stalled searches restarted).`,
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
