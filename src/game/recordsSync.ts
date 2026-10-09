import { emptyRecords, HISTORY_SIZE, type HistoryEntry, type MatchStats, type Records, type RunStats } from './records';

// Merging records across devices. Each device remembers the records as they were at its last sync
// (`base`); what it has added since (local − base) is added onto the account's copy (`cloud`).
// Counts add up, bests keep the higher value, and histories are combined. Done this way, playing on
// two devices between syncs counts everything once.

/** The account's records after adding this device's changes since `base`. */
export function mergeRecords(cloud: Records, local: Records, base: Records): Records {
  const out: Records = structuredClone(cloud);
  const added = (now: number, before: number) => Math.max(0, now - before);

  for (const [key, l] of Object.entries(local.runs)) {
    const b: RunStats = base.runs[key] ?? emptyRun();
    const c: RunStats = out.runs[key] ?? emptyRun();
    out.runs[key] = {
      runs: c.runs + added(l.runs, b.runs),
      best: Math.max(c.best, l.best),
      totalScore: c.totalScore + added(l.totalScore, b.totalScore),
      rounds: {
        w: c.rounds.w + added(l.rounds.w, b.rounds.w),
        l: c.rounds.l + added(l.rounds.l, b.rounds.l),
        d: c.rounds.d + added(l.rounds.d, b.rounds.d),
      },
    };
  }

  for (const [key, l] of Object.entries(local.matches)) {
    const b: MatchStats = base.matches[key] ?? emptyMatch();
    const c: MatchStats = out.matches[key] ?? emptyMatch();
    out.matches[key] = {
      matches: c.matches + added(l.matches, b.matches),
      places: c.places.map((n, i) => n + added(l.places[i], b.places[i])) as MatchStats['places'],
    };
  }

  for (const [type, n] of Object.entries(local.fun.bought) as [keyof Records['fun']['bought'], number][]) {
    out.fun.bought[type] = (out.fun.bought[type] ?? 0) + added(n, base.fun.bought[type] ?? 0);
  }
  out.fun.checkmates += added(local.fun.checkmates, base.fun.checkmates);
  out.fun.bestWinStreak = Math.max(out.fun.bestWinStreak, local.fun.bestWinStreak);
  out.fun.biggestComeback = Math.max(out.fun.biggestComeback, local.fun.biggestComeback);
  // The current streak is this device's run of wins.
  out.fun.winStreak = local.fun.winStreak;

  out.history = mergeHistory(cloud.history, local.history);
  return out;
}

/** Both histories, without duplicates, most recent first. */
function mergeHistory(a: HistoryEntry[], b: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((h) => {
      const key = `${h.at}|${h.kind}|${h.mode}|${h.result}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((x, y) => y.at - x.at)
    .slice(0, HISTORY_SIZE);
}

const emptyRun = (): RunStats => ({ runs: 0, best: 0, totalScore: 0, rounds: { w: 0, l: 0, d: 0 } });
const emptyMatch = (): MatchStats => ({ matches: 0, places: [0, 0, 0, 0] });

/** Records nobody has synced yet: the starting point for a device's first sync. */
export const NEVER_SYNCED: Records = emptyRecords();
