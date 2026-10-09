import { describe, expect, it } from 'vitest';
import { emptyRecords, recordBattle, recordBought, recordMatchEnd, recordRunEnd, runKey } from './records';
import { mergeRecords, NEVER_SYNCED } from './recordsSync';

const key = runKey('growing', 'normal');
const run = (r = emptyRecords(), score = 3, at = 1) => recordRunEnd(r, key, 'Growing', score, at);

describe('mergeRecords', () => {
  it('uploads a first device’s records as they are', () => {
    const local = recordBought(run(), 'N');
    expect(mergeRecords(emptyRecords(), local, NEVER_SYNCED)).toEqual(local);
  });

  it('adds up what two devices did between syncs', () => {
    // Both devices start from the same synced records...
    const synced = run(emptyRecords(), 5, 1);
    // ...phone plays a run (score 2) and buys a knight; tablet plays a run (score 7) and a match.
    const phone = recordBought(run(synced, 2, 10), 'N');
    const tablet = recordMatchEnd(run(synced, 7, 20), 'bots.normal', 'Vs bots', 1, 30);
    // Phone syncs first, then the tablet.
    const afterPhone = mergeRecords(synced, phone, synced);
    const afterTablet = mergeRecords(afterPhone, tablet, synced);
    expect(afterTablet.runs[key]).toMatchObject({ runs: 3, best: 7, totalScore: 14 });
    expect(afterTablet.matches['bots.normal']).toEqual({ matches: 1, places: [1, 0, 0, 0] });
    expect(afterTablet.fun.bought).toEqual({ N: 1 });
    expect(afterTablet.history.map((h) => h.at)).toEqual([30, 20, 10, 1]);
  });

  it('does not double count when the same device syncs again', () => {
    const local = run();
    const once = mergeRecords(emptyRecords(), local, NEVER_SYNCED);
    expect(mergeRecords(once, local, local)).toEqual(once);
  });

  it('keeps the higher bests and this device’s current streak', () => {
    let cloud = emptyRecords();
    for (let i = 0; i < 5; i++) cloud = recordBattle(cloud, { outcome: 'w', checkmate: true, worstDeficit: 3 });
    let local = emptyRecords();
    local = recordBattle(local, { outcome: 'w', checkmate: false, worstDeficit: 9 });
    const merged = mergeRecords(cloud, local, NEVER_SYNCED);
    expect(merged.fun).toMatchObject({ bestWinStreak: 5, biggestComeback: 9, checkmates: 5, winStreak: 1 });
  });
});
