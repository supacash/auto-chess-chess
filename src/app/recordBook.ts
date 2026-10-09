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
  runKey,
} from '../game/records';
import { DIFFICULTIES, difficulty, type RunSettings } from '../rules/difficulty';
import { gameMode, MODES } from '../rules/mode';
import type { PieceType } from '../rules/pieces';
import type { BattleResult } from '../rules/battle';

/** "Growing board · Normal". */
export function runLabel(settings: Pick<RunSettings, 'mode' | 'difficulty'>): string {
  return `${gameMode(settings.mode).name} · ${difficulty(settings.difficulty).name}`;
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
        run && runKey(run.mode, run.difficulty),
      ),
    );
  }

  runEnd(settings: RunSettings, score: number): void {
    this.update(
      recordRunEnd(this.records, runKey(settings.mode, settings.difficulty), runLabel(settings), score, Date.now()),
    );
  }

  matchEnd(online: boolean, blitz: boolean, place: number): void {
    this.update(recordMatchEnd(this.records, matchKey(online, blitz), matchLabel(online, blitz), place, Date.now()));
  }

  bought(type: PieceType): void {
    this.update(recordBought(this.records, type));
  }

  private update(records: Records): void {
    this.records = records;
    saveRecords(records);
  }
}
