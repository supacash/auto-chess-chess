/**
 * Headless balance simulator: plays whole runs (player vs AI-drafted armies, round after round)
 * with Stockfish playing both sides, and reports W/D/L by round and AI style.
 *
 *   npm run sim -- --rounds 10 --games 50
 *
 * The "player" is a stand-in with an AI style, placed with placeAiArmy. `--player redraft`
 * re-drafts its whole army each round at its current army value (start army + gold + income so far);
 * `--player shop` keeps a persistent Shop and spends gold greedily (shopPlayer.ts).
 * `--daily` plays the daily challenge instead (daily.ts): five battles at rounds 2, 4, 6, 8 and 10, no
 * lives, its starting gold and income (`--daily-gold N`, `--daily-income N` (rounds' income a battle),
 * `--daily-interest N` and `--daily-bonus N` override them, for tuning; SIMULATION.md §26).
 * See SIMULATION.md.
 */
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { runBattle } from '../../src/game/runBattle';
import {
  aiBudget,
  BLACK_DISCOUNT,
  AI_STYLES,
  budgetForSide,
  draftAiArmy,
  pickStyle,
  placeAiArmy,
  placeForBattle,
  synergyAllowance,
} from '../../src/rules/aiArmy';
import { type BoardSpec, plyLimit } from '../../src/chess/boardSpec';
import { gameMode } from '../../src/rules/mode';
import { difficulty, isDifficultyId } from '../../src/rules/difficulty';
import { type BattleLimits, type BattleResult, material } from '../../src/rules/battle';
import { offerPiece, rollOffers, roundIncome, startingShop } from '../../src/rules/economy';
import { type Piece, type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import {
  extraIncome,
  freeRerolls,
  isPerkId,
  offerOdds,
  perkInterest,
  prestigePerRound,
  startGold,
  startPieces,
} from '../../src/rules/prestige';
import {
  DAILY_BATTLE_BONUS,
  DAILY_BATTLES,
  DAILY_INTEREST_TIMES,
  DAILY_ROUND_STEP,
  maxLives,
} from '../../src/rules/run';
import { DAILY_EXTRA_GOLD, dailyRound, dailyScore } from '../../src/rules/daily';
import { randomInt, seededRng } from '../../src/rules/rng';
import { formatMargin, meanMargin } from './stats';
import { loadRulesForNode } from '../../src/chess/testRules';
import { ACC_LIMITS } from '../../src/engine/accSettings';
import { EngineFailure, NodeEngine } from './nodeEngine';
import { armyValue, spendGold } from './shopPlayer';
import { FAMILIES, type FamilyId, familyStatus, upgradePoints } from '../../src/rules/synergy';

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
    difficulty: { type: 'string', default: 'normal' },
    side: { type: 'string', default: 'white' },
    'per-round': { type: 'string' },
    /** Overrides the mode's round-1 discount (points off the AI's first army), for tuning. */
    'round-one-discount': { type: 'string' },
    'black-discount': { type: 'string' },
    perks: { type: 'string', default: '' },
    prestige: { type: 'string', default: '0' },
    save: { type: 'string', default: '0' },
    json: { type: 'boolean', default: false },
    daily: { type: 'boolean', default: false },
    /** Both sides fight with their synergy upgrades (synergy.ts), as in a run with Synergies on. */
    synergies: { type: 'boolean', default: false },
    /** The shop stand-in builds toward one synergy family (shopPlayer.ts). */
    seek: { type: 'string' },
    /** How AI armies are drafted: `build` for synergies (as in a run with them), `chance` as without. */
    'ai-draft': { type: 'string' },
    'daily-gold': { type: 'string' },
    'daily-income': { type: 'string' },
    'daily-interest': { type: 'string' },
    'daily-bonus': { type: 'string' },
  },
});

