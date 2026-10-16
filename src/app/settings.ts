/**
 * The player's settings (the Settings screen): effects volume, the speed battles start at, reduced
 * motion and tutorials. Kept on the device; sound on/off has its own key (sound.ts), from before there
 * was a Settings screen. Storage can be missing or throw, so every access is guarded and the
 * defaults apply without it.
 */

/** Playback speeds offered during a battle. */
export const SPEEDS = [1, 2, 4];

/** Effects volume steps, in percent. */
export const VOLUME_MIN = 10;
export const VOLUME_MAX = 100;
export const VOLUME_STEP = 10;

export interface Settings {
  /** Effects volume, VOLUME_MIN–VOLUME_MAX percent. */
  volume: number;
  /** The playback speed each battle starts at (one of SPEEDS). */
  speed: number;
  /** Reduce motion even when the device doesn't ask for it. */
  reduceMotion: boolean;
  /**
   * The shop's tips, and its explanations of a tapped piece or offer (how it moves, what it's for).
   * Off, a piece panel shows just the name and its buttons.
   */
  tutorials: boolean;
}

export const DEFAULT_SETTINGS: Settings = { volume: 50, speed: 1, reduceMotion: false, tutorials: true };

const SETTINGS_KEY = 'acc.settings.v1';

/** Settings from stored JSON: anything missing or out of range falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const volume =
    typeof data.volume === 'number' && Number.isFinite(data.volume)
      ? Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(data.volume / VOLUME_STEP) * VOLUME_STEP))
      : DEFAULT_SETTINGS.volume;
  const speed = typeof data.speed === 'number' && SPEEDS.includes(data.speed) ? data.speed : DEFAULT_SETTINGS.speed;
  const reduceMotion = typeof data.reduceMotion === 'boolean' ? data.reduceMotion : DEFAULT_SETTINGS.reduceMotion;
  const tutorials = typeof data.tutorials === 'boolean' ? data.tutorials : DEFAULT_SETTINGS.tutorials;
  return { volume, speed, reduceMotion, tutorials };
}

let current: Settings | null = null;

export function settings(): Settings {
  if (!current) {
    try {
      current = parseSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
    } catch {
      current = { ...DEFAULT_SETTINGS };
    }
  }
  return current;
}

/** Changes some settings and saves them all. */
export function updateSettings(change: Partial<Settings>): Settings {
  current = parseSettings({ ...settings(), ...change });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  applyReduceMotion();
  return current;
}

/** True when animations should be cut: the device asks for it, or the player turned it on. */
export function reduceMotion(): boolean {
  return settings().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Puts the player's override on the page as a class the reduced-motion CSS also honours. */
export function applyReduceMotion(): void {
  document.body.classList.toggle('reduce-motion', settings().reduceMotion);
}
