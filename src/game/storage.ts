import { AI_STYLES } from '../rules/aiArmy';
import { DEFAULT_SETTINGS, type DifficultyId, isDifficultyId, type RunSettings } from '../rules/difficulty';
import type { Piece } from '../rules/pieces';
import { BOARDS } from '../chess/boardSpec';

/** Saved squares may be anywhere on the biggest board; the game fits them to the current one (fitToBoard). */
const MAX_FILES = Math.max(...BOARDS.map((b) => b.files));
const MAX_HOME_ROWS = Math.max(...BOARDS.map((b) => b.homeRows));
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

/** Each difficulty has its own best score. Normal keeps the original key so earlier bests carry over. */
function bestKey(difficulty: DifficultyId): string {
  return difficulty === 'normal' ? BEST_KEY : `acc.best.${difficulty}.v1`;
}

export function loadBest(difficulty: DifficultyId = 'normal'): number {
  try {
    const best = Number(localStorage.getItem(bestKey(difficulty)));
    return Number.isInteger(best) && best > 0 ? best : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number, difficulty: DifficultyId = 'normal'): void {
  try {
    localStorage.setItem(bestKey(difficulty), String(score));
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
  // Saves from before settings existed (or with bad values) fall back to the defaults.
  const s = isObject(run.settings) ? run.settings : {};
  const settings: RunSettings = {
    difficulty: isDifficultyId(s.difficulty) ? s.difficulty : DEFAULT_SETTINGS.difficulty,
    reveal: typeof s.reveal === 'boolean' ? s.reveal : DEFAULT_SETTINGS.reveal,
  };
  return {
    version: 1,
    run: {
      round: run.round,
      lives: run.lives,
      record: { w: record.w, l: record.l, d: record.d },
      shop: { gold: run.shop.gold, pieces },
      settings,
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
      if (!isObject(sq) || !isCount(sq.file, 0) || !isCount(sq.rank, 0) || sq.file >= MAX_FILES || sq.rank >= MAX_HOME_ROWS) return null;
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