/** `--daily`: the daily challenge's five battles (rounds 2–10) instead of rounds 1..--rounds. */
const DAILY = opts.daily === true;
/** Gold on top of the run's starting gold, and how many rounds' income each battle pays, in a daily. */
const DAILY_GOLD = opts['daily-gold'] ? Number(opts['daily-gold']) : DAILY_EXTRA_GOLD;
const DAILY_INCOME = opts['daily-income'] ? Number(opts['daily-income']) : DAILY_ROUND_STEP;
/** How many times a daily battle pays interest. */
const DAILY_INTEREST = opts['daily-interest'] ? Number(opts['daily-interest']) : DAILY_INTEREST_TIMES;
/** Flat gold on top of each daily battle's income. */
const DAILY_BONUS = opts['daily-bonus'] ? Number(opts['daily-bonus']) : DAILY_BATTLE_BONUS;
const ROUND_LIST = DAILY
  ? Array.from({ length: DAILY_BATTLES }, (_, i) => dailyRound(i + 1))
  : Array.from({ length: Number(opts.rounds) }, (_, i) => i + 1);
const ROUNDS = ROUND_LIST.length;
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
/** `--difficulty easy|normal|hard`: the AI's points per round, as in the New run window. */
const DIFFICULTY = opts.difficulty!;
if (!isDifficultyId(DIFFICULTY)) throw new Error('--difficulty must be easy, normal or hard');
/** `--prestige N`: the AI's points per round at prestige level N (prestige.ts). */
const PRESTIGE = Number(opts.prestige);
if (!(PRESTIGE >= 0)) throw new Error('--prestige must be a level (0 or more)');
/** `--per-round N` overrides the difficulty's AI points per round (for tuning); prestige adds to it. */
const PER_ROUND = prestigePerRound(
  opts['per-round'] ? Number(opts['per-round']) : difficulty(DIFFICULTY).perRound,
  PRESTIGE,
);
/** `--perks gold,income,...`: the shop player's prestige perks (prestige.ts), applied as in the game. */
const perkArgs = opts.perks ? opts.perks.split(',') : [];
const badPerk = perkArgs.find((p) => !isPerkId(p));
if (badPerk) throw new Error(`--perks: unknown perk ${badPerk}`);
const PERKS = perkArgs.filter(isPerkId);
if (PERKS.length && PLAYER !== 'shop') throw new Error('--perks needs --player shop');
/** `--save N`: the shop player keeps N gold unspent from round 3 on (an interest strategy, e.g. with Banker). */
const SAVE = Number(opts.save);
const LIVES = maxLives(PERKS);
/** `--synergies`: both sides fight with their synergy upgrades. */
const SYNERGIES = opts.synergies === true;
/**
 * `--ai-draft build|chance`: AI armies drafted for synergies or as without them. Defaults to `build`
 * with --synergies (as in the game) and `chance` without; `chance` with --synergies is the §27
 * baseline (the AI gets synergies only by chance), `build` without measures the drafts alone.
 */
const AI_DRAFT = opts['ai-draft'] ?? (SYNERGIES ? 'build' : 'chance');
if (AI_DRAFT !== 'build' && AI_DRAFT !== 'chance') throw new Error('--ai-draft must be build or chance');
/** `--seek <family>`: the shop stand-in builds toward that synergy family. */
const SEEK = opts.seek ? FAMILIES.find((f) => f.id === opts.seek) : undefined;
if (opts.seek && !SEEK) throw new Error(`--seek must be one of: ${FAMILIES.map((f) => f.id).join(', ')}`);
if (SEEK && PLAYER !== 'shop') throw new Error('--seek needs --player shop');
/** `--black-discount F` overrides how much smaller the AI is when the player is Black (0 = none). */
const BLACK = opts['black-discount'] ? Number(opts['black-discount']) : BLACK_DISCOUNT;
/** `--side white|black|random`: who moves first (the player as White moves first, the game's default). */
const SIDE = opts.side!;
if (!['white', 'black', 'random'].includes(SIDE)) throw new Error('--side must be white, black or random');
const playerFirst = (rng: () => number) => (SIDE === 'random' ? rng() < 0.5 : SIDE === 'white');
const BASE_MODE = gameMode(BOARD_MODE === '8' ? 'classic' : 'growing');
const MODE =
  opts['round-one-discount'] === undefined
    ? BASE_MODE
    : { ...BASE_MODE, roundOneDiscount: Number(opts['round-one-discount']) };
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
  /** Gold the shop player left unspent going into the battle. */
  goldUnspent: number;
  /** With --synergies: the points each side's upgrades added, and the families each side had active. */
  synergy?: { player: number; ai: number; playerFamilies: FamilyId[]; aiFamilies: FamilyId[] };
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
  /** Gold unspent after the last battle (the daily challenge scores it). */
  goldLeft: number;
}

