import { BOARDS } from '../chess/boardSpec';
import { AI_STYLES } from '../rules/aiArmy';
import { DEFAULT_SETTINGS, type DifficultyId, isDifficultyId, isSideId, type RunSettings } from '../rules/difficulty';
import { isModeId, type ModeId } from '../rules/mode';
import { OFFER_COUNT } from '../rules/economy';
import { isPieceType, type Piece, type PieceType } from '../rules/pieces';
import type { Run } from '../rules/run';

/** Saved squares may be anywhere on the biggest board; the game fits them to the current one (fitToBoard). */
const MAX_FILES = Math.max(...BOARDS.map((b) => b.files));
const MAX_HOME_ROWS = Math.max(...BOARDS.map((b) => b.homeRows));

// The key names keep their original "v1" suffix so existing saves are found; the save's format
// version lives inside it (SavedGame.version) and is upgraded by MIGRATIONS.
const RUN_KEY = 'acc.run.v1';
const BEST_KEY = 'acc.best.v1';

/** Current save format. Bump it and add a MIGRATIONS step whenever SavedGame changes shape. */
export const SAVE_VERSION = 3;

/** A run in progress, including the opponent already drafted for the current round. */
export interface SavedGame {
  version: typeof SAVE_VERSION;
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

/**
 * Each mode and difficulty has its own best score. Classic keeps the original keys so earlier
 * bests (all played on 8×8) carry over.
 */
function bestKey(difficulty: DifficultyId, mode: ModeId): string {
  if (mode === 'growing') return `acc.best.growing.${difficulty}.v1`;
  return difficulty === 'normal' ? BEST_KEY : `acc.best.${difficulty}.v1`;
}

export function loadBest(difficulty: DifficultyId = 'normal', mode: ModeId = 'classic'): number {
  try {
    const best = Number(localStorage.getItem(bestKey(difficulty, mode)));
    return Number.isInteger(best) && best > 0 ? best : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number, difficulty: DifficultyId = 'normal', mode: ModeId = 'classic'): void {
  try {
    localStorage.setItem(bestKey(difficulty, mode), String(score));
  } catch {
    // ignore
  }
}

type RawSave = Record<string, unknown>;

/**
 * Upgrades a save from format N (the key) to N + 1, filling in only what format N lacked.
 * Steps run in order, so a very old save passes through every one of them.
 */
const MIGRATIONS: Record<number, (save: RawSave) => RawSave> = {
  // v1 → v2: v1 gained run settings over time (difficulty + reveal, then mode). A v1 save missing
  // them predates those features: it was played at Normal on Classic 8×8.
  1: (save) => {
    const run = isObject(save.run) ? save.run : {};
    const settings = isObject(run.settings) ? run.settings : {};
    return {
      ...save,
      version: 2,
      run: { ...run, settings: { mode: 'classic', difficulty: 'normal', reveal: false, ...settings } },
    };
  },
  // v2 → v3: the player picks a side. Before, who moved first was a coin flip; runs carry on as White.
  2: (save) => {
    const run = isObject(save.run) ? save.run : {};
    const settings = isObject(run.settings) ? run.settings : {};
    return { ...save, version: 3, run: { ...run, settings: { side: 'white', ...settings }, color: 'w' } };
  },
};

/** Brings saved data up to SAVE_VERSION; null if it isn't a save, or comes from a newer build. */
export function migrateSave(data: unknown): RawSave | null {
  if (!isObject(data) || !isCount(data.version, 1)) return null;
  let save: RawSave = data;
  while ((save.version as number) < SAVE_VERSION) {
    const step = MIGRATIONS[save.version as number];
    if (!step) return null;
    save = step(save);
  }
  return save.version === SAVE_VERSION ? save : null;
}

/** Validates untrusted saved data (any version); returns null if anything looks wrong. */
export function parseSave(raw: unknown): SavedGame | null {
  const data = migrateSave(raw);
  if (!data || !isObject(data.run) || !isObject(data.ai)) return null;
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
  // Missing settings were filled in by MIGRATIONS; values that are present but invalid fall back
  // to safe defaults rather than losing the run.
  const s = isObject(run.settings) ? run.settings : {};
  const settings: RunSettings = {
    mode: isModeId(s.mode) ? s.mode : 'classic',
    difficulty: isDifficultyId(s.difficulty) ? s.difficulty : DEFAULT_SETTINGS.difficulty,
    reveal: typeof s.reveal === 'boolean' ? s.reveal : DEFAULT_SETTINGS.reveal,
    side: isSideId(s.side) ? s.side : DEFAULT_SETTINGS.side,
    // Runs saved before the setting existed already had fairy pieces in the shop.
    fairy: typeof s.fairy === 'boolean' ? s.fairy : true,
  };
  return {
    version: SAVE_VERSION,
    run: {
      round: run.round,
      lives: run.lives,
      record: { w: record.w, l: record.l, d: record.d },
      shop: { gold: run.shop.gold, pieces, ...parseOffers(run.shop.offers) },
      settings,
      color: run.color === 'b' ? 'b' : 'w',
    },
    ai: { styleId: ai.styleId, pieces: aiPieces },
    ...(data.battleInProgress === true ? { battleInProgress: true } : {}),
  };
}

/** Offers are optional (saves from before the shop had them have none; the session rolls new ones). */
function parseOffers(data: unknown): { offers?: PieceType[] } {
  if (!Array.isArray(data) || data.length > OFFER_COUNT || !data.every(isPieceType)) return {};
  return { offers: data };
}

function parsePieces(data: unknown): Piece[] | null {
  if (!Array.isArray(data)) return null;
  const out: Piece[] = [];
  for (const p of data) {
    if (!isObject(p) || typeof p.id !== 'string' || !isPieceType(p.type)) return null;
    let square: Piece['square'] = null;
    if (p.square !== null) {
      const sq = p.square;
      if (
        !isObject(sq) ||
        !isCount(sq.file, 0) ||
        !isCount(sq.rank, 0) ||
        sq.file >= MAX_FILES ||
        sq.rank >= MAX_HOME_ROWS
      )
        return null;
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
