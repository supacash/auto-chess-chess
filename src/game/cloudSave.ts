import { parseRecords, type Records } from './records';
import { mergeRecords } from './recordsSync';
import { parseSave } from './storage';
import { TIPS } from './tips';

// What a signed-in player's account keeps (users/{uid} in Firestore, src/online/account.ts): their
// records, best scores, seen tips, name and the run in progress. Each device merges its changes in
// (see recordsSync.ts), so progress made on two devices between syncs all counts.

export const CLOUD_VERSION = 1;

/** Best-score storage keys (storage.ts bestKey), the only ones a cloud save may write. */
const BEST_KEY = /^acc\.best(\.[a-z]+){0,3}\.v1$/;
/** Longest name kept (generated names are far shorter; this only bounds untrusted data). */
const MAX_NAME = 40;

export interface CloudData {
  v: typeof CLOUD_VERSION;
  records: Records;
  /** Best scores by their storage key. */
  best: Record<string, number>;
  tips: string[];
  /** When the player last asked to see every tip again (ms, 0: never): tips seen before it don't count. */
  tipsCleared: number;
  /** The player's name and when it was picked (ms), so the newest pick wins. */
  name: { value: string; at: number } | null;
  /** The saved run (a SavedGame, or null when there is none) and when it last changed (ms). */
  run: { at: number; save: unknown };
}

/**
 * The account's data after adding this device's: records merged against `base` (the records as of
 * this device's last sync), the higher of each best, every tip seen anywhere (since the newest Show again), and the newer name.
 * The run is the newer one, unless `keepLocalRun` (a run is being played here right now).
 */
export function mergeCloud(cloud: CloudData | null, local: CloudData, base: Records, keepLocalRun = false): CloudData {
  if (!cloud) return local;
  const best = { ...cloud.best };
  for (const [key, score] of Object.entries(local.best)) best[key] = Math.max(best[key] ?? 0, score);
  const name = !local.name || (cloud.name && cloud.name.at > local.name.at) ? cloud.name : local.name;
  const run = keepLocalRun || local.run.at >= cloud.run.at ? local.run : cloud.run;
  return {
    v: CLOUD_VERSION,
    records: mergeRecords(cloud.records, local.records, base),
    best,
    // Every tip seen anywhere, except on a side that hasn't caught up with a newer Show again.
    tips: [
      ...new Set([
        ...(cloud.tipsCleared >= local.tipsCleared ? cloud.tips : []),
        ...(local.tipsCleared >= cloud.tipsCleared ? local.tips : []),
      ]),
    ],
    tipsCleared: Math.max(cloud.tipsCleared, local.tipsCleared),
    name,
    run,
  };
}

/** Whether the account has anything this device doesn't show (so the screens need refreshing). */
export function cloudDiffers(a: CloudData, b: CloudData): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Validates an account's data read from the server (untrusted); null if it isn't usable. */
export function parseCloudData(raw: unknown): CloudData | null {
  if (!isObject(raw) || raw.v !== CLOUD_VERSION) return null;
  const best: Record<string, number> = {};
  if (isObject(raw.best)) {
    for (const [key, score] of Object.entries(raw.best)) {
      if (BEST_KEY.test(key) && Number.isInteger(score) && (score as number) > 0) best[key] = score as number;
    }
  }
  const tips = Array.isArray(raw.tips) ? raw.tips.filter((t): t is string => typeof t === 'string' && t in TIPS) : [];
  const n = raw.name;
  const name =
    isObject(n) && typeof n.value === 'string' && n.value.trim() && n.value.length <= MAX_NAME && isTime(n.at)
      ? { value: n.value, at: n.at }
      : null;
  const r = isObject(raw.run) ? raw.run : {};
  const save = r.save === null || r.save === undefined ? null : parseSave(r.save) ? r.save : null;
  return {
    v: CLOUD_VERSION,
    records: parseRecords(raw.records),
    best,
    tips,
    tipsCleared: isTime(raw.tipsCleared) ? raw.tipsCleared : 0,
    name,
    run: { at: isTime(r.at) ? r.at : 0, save },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
