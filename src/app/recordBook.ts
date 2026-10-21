import { type AchievementId, type Collections, collectionAchievements } from '../game/achievements';
import { loadBest, loadRecords, saveRecords } from '../game/storage';
import {
  emptyRecords,
  importBest,
  matchKey,
  type Records,
  recordBattle,
  recordBought,
  recordMatchEnd,
  recordRunEnd,
  recordAchievements,
  recordDailyEnd,
  runKey,
} from '../game/records';
import type { DailyDay } from '../rules/daily';
import { DIFFICULTIES, difficulty, type RunSettings } from '../rules/difficulty';
import { gameMode, MODES } from '../rules/mode';
import type { PieceType } from '../rules/pieces';
import type { BattleResult } from '../rules/battle';

/** "Growing board · Normal". */
export function runLabel(settings: Pick<RunSettings, 'mode' | 'difficulty'> & { manual?: boolean }): string {
  return `${gameMode(settings.mode).name} · ${difficulty(settings.difficulty).name}${settings.manual ? ' · Play yourself' : ''}`;
}

/** "Online · Blitz", "Vs bots". */
export function matchLabel(online: boolean, blitz: boolean): string {
  return `${online ? 'Online' : 'Vs bots'}${blitz ? ' · Blitz' : ''}`;
}

/** The player's records on this device: loaded once, updated as they play, saved after each change. */
export class RecordBook {
  records: Records;

  constructor() {
    const saved = loadRecords();
    if (saved) {
      this.records = saved;
    } else {
      // First time: bring in the best scores saved before records existed.
      let records = emptyRecords();
      for (const m of MODES) {
        for (const d of DIFFICULTIES) records = importBest(records, runKey(m.id, d.id), loadBest(d.id, m.id));
      }
      this.records = records;
      saveRecords(records);
    }
  }

  /** Reads the records again (after a sync wrote the account's to this device). */
  reload(): void {
    this.records = loadRecords() ?? this.records;
  }

  /**
   * A battle the player fought. `side` is the player's colour in the battle's FEN; `worstDeficit` the
   * most points they were behind. `run` is the run's settings for single-player battles.
   */
  battle(result: BattleResult, side: 'w' | 'b', worstDeficit: number, run?: RunSettings): void {
    const outcome = result.winner === 'draw' ? 'd' : result.winner === side ? 'w' : 'l';
    this.update(
      recordBattle(
        this.records,
        { outcome, checkmate: result.reason === 'checkmate', worstDeficit },
        run && runKey(run.mode, run.difficulty, run.manual),
      ),
    );
  }

  runEnd(settings: RunSettings, score: number, completed = false, prestige = 0): void {
    this.update(
      recordRunEnd(
        this.records,
        runKey(settings.mode, settings.difficulty, settings.manual),
        runLabel(settings),
        score,
        Date.now(),
        completed,
        prestige,
      ),
    );
  }

  matchEnd(online: boolean, blitz: boolean, place: number): void {
    this.update(recordMatchEnd(this.records, matchKey(online, blitz), matchLabel(online, blitz), place, Date.now()));
  }

  /** A finished daily challenge. */
  dailyEnd(day: DailyDay): void {
    this.update(recordDailyEnd(this.records, day));
  }

  /** The recorded result of the daily challenge for `date`, if it was played. */
  dailyOf(date: string): DailyDay | undefined {
    return this.records.daily.find((d) => d.date === date);
  }

  bought(type: PieceType): void {
    this.update(recordBought(this.records, type));
  }

  /** Called with each achievement as it's unlocked (the game shows a notice). */
  onUnlock: ((id: AchievementId) => void) | null = null;

  /** Adds `types` to a career collection, unlocking Zoo Keeper / Fusion Chef once it's complete. */
  collect(kind: keyof Collections, types: readonly PieceType[]): void {
    const have = this.records.collections[kind];
    const added = types.filter((t) => !have.includes(t));
    if (added.length === 0) return;
    const collections = { ...this.records.collections, [kind]: [...have, ...new Set(added)] };
    this.update({ ...this.records, collections });
    this.unlock(collectionAchievements(collections));
  }

  /** Unlocks `ids` (those not unlocked yet). */
  unlock(ids: readonly AchievementId[]): void {
    if (ids.length === 0) return;
    const { records, unlocked } = recordAchievements(this.records, ids, Date.now());
    if (unlocked.length === 0) return;
    this.update(records);
    for (const id of unlocked) this.onUnlock?.(id);
  }

  private update(records: Records): void {
    this.records = records;
    saveRecords(records);
  }
}
