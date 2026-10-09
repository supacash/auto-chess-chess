import { describe, expect, it } from 'vitest';
import { seededRng } from '../rules/rng';
import { parseInfo, pickMove } from './pick';

describe('parseInfo', () => {
  it('parses centipawn lines', () => {
    const info = parseInfo('info depth 8 seldepth 10 multipv 2 score cp -34 nodes 1200 nps 1 pv e7e5 g1f3');
    expect(info).toEqual({ multipv: 2, candidate: { move: 'e7e5', score: -34 } });
  });

  it('ranks shorter mates above longer ones, and being mated below everything', () => {
    const m1 = parseInfo('info depth 8 multipv 1 score mate 1 pv d1h5')!.candidate.score;
    const m3 = parseInfo('info depth 8 multipv 2 score mate 3 pv a1a8')!.candidate.score;
    const mated = parseInfo('info depth 8 multipv 3 score mate -2 pv h2h3')!.candidate.score;
    expect(m1 - m3).toBeGreaterThan(50);
    expect(m3).toBeGreaterThan(10_000);
    expect(mated).toBeLessThan(-10_000);
  });

  it('ignores lines without a PV', () => {
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull();
    expect(parseInfo('info depth 1 multipv 1 score cp 10 nodes 20')).toBeNull();
  });
});

describe('pickMove', () => {
  it('returns null with no candidates', () => {
    expect(pickMove([], seededRng(1))).toBeNull();
  });

  it('only picks moves within the margin of the best', () => {
    const cands = [
      { move: 'a', score: 100 },
      { move: 'b', score: 70 },
      { move: 'c', score: 20 },
    ];
    const picked = new Set<string>();
    const rng = seededRng(7);
    for (let i = 0; i < 50; i++) picked.add(pickMove(cands, rng)!);
    expect(picked).toEqual(new Set(['a', 'b']));
  });
});
