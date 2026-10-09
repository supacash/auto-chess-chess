import type { DifficultyId } from '../rules/difficulty';
import type { ModeId } from '../rules/mode';
import { isPieceType, type PieceType } from '../rules/pieces';

// Personal records, kept on this device (a future sign-in can sync them). Pure functions over a
// plain Records object; storage.ts loads and saves it.

export const RECORDS_VERSION = 1;
/** How many recent runs and matches the history keeps. */
export const HISTORY_SIZE = 20;

/** Single-player stats for one board mode and difficulty. */
export interface RunStats {
  runs: number;
  best: number;
  /** Sum of finished runs' scores, for the average. */
  totalScore: number;
  rounds: { w: number; l: number; d: number };
}

/** Multiplayer stats for one kind of match (online or vs bots, normal or Blitz). */
export interface MatchStats {
  matches: number;
  /** How many times the player finished 1st, 2nd, 3rd and 4th. */
  places: [number, number, number, number];
}

export interface HistoryEntry {
  /** When it ended (ms since epoch). */
  at: number;
  kind: 'run' | 'match';
  /** Which mode, e.g. "Growing · Normal" or "Online · Blitz". */
  mode: string;
  /** Rounds won (runs) or final place (matches). */
  result: number;
}

export interface FunStats {
  /** Pieces gained from the shop (offers bought, upgrades and fusions), by type. */
  bought: Partial<Record<PieceType, number>>;
  /** Battles won in a row, now and at best (single player and multiplayer together). */
  winStreak: number;
  bestWinStreak: number;
  /** Battles the player won by checkmate. */
  checkmates: number;
  /** The biggest material deficit (points) the player came back from to win a battle. */
  biggestComeback: number;
}

export interface Records {
  version: typeof RECORDS_VERSION;
  /** Keyed by runKey(mode, difficulty). */
  runs: Record<string, RunStats>;
  /** Keyed by matchKey(online, blitz). */
  matches: Record<string, MatchStats>;
  /** Most recent first. */
  history: HistoryEntry[];
  fun: FunStats;
}

export function emptyRecords(): Records {
  return {
    version: RECORDS_VERSION,
    runs: {},
    matches: {},
    history: [],
    fun: { bought: {}, winStreak: 0, bestWinStreak: 0, checkmates: 0, biggestComeback: 0 },
  };
}

export function runKey(mode: ModeId, difficulty: DifficultyId): string {
  return `${mode}.${difficulty}`;
}

export function matchKey(online: boolean, blitz: boolean): string {
  return `${online ? 'online' : 'bots'}.${blitz ? 'blitz' : 'normal'}`;
}

const emptyRun = (): RunStats => ({ runs: 0, best: 0, totalScore: 0, rounds: { w: 0, l: 0, d: 0 } });
const emptyMatch = (): MatchStats => ({ matches: 0, places: [0, 0, 0, 0] });

/** A battle the player fought, from their side: who won, how it ended, and how far behind they ever were. */
export interface BattleSummary {
  outcome: 'w' | 'l' | 'd';
  checkmate: boolean;
  /** The largest material deficit (points) the player faced during the battle (0 if never behind). */
  worstDeficit: number;
}

/** Records a battle: fun stats always; per-mode round counts when it was a single-player run's battle. */
export function recordBattle(records: Records, battle: BattleSummary, run?: string): Records {
  const won = battle.outcome === 'w';
  const winStreak = won ? records.fun.winStreak + 1 : battle.outcome === 'l' ? 0 : records.fun.winStreak;
  const fun: FunStats = {
    ...records.fun,
    winStreak,
    bestWinStreak: Math.max(records.fun.bestWinStreak, winStreak),
    checkmates: records.fun.checkmates + (won && battle.checkmate ? 1 : 0),
    biggestComeback: won ? Math.max(records.fun.biggestComeback, battle.worstDeficit) : records.fun.biggestComeback,
  };
  if (!run) return { ...records, fun };
  const stats = records.runs[run] ?? emptyRun();
  const rounds = { ...stats.rounds, [battle.outcome]: stats.rounds[battle.outcome] + 1 };
  return { ...records, fun, runs: { ...records.runs, [run]: { ...stats, rounds } } };
}

