import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOUD_VERSION, type CloudData, mergeCloud, parseCloudData } from './cloudSave';
import { emptyRecords, recordAchievements, recordRunEnd, runKey } from './records';
import {
  loadAccount,
  loadSyncBase,
  readCloudData,
  saveAccount,
  saveBest,
  saveName,
  saveRecords,
  writeCloudData,
} from './storage';

const key = runKey('growing', 'normal');
const data = (over: Partial<CloudData> = {}): CloudData => ({
  v: CLOUD_VERSION,
  records: emptyRecords(),
  best: {},
  tips: [],
  tipsCleared: 0,
  name: null,
  run: { at: 0, save: null },
  ...over,
});

describe('mergeCloud', () => {
  it('drops tips seen before a newer Show again on the other device', () => {
    const cloud = data({ tips: ['start', 'merge'] });
    const local = data({ tips: ['tap'], tipsCleared: 5 });
    const merged = mergeCloud(cloud, local, emptyRecords());
    expect(merged.tips).toEqual(['tap']);
    expect(merged.tipsCleared).toBe(5);
    // The other device catches up: its old tips stay cleared.
    expect(mergeCloud(merged, data({ tips: ['start'] }), emptyRecords()).tips).toEqual(['tap']);
  });

  it('uploads a first device as it is', () => {
    const local = data({ best: { 'acc.best.v1': 4 } });
    expect(mergeCloud(null, local, emptyRecords())).toBe(local);
  });

  it('adds records, keeps the higher bests and every tip, and the newer name and run', () => {
    const cloud = data({
      records: recordRunEnd(emptyRecords(), key, 'Growing', 5, 1),
      best: { 'acc.best.v1': 9, 'acc.best.hard.v1': 2 },
      tips: ['start'],
      name: { value: 'Old Rook 1', at: 10 },
      run: { at: 50, save: { from: 'cloud' } },
    });
    const local = data({
      records: recordAchievements(recordRunEnd(emptyRecords(), key, 'Growing', 3, 2), ['wall'], 2).records,
      best: { 'acc.best.v1': 4, 'acc.best.growing.normal.v1': 3 },
      tips: ['merge'],
      name: { value: 'New Pawn 2', at: 20 },
      run: { at: 40, save: { from: 'local' } },
    });
    const merged = mergeCloud(cloud, local, emptyRecords());
    expect(merged.records.runs[key]).toMatchObject({ runs: 2, best: 5 });
    expect(merged.records.achievements.wall).toBe(2);
    expect(merged.best).toEqual({ 'acc.best.v1': 9, 'acc.best.hard.v1': 2, 'acc.best.growing.normal.v1': 3 });
    expect(merged.tips).toEqual(['start', 'merge']);
    expect(merged.name?.value).toBe('New Pawn 2');
    expect(merged.run.save).toEqual({ from: 'cloud' });
    // While a run is being played here, this device's stays.
    expect(mergeCloud(cloud, local, emptyRecords(), true).run.save).toEqual({ from: 'local' });
  });

  it('keeps an account name over a generated one', () => {
    const cloud = data({ name: { value: 'Chosen Knight 7', at: 10 } });
    const local = data({ name: { value: 'Random Pawn 3', at: 0 } });
    expect(mergeCloud(cloud, local, emptyRecords()).name?.value).toBe('Chosen Knight 7');
  });
});

describe('parseCloudData', () => {
  it('drops anything that is not a best score key, a tip or a valid run', () => {
    const parsed = parseCloudData({
      v: CLOUD_VERSION,
      records: emptyRecords(),
      best: { 'acc.best.v1': 3, 'acc.run.v1': 99, 'acc.best.growing.hard.v1': -1, evil: 5 },
      tips: ['start', 7],
      name: { value: 'x'.repeat(41), at: 1 },
      run: { at: 3, save: { not: 'a save' } },
    });
    expect(parsed).toEqual(data({ best: { 'acc.best.v1': 3 }, tips: ['start'], run: { at: 3, save: null } }));
    expect(parseCloudData({ v: 99 })).toBeNull();
    expect(parseCloudData('nope')).toBeNull();
  });
});

/** Minimal in-memory localStorage, with key() and length for readCloudData. */
class MemoryStorage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('storage for the account', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('reads this device’s data and writes the account’s back, with the new sync base', () => {
    const records = recordRunEnd(emptyRecords(), key, 'Growing', 3, 1);
    saveRecords(records);
    saveBest(3, 'normal', 'growing');
    saveName('Brave Rook 5', 7);
    const local = readCloudData();
    expect(local).toMatchObject({ best: { 'acc.best.growing.normal.v1': 3 }, name: { value: 'Brave Rook 5', at: 7 } });
    expect(local.records).toEqual(records);

    const account = data({ best: { 'acc.best.v1': 8 }, tips: ['start'], name: { value: 'Other 1', at: 9 } });
    writeCloudData(account, records, true);
    expect(readCloudData()).toMatchObject({
      best: { 'acc.best.growing.normal.v1': 3, 'acc.best.v1': 8 },
      tips: ['start'],
      name: { value: 'Other 1', at: 9 },
    });
    expect(loadSyncBase()).toEqual(records);
  });

  it('forgets the sync base when another account signs in', () => {
    saveAccount({ uid: 'a', label: 'a@x' });
    writeCloudData(data(), emptyRecords(), false);
    expect(loadSyncBase()).not.toBeNull();
    saveAccount({ uid: 'a', label: 'a@x' });
    expect(loadSyncBase()).not.toBeNull();
    saveAccount({ uid: 'b', label: 'b@x' });
    expect(loadSyncBase()).toBeNull();
    expect(loadAccount()).toEqual({ uid: 'b', label: 'b@x' });
  });
});
