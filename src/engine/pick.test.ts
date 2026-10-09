import { describe, expect, it } from 'vitest';
import { seededRng } from '../rules/rng';
import { checkmateEval, evalShare, formatEval, mateIn, parseInfo, pickMove, whiteEval } from './pick';

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

describe('evaluation display', () => {
  it('reports the best line from white’s point of view', () => {
    const cands = [
      { move: 'a', score: 40 },
      { move: 'b', score: 120 },
    ];
    expect(whiteEval(cands, 'w')).toBe(120);
    expect(whiteEval(cands, 'b')).toBe(-120);
    expect(whiteEval([], 'w')).toBeNull();
  });

  it('decodes mates on either side after flipping perspective', () => {
    const blackToMoveMates = parseInfo('info depth 8 multipv 1 score mate 2 pv d8h4')!.candidate;
    const s = whiteEval([blackToMoveMates], 'b')!;
    expect(mateIn(s)).toBe(-2);
    expect(formatEval(s)).toBe('−M2');
    const whiteMated = parseInfo('info depth 8 multipv 1 score mate -3 pv h2h3')!.candidate;
    expect(mateIn(whiteEval([whiteMated], 'w')!)).toBe(-3);
    expect(mateIn(checkmateEval('w'))).toBe(0);
    expect(formatEval(checkmateEval('b'))).toBe('#');
    expect(mateIn(250)).toBeNull();
  });

  it('formats centipawns as pawns', () => {
    expect(formatEval(134)).toBe('+1.3');
    expect(formatEval(-42)).toBe('−0.4');
    expect(formatEval(3)).toBe('0.0');
  });

  it('maps scores onto a 0..1 bar share', () => {
    expect(evalShare(0)).toBeCloseTo(0.5);
    expect(evalShare(300)).toBeGreaterThan(0.7);
    expect(evalShare(300)).toBeLessThan(0.9);
    expect(evalShare(-300)).toBeCloseTo(1 - evalShare(300));
    expect(evalShare(checkmateEval('w'))).toBe(1);
    expect(evalShare(checkmateEval('b'))).toBe(0);
  });
});
