import { describe, expect, it } from 'vitest';
import {
  mergeDays,
  recordDailyEnd,
  averagePlace,
  averageScore,
  emptyRecords,
  favouritePiece,
  HISTORY_SIZE,
  importBest,
  matchKey,
  parseRecords,
  recordBattle,
  recordBought,
  recordMatchEnd,
  recordRunEnd,
  runKey,
} from './records';

const growing = runKey('growing', 'normal');

describe('records', () => {
  it('count rounds per mode and keep fun stats for every battle', () => {
    let r = emptyRecords();
    r = recordBattle(r, { outcome: 'w', checkmate: true, worstDeficit: 4 }, growing);
    r = recordBattle(r, { outcome: 'w', checkmate: false, worstDeficit: 0 }, growing);
    r = recordBattle(r, { outcome: 'd', checkmate: false, worstDeficit: 9 }); // a match battle: no run stats
    r = recordBattle(r, { outcome: 'l', checkmate: true, worstDeficit: 12 }, growing);
    expect(r.runs[growing].rounds).toEqual({ w: 2, l: 1, d: 0 });
    expect(r.fun).toMatchObject({ winStreak: 0, bestWinStreak: 2, checkmates: 1, biggestComeback: 4 });
  });

  it('keep best and average scores per mode, and a capped history', () => {
    let r = emptyRecords();
    r = recordRunEnd(r, growing, 'Growing · Normal', 3, 1000);
    r = recordRunEnd(r, growing, 'Growing · Normal', 7, 2000);
    expect(r.runs[growing]).toMatchObject({ runs: 2, best: 7, totalScore: 10 });
    expect(averageScore(r.runs[growing])).toBe(5);
    expect(r.history[0]).toEqual({ at: 2000, kind: 'run', mode: 'Growing · Normal', result: 7 });
    for (let i = 0; i < 30; i++) r = recordRunEnd(r, growing, 'Growing · Normal', 1, 3000 + i);
    expect(r.history).toHaveLength(HISTORY_SIZE);
  });

  it('count match places and the average place', () => {
    let r = emptyRecords();
    const key = matchKey(true, false);
    r = recordMatchEnd(r, key, 'Online', 1, 1);
    r = recordMatchEnd(r, key, 'Online', 3, 2);
    expect(r.matches[key]).toEqual({ matches: 2, places: [1, 0, 1, 0] });
    expect(averagePlace(r.matches[key])).toBe(2);
    expect(matchKey(false, true)).toBe('bots.blitz');
  });

  it('find the most-bought piece', () => {
    let r = emptyRecords();
    expect(favouritePiece(r.fun)).toBeNull();
    for (const t of ['N', 'B', 'N', 'X'] as const) r = recordBought(r, t);
    expect(favouritePiece(r.fun)).toEqual({ type: 'N', count: 2 });
    // Pawns, Ferzes and Wazirs are bought most by everyone: they don't count.
    for (let i = 0; i < 5; i++) for (const t of ['P', 'F', 'W', 'E'] as const) r = recordBought(r, t);
    expect(favouritePiece(r.fun)).toEqual({ type: 'N', count: 2 });
  });

  it('import best scores from before records existed', () => {
    const r = importBest(emptyRecords(), growing, 6);
    expect(r.runs[growing]).toMatchObject({ runs: 0, best: 6 });
    expect(importBest(r, growing, 4)).toBe(r);
  });

  it('round-trip through JSON and survive junk', () => {
    let r = recordRunEnd(emptyRecords(), growing, 'Growing · Normal', 3, 1000);
    r = recordBought(recordMatchEnd(r, 'bots.normal', 'Vs bots', 2, 5), 'Q');
    expect(parseRecords(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(parseRecords(null)).toEqual(emptyRecords());
    expect(
      parseRecords({ version: 1, runs: { x: { runs: -1 } }, history: [{ at: 'x' }], fun: { bought: { V: 3 } } }),
    ).toEqual(emptyRecords());
  });
});

describe('daily challenge records', () => {
  const day = (date: string, score: number) => ({ date, theme: 'growing', score, w: 2, l: 3, d: 0, gold: score - 200 });

  it('keeps one result a day (the first), oldest first, and survives saving', () => {
    let r = recordDailyEnd(emptyRecords(), day('2026-10-16', 230));
    r = recordDailyEnd(r, day('2026-10-14', 210));
    r = recordDailyEnd(r, day('2026-10-16', 999));
    expect(r.daily.map((d) => [d.date, d.score])).toEqual([
      ['2026-10-14', 210],
      ['2026-10-16', 230],
    ]);
    expect(parseRecords(JSON.parse(JSON.stringify(r))).daily).toEqual(r.daily);
    expect(parseRecords({ ...r, daily: [{ date: 'yesterday', score: 1 }] }).daily).toEqual([]);
    expect(parseRecords({ ...r, daily: undefined }).daily).toEqual([]);
  });

  it('merges the days played on two devices', () => {
    const a = mergeDays([day('2026-10-14', 210)], [day('2026-10-15', 220), day('2026-10-14', 300)]);
    expect(a.map((d) => d.score)).toEqual([210, 220]);
  });
});
