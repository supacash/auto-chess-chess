import { AI_STYLES } from '../rules/aiArmy';
import type { Piece } from '../rules/pieces';
import { HOME_RANKS } from '../rules/placement';
import type { Run } from '../rules/run';

const RUN_KEY = 'acc.run.v1';
const BEST_KEY = 'acc.best.v1';

/** A run in progress, including the opponent already drafted for the current round. */
export interface SavedGame {
  version: 1;
  run: Run;
  ai: { styleId: string; pieces: Piece[] };
  /** Set while a battle is playing. Finding it on load means the page was closed mid-battle. */
  battleInProgress?: boolean;
}

// Storage can be missing or throw (private mode, blocked site data), so every access is guarded
// and the game works without it.

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    return raw ? parseSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveGame(game: SavedGame): void {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(game));
  } catch {
    // ignore
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    // ignore
  }
}

export function loadBest(): number {
  try {
    const best = Number(localStorage.getItem(BEST_KEY));
    return Number.isInteger(best) && best > 0 ? best : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // ignore
  }
}

/** Validates untrusted saved data; returns null if anything looks wrong. */
export function parseSave(data: unknown): SavedGame | null {
  if (!isObject(data) || data.version !== 1 || !isObject(data.run) || !isObject(data.ai)) return null;
  const { run, ai } = data;
  if (!isCount(run.round, 1) || !isCount(run.lives, 1)) return null;
  if (!isObject(run.record) || !['w', 'l', 'd'].every((k) => isCount((run.record as Record<string, unknown>)[k], 0))) {
    return null;
  }
  if (!isObject(run.shop) || !isCount(run.shop.gold, 0)) return null;
  const pieces = parsePieces(run.shop.pieces);
  const aiPieces = parsePieces(ai.pieces);
  if (!pieces || !aiPieces || typeof ai.styleId !== 'string') return null;
  if (!AI_STYLES.some((s) => s.id === ai.styleId)) return null;
  if (pieces.filter((p) => p.type === 'K').length !== 1) return null;

  const record = run.record as Run['record'];
  return {
    version: 1,
    run: {
      round: run.round,
      lives: run.lives,
      record: { w: record.w, l: record.l, d: record.d },
      shop: { gold: run.shop.gold, pieces },
    },
    ai: { styleId: ai.styleId, pieces: aiPieces },
    ...(data.battleInProgress === true ? { battleInProgress: true } : {}),
  };
}

function parsePieces(data: unknown): Piece[] | null {
  if (!Array.isArray(data)) return null;
  const out: Piece[] = [];
  for (const p of data) {
    if (!isObject(p) || typeof p.id !== 'string' || !['K', 'Q', 'R', 'B', 'N', 'P'].includes(p.type as string)) return null;
    let square: Piece['square'] = null;
    if (p.square !== null) {
      const sq = p.square;
      if (!isObject(sq) || !isCount(sq.file, 0) || !isCount(sq.rank, 0) || sq.file > 7 || sq.rank >= HOME_RANKS) return null;
      square = { file: sq.file, rank: sq.rank };
    }
    out.push({ id: p.id, type: p.type as Piece['type'], square });
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isCount(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min;
}