/** Records a finished single-player run and its score (rounds won). */
export function recordRunEnd(records: Records, run: string, label: string, score: number, at: number): Records {
  const stats = records.runs[run] ?? emptyRun();
  return {
    ...records,
    runs: {
      ...records.runs,
      [run]: {
        ...stats,
        runs: stats.runs + 1,
        best: Math.max(stats.best, score),
        totalScore: stats.totalScore + score,
      },
    },
    history: addHistory(records.history, { at, kind: 'run', mode: label, result: score }),
  };
}

/** Records a finished match and the player's place (1–4). */
export function recordMatchEnd(records: Records, match: string, label: string, place: number, at: number): Records {
  const stats = records.matches[match] ?? emptyMatch();
  const places = [...stats.places] as MatchStats['places'];
  places[Math.min(Math.max(place, 1), 4) - 1]++;
  return {
    ...records,
    matches: { ...records.matches, [match]: { matches: stats.matches + 1, places } },
    history: addHistory(records.history, { at, kind: 'match', mode: label, result: place }),
  };
}

/** Records a piece gained in the shop (bought, upgraded into, or fused). */
export function recordBought(records: Records, type: PieceType): Records {
  const bought = { ...records.fun.bought, [type]: (records.fun.bought[type] ?? 0) + 1 };
  return { ...records, fun: { ...records.fun, bought } };
}

/** Best scores saved before records existed: the best counts, runs stay unknown (0). */
export function importBest(records: Records, run: string, best: number): Records {
  const stats = records.runs[run] ?? emptyRun();
  if (best <= stats.best) return records;
  return { ...records, runs: { ...records.runs, [run]: { ...stats, best } } };
}

function addHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history].slice(0, HISTORY_SIZE);
}

// ---- reading back ----

export function averageScore(stats: RunStats): number | null {
  return stats.runs > 0 ? stats.totalScore / stats.runs : null;
}

export function averagePlace(stats: MatchStats): number | null {
  if (stats.matches === 0) return null;
  return stats.places.reduce((sum, n, i) => sum + n * (i + 1), 0) / stats.matches;
}

/** The piece the player has gained most often from the shop, or null. */
export function favouritePiece(fun: FunStats): { type: PieceType; count: number } | null {
  let top: { type: PieceType; count: number } | null = null;
  for (const [type, count] of Object.entries(fun.bought)) {
    if (isPieceType(type) && count && (!top || count > top.count)) top = { type, count };
  }
  return top;
}

/** Saved records, tolerating anything missing or malformed (it falls back to empty). */
export function parseRecords(data: unknown): Records {
  const out = emptyRecords();
  if (!isObject(data) || data.version !== RECORDS_VERSION) return out;
  if (isObject(data.runs)) {
    for (const [key, s] of Object.entries(data.runs)) {
      if (!isObject(s) || !isObject(s.rounds)) continue;
      const r = s.rounds;
      if ([s.runs, s.best, s.totalScore, r.w, r.l, r.d].every(isCount)) {
        out.runs[key] = {
          runs: s.runs as number,
          best: s.best as number,
          totalScore: s.totalScore as number,
          rounds: { w: r.w as number, l: r.l as number, d: r.d as number },
        };
      }
    }
  }
  if (isObject(data.matches)) {
    for (const [key, s] of Object.entries(data.matches)) {
      if (
        isObject(s) &&
        isCount(s.matches) &&
        Array.isArray(s.places) &&
        s.places.length === 4 &&
        s.places.every(isCount)
      ) {
        out.matches[key] = { matches: s.matches, places: s.places as MatchStats['places'] };
      }
    }
  }
  if (Array.isArray(data.history)) {
    out.history = data.history
      .filter(
        (h): h is HistoryEntry =>
          isObject(h) &&
          isCount(h.at) &&
          (h.kind === 'run' || h.kind === 'match') &&
          typeof h.mode === 'string' &&
          isCount(h.result),
      )
      .slice(0, HISTORY_SIZE);
  }
  if (isObject(data.fun)) {
    const f = data.fun;
    for (const key of ['winStreak', 'bestWinStreak', 'checkmates', 'biggestComeback'] as const) {
      if (isCount(f[key])) out.fun[key] = f[key];
    }
    if (isObject(f.bought)) {
      for (const [type, n] of Object.entries(f.bought)) if (isPieceType(type) && isCount(n)) out.fun.bought[type] = n;
    }
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