/** One run: rounds 1..ROUNDS in order, carrying the player's gold from round to round. */
async function playRun(run: number, engine: NodeEngine, onGame: () => void): Promise<RunRecord> {
  const rng = seededRng(SEED * 100_003 + run);
  const records: GameRecord[] = [];
  const rejected: RejectedRecord[] = [];
  const runStyle = PLAYER_STYLE === 'random' ? pickStyle(rng) : AI_STYLES.find((s) => s.id === PLAYER_STYLE)!;
  const gifts = startPieces(PERKS).map(offerPiece);
  let playerPoints =
    [...MODE.startArmy, ...gifts.map((p) => p.type)].reduce((s, t) => s + PIECE_VALUE[t], 0) +
    startGold(PERKS) +
    MODE.extraGold +
    (DAILY ? DAILY_GOLD : 0);
  let shop = startingShop(MODE.startArmy);
  shop = { gold: startGold(PERKS) + MODE.extraGold + (DAILY ? DAILY_GOLD : 0), pieces: [...shop.pieces, ...gifts] };
  /** Income after a battle, as in the game (run.battleIncome): round income, Tithe, interest. */
  const income = (winner: BattleResult['winner'], gold: number) =>
    (DAILY ? DAILY_INCOME : 1) * roundIncome(winner) +
    (DAILY ? DAILY_BONUS : 0) +
    extraIncome(PERKS) +
    (DAILY ? DAILY_INTEREST : 1) * perkInterest(gold, PERKS);

  for (const round of ROUND_LIST) {
    const spec = boardFor(round);
    const aiStyle = AI_STYLE === 'random' ? pickStyle(rng, AI_FAIRY) : AI_STYLES.find((s) => s.id === AI_STYLE)!;
    const first = playerFirst(rng);
    const aiPoints = AI_BUDGET
      ? Math.max(1, AI_BUDGET[0] + AI_BUDGET[1] * round + randomInt(rng, 3) - 1)
      : budgetForSide(aiBudget(round, rng, PER_ROUND, MODE.roundOneDiscount, MODE.aiBonus), first, BLACK);
    if (PLAYER_POINTS === 'ai') playerPoints = aiPoints;
    let playerTypes: PieceType[];
    if (PLAYER === 'shop') {
      shop = spendGold(
        { ...shop, offers: rollOffers(round, rng, PLAYER_FAIRY, offerOdds(PERKS)) },
        runStyle,
        rng,
        spec,
        PLAYER_FAIRY,
        round,
        {
          odds: offerOdds(PERKS),
          freeRerolls: freeRerolls(PERKS),
          reserve: round >= 3 ? SAVE : 0,
          seek: SEEK,
        },
      );
      playerPoints = armyValue(shop);
      playerTypes = shop.pieces.map((p) => p.type);
    } else {
      playerTypes = draftAiArmy(playerPoints, runStyle, rng, spec, PLAYER_FAIRY);
    }
    // A shop army bigger than the board leaves its cheapest pieces on the bench (placement drops them).
    const player = placeAiArmy(playerTypes, runStyle, rng, spec);
    if (PLAYER === 'shop') {
      // Give the shop's own pieces the placed squares (so they don't count against the bench, and
      // keep their ids and affinities); pieces that didn't fit stay on the bench.
      const unplaced = shop.pieces.map((p) => ({ ...p, square: null as Piece['square'] }));
      for (const placed of player) {
        const match = unplaced.find((p) => p.square === null && p.type === placed.type);
        if (match) match.square = placed.square;
      }
      shop = { ...shop, pieces: unplaced };
    }
    const aiTypes = draftAiArmy(aiPoints, aiStyle, rng, spec, AI_FAIRY, round, AI_DRAFT === 'build');

    // As in the game: the AI re-places (falling back to other layouts) until both kings aren't in check.
    const { ai, start } = placeForBattle(player, aiTypes, aiStyle, rng, spec, first, SYNERGIES);
    const active = (types: PieceType[]) =>
      familyStatus(types)
        .filter((s) => s.tier > 0)
        .map((s) => s.family.id);
    const upgrades = start.synergies?.upgrades ?? [];
    const synergy = SYNERGIES
      ? {
          player: upgradePoints(upgrades.filter((u) => u.side === 'w')),
          ai: upgradePoints(upgrades.filter((u) => u.side === 'b')),
          playerFamilies: active(player.map((p) => p.type)),
          aiFamilies: active(ai.map((p) => p.type)),
        }
      : undefined;

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
      playerPoints += (DAILY ? DAILY_INCOME : 1) * roundIncome('draw');
      shop = { ...shop, gold: shop.gold + income('draw', shop.gold) };
      onGame();
      continue;
    }
    onGame();

    records.push({
      round,
      aiStyle: aiStyle.name,
      playerStyle: runStyle.name,
      playerPoints: player.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0),
      // An AI drafted for synergies gets their allowance on top (draftAiArmy).
      aiPoints: aiPoints + (AI_DRAFT === 'build' && AI_FAIRY ? synergyAllowance(round) : 0),
      result,
      peakLead,
      peakLeader,
      goldUnspent: shop.gold,
      ...(synergy ? { synergy } : {}),
    });
    playerPoints += (DAILY ? DAILY_INCOME : 1) * roundIncome(result.winner);
    // As in the game: income plus interest on the gold saved (see run.battleIncome).
    shop = { ...shop, gold: shop.gold + income(result.winner, shop.gold) };
  }
  return { games: records, rejected, goldLeft: shop.gold };
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

  // Run score as the game would count it: rounds won before the last life is lost.
  const runScores = (startLives: number) =>
    runs.map((rs) => {
      let lives = startLives;
      let score = 0;
      for (const g of rs) {
        if (g.result.winner === 'w') score++;
        else if (g.result.winner === 'b' && --lives === 0) break;
      }
      return { score, survived: lives > 0 };
    });
  const scores = runScores(LIVES);
  const avgScore = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const scoreMargin = meanMargin(scores.map((x) => x.score));
  // The same battles with one more life (what Second wind would add).
  const moreLife = runScores(LIVES + 1);
  const avgMoreLife = moreLife.reduce((s, x) => s + x.score, 0) / moreLife.length;

  // With --synergies: how often each side's synergies did something, and what they were worth.
  const synergyLines: string[] = [];
  if (SYNERGIES) {
    const rows = [...byRound.keys()]
      .sort((a, b) => a - b)
      .map((r) => {
        const gs = games.filter((g) => g.round === r && g.synergy);
        const share = (f: (g: GameRecord) => number) => pct(gs.filter((g) => f(g) > 0).length, gs.length);
        const avg = (f: (g: GameRecord) => number) => (gs.reduce((s, g) => s + f(g), 0) / (gs.length || 1)).toFixed(1);
        return `round ${String(r).padEnd(2)}  you ${share((g) => g.synergy!.player).padStart(4)} +${avg((g) => g.synergy!.player).padStart(4)}   AI ${share((g) => g.synergy!.ai).padStart(4)} +${avg((g) => g.synergy!.ai).padStart(4)}`;
      });
    const withSyn = games.filter((g) => g.synergy);
    const families = (side: 'playerFamilies' | 'aiFamilies') =>
      FAMILIES.map(
        (f) => `${f.name} ${pct(withSyn.filter((g) => g.synergy![side].includes(f.id)).length, withSyn.length)}`,
      ).join(', ');
    synergyLines.push(
      '\nSynergies (battles where a side got upgrades, and the average points they added):',
      ...rows,
      `Families active, you: ${families('playerFamilies')}`,
      `Families active, AI: ${families('aiFamilies')}`,
    );
  }

  const unspent = [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const gs = games.filter((g) => g.round === r);
      return `r${r} ${(gs.reduce((s, g) => s + g.goldUnspent, 0) / gs.length).toFixed(1)}`;
    });
  const out = [
    `Pawned Up sim — ${RUNS} runs × ${ROUNDS} rounds, seed ${SEED}, ${DEPTH ? `Fairy-Stockfish depth ${DEPTH}` : `our engine ${ACC_LIMITS.depth}/${ACC_LIMITS.nodes}`}, ` +
      `${DAILY ? 'DAILY (rounds 2–10), ' : ''}mode ${MODE.name}, ply limit ${PLY_OVERRIDE ?? '10 × size + 10'}${DECISIVE ? `, decisive lead ${DECISIVE[0]} for ${DECISIVE[1]} plies` : ''}, player ${PLAYER}, player style ${PLAYER_STYLE}, player points ${PLAYER_POINTS}, ` +
      `AI budget ${AI_BUDGET ? `${AI_BUDGET[0]} + ${AI_BUDGET[1]}×round ±1` : `${PER_ROUND}×round × ramp${MODE.aiBonus ? ` + ${MODE.aiBonus}` : ''} ±1 (round 1: −${MODE.roundOneDiscount})`}` +
      `${PRESTIGE ? `, prestige ${PRESTIGE}` : ''}${PERKS.length ? `, perks ${PERKS.join(',')}` : ''}${SAVE ? `, saves ${SAVE} gold from round 3` : ''}` +
      `${SYNERGIES ? ', SYNERGIES' : ''}${AI_DRAFT !== (SYNERGIES ? 'build' : 'chance') ? `, AI drafts ${AI_DRAFT === 'build' ? 'for synergies' : 'as without synergies'}` : ''}` +
      `${SEEK ? `, stand-in seeks ${SEEK.name}` : ''}`,
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
    ...synergyLines,
    `\nGold unspent going into battle: ${unspent.join(', ')}`,
    `End reasons: ${[...reasons.entries()].map(([r, n]) => `${r} ${pct(n, games.length)}`).join(', ')}`,
    `Run score (wins before ${LIVES} losses): avg ${avgScore.toFixed(2)} ±${scoreMargin.toFixed(2)}, ` +
      `${pct(scores.filter((s) => s.survived).length, scores.length)} of runs still alive after round ${ROUNDS}` +
      `\nWith one more life: avg ${avgMoreLife.toFixed(2)}, ` +
      `${pct(moreLife.filter((s) => s.survived).length, moreLife.length)} alive after round ${ROUNDS}`,
  ];
  if (DAILY) {
    // The daily challenge: every battle is played; scored 100 a win, 50 a draw, plus gold left.
    const wins = records.map((r) => r.games.filter((g) => g.result.winner === 'w').length);
    const daily = records.map((r) => {
      const w = r.games.filter((g) => g.result.winner === 'w').length;
      const d = r.games.filter((g) => g.result.winner === 'draw').length;
      return dailyScore({ w, d }, r.goldLeft);
    });
    const dist = Array.from({ length: DAILY_BATTLES + 1 }, (_, n) =>
      pct(wins.filter((w) => w === n).length, wins.length),
    );
    out.push(
      `
Daily (start gold +${DAILY_GOLD}, ${DAILY_INCOME}× income, ${DAILY_INTEREST}× interest, +${DAILY_BONUS} a battle): wins per gauntlet avg ` +
        `${(wins.reduce((a, b) => a + b, 0) / wins.length).toFixed(2)} ±${meanMargin(wins).toFixed(2)}, ` +
        `cleared ${pct(wins.filter((w) => w === DAILY_BATTLES).length, wins.length)}; ` +
        `0–5 wins: ${dist.join(' / ')}; score avg ${(daily.reduce((a, b) => a + b, 0) / daily.length).toFixed(0)}, ` +
        `gold left avg ${(records.reduce((a, r) => a + r.goldLeft, 0) / records.length).toFixed(1)}`,
    );
  }
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
  const engines = await Promise.all(
    Array.from({ length: WORKERS }, () =>
      // --depth N: Fairy-Stockfish at that depth (the engine the balance work before phase 5 used).
      DEPTH ? NodeEngine.create(DEPTH) : NodeEngine.createAcc(ACC_LIMITS),
    ),
  );
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
