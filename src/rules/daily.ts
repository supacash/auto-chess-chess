import type { BoardSpec } from '../chess/boardSpec';
import { AI_STYLES, type AiStyle, aiBudget, budgetForSide, draftAiArmy, pickStyle, placeAiArmy } from './aiArmy';
import { DEFAULT_SETTINGS, difficulty, type RunSettings } from './difficulty';
import { gameMode } from './mode';
import { armyPoints, type Piece } from './pieces';
import { type Rng, seededRng } from './rng';
import { DAILY_BATTLES, DAILY_ROUND_STEP, newRun, type Run } from './run';

// The daily challenge: a five-battle gauntlet, the same for everyone on a UTC day. Everything that
// varies comes from the day's seed, split into one stream per battle and purpose, so a player's
// choices (rerolls, buys) never change what later battles bring. See DESIGN.md, Daily challenge.

export interface DailyTheme {
  id: string;
  name: string;
  /** A few words for the menu. */
  blurb: string;
  settings: RunSettings;
  /** Every opponent of the day plays this style (an AI_STYLES id); otherwise each is drawn. */
  style?: string;
}

const BASE: RunSettings = { ...DEFAULT_SETTINGS, reveal: true, manual: false };

/** Indexed by UTC weekday (0 = Sunday). */
export const DAILY_THEMES: DailyTheme[] = [
  { id: 'manual', name: 'Play yourself', blurb: 'you move your own pieces', settings: { ...BASE, manual: true } },
  {
    id: 'classic',
    name: 'Classic',
    blurb: '8×8 every battle, standard pieces',
    settings: { ...BASE, mode: 'classic', fairy: false },
  },
  { id: 'growing', name: 'Growing', blurb: '5×5 to 9×9, fairy pieces', settings: BASE },
  {
    id: 'menagerie',
    name: 'Menagerie',
    blurb: 'every opponent a Menagerie',
    settings: BASE,
    style: 'menagerie',
  },
  { id: 'black', name: 'Black', blurb: 'you play Black', settings: { ...BASE, side: 'black' } },
  { id: 'fortress', name: 'Fortress', blurb: 'every opponent a Fortress', settings: BASE, style: 'fortress' },
  { id: 'hard', name: 'Hard', blurb: 'Hard budgets', settings: { ...BASE, difficulty: 'hard' } },
];

/** Gold on top of a run's starting gold: about what round 1 of a run pays, since the daily starts at round 2. */
export const DAILY_EXTRA_GOLD = 6;

/** The UTC day of `now`, "2026-10-16". The challenge changes at UTC midnight. */
export function dailyDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The day before `date`. */
export function previousDate(date: string): string {
  return dailyDate(Date.parse(`${date}T00:00:00Z`) - 86_400_000);
}

export function dailyTheme(date: string): DailyTheme {
  return DAILY_THEMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function themeById(id: string): DailyTheme {
  return DAILY_THEMES.find((t) => t.id === id) ?? DAILY_THEMES[2];
}

/** 32-bit FNV-1a hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One stream of the day's randomness: `date` and `version` (RULES_VERSION, so a rules update starts a
 * fresh challenge instead of quietly changing today's) plus what it's for, e.g. (3, 'reroll', 2).
 */
export function dailyRng(date: string, version: number, ...parts: (string | number)[]): Rng {
  return seededRng(hash([date, version, ...parts].join('|')));
}

/** The round a daily battle (1–5) is played as: its budget, board and shop. */
export function dailyRound(battle: number): number {
  return battle * DAILY_ROUND_STEP;
}

/** Which daily battle (1–5) a round is. */
export function dailyBattle(round: number): number {
  return Math.round(round / DAILY_ROUND_STEP);
}

/** The day's challenge, ready to play: round 2 of a run with the theme's settings and the extra gold. */
export function newDailyRun(date: string): Run {
  const theme = dailyTheme(date);
  const run = newRun(theme.settings);
  return {
    ...run,
    round: dailyRound(1),
    shop: { ...run.shop, gold: run.shop.gold + DAILY_EXTRA_GOLD },
    daily: { date, theme: theme.id, rerolls: 0 },
  };
}

/** A daily opponent: its style and army, placed. */
export interface DailyOpponent {
  style: AiStyle;
  pieces: Piece[];
  points: number;
  board: BoardSpec;
}

/** The day's opponent for `battle` (1–5): the same for everyone, whatever they did before it. */
export function dailyOpponent(date: string, version: number, battle: number): DailyOpponent {
  const theme = dailyTheme(date);
  const { settings } = theme;
  const rng = dailyRng(date, version, battle, 'opponent');
  const round = dailyRound(battle);
  const mode = gameMode(settings.mode);
  const board = mode.board(round);
  const style = (theme.style && AI_STYLES.find((s) => s.id === theme.style)) || pickStyle(rng, settings.fairy);
  const budget = budgetForSide(
    aiBudget(round, rng, difficulty(settings.difficulty).perRound, mode.roundOneDiscount, mode.aiBonus),
    settings.side !== 'black',
  );
  const pieces = placeAiArmy(draftAiArmy(budget, style, rng, board, settings.fairy, round), style, rng, board);
  return { style, pieces, points: armyPoints(pieces.map((p) => p.type)), board };
}

/** 100 a win, 50 a draw, plus the gold left after the last battle. */
export function dailyScore(record: { w: number; d: number }, goldLeft: number): number {
  return record.w * 100 + record.d * 50 + goldLeft;
}

/** A finished daily challenge, as kept in the records. */
export interface DailyDay {
  date: string;
  theme: string;
  score: number;
  w: number;
  l: number;
  d: number;
  gold: number;
}

/** The finished day for a run that has played all its battles. */
export function dailyDay(run: Run): DailyDay | null {
  const { daily, record } = run;
  if (!daily || record.w + record.l + record.d < DAILY_BATTLES) return null;
  const gold = run.shop.gold;
  return { date: daily.date, theme: daily.theme, score: dailyScore(record, gold), ...record, gold };
}

/**
 * The current streak: days in a row with the challenge finished, up to today. A streak whose last day
 * was yesterday is still alive (today's can still be played).
 */
export function dailyStreak(days: readonly DailyDay[], today: string): number {
  const done = new Set(days.map((d) => d.date));
  let day = done.has(today) ? today : previousDate(today);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = previousDate(day);
  }
  return streak;
}

/** The longest run of consecutive days with the challenge finished. */
export function bestDailyStreak(days: readonly DailyDay[]): number {
  const dates = [...new Set(days.map((d) => d.date))].sort();
  let best = 0;
  let current = 0;
  let last = '';
  for (const date of dates) {
    current = last && previousDate(date) === last ? current + 1 : 1;
    best = Math.max(best, current);
    last = date;
  }
  return best;
}
