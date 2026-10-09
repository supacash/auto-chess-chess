import { describe, expect, it } from 'vitest';
import { applyResult, hasStarted, isRunOver, newRun, nextRound, runScore, START_LIVES } from './run';

describe('run', () => {
  it('starts at round 1 with full lives and the starting shop', () => {
    const run = newRun();
    expect(run).toMatchObject({ round: 1, lives: START_LIVES, record: { w: 0, l: 0, d: 0 } });
    expect(run.shop.gold).toBe(3);
  });

  it('records wins, losses and draws with income; only losses cost a life', () => {
    let run = newRun();
    run = applyResult(run, 'w');
    expect(run).toMatchObject({ lives: 3, record: { w: 1, l: 0, d: 0 } });
    expect(run.shop.gold).toBe(3 + 7);
    run = applyResult(run, 'draw');
    expect(run).toMatchObject({ lives: 3, record: { w: 1, l: 0, d: 1 } });
    run = applyResult(run, 'b');
    expect(run).toMatchObject({ lives: 2, record: { w: 1, l: 1, d: 1 } });
    expect(run.shop.gold).toBe(3 + 7 + 6 + 5);
    expect(run.round).toBe(1);
    expect(nextRound(run).round).toBe(2);
  });

  it('ends after the last life and scores rounds won', () => {
    let run = applyResult(newRun(), 'w');
    for (let i = 0; i < START_LIVES; i++) {
      expect(isRunOver(run)).toBe(false);
      run = applyResult(run, 'b');
    }
    expect(isRunOver(run)).toBe(true);
    expect(runScore(run)).toBe(1);
  });

  it('keeps its settings across rounds and knows when it has started', () => {
    const settings = { mode: 'classic', difficulty: 'hard', reveal: true } as const;
    let run = newRun(settings);
    expect(newRun().settings).toEqual({ mode: 'growing', difficulty: 'normal', reveal: false });
    expect(hasStarted(run)).toBe(false);
    run = nextRound(applyResult(run, 'draw'));
    expect(hasStarted(run)).toBe(true);
    expect(run.settings).toEqual(settings);
  });

  it('starts each mode with its own army', () => {
    expect(newRun({ mode: 'growing', difficulty: 'normal', reveal: false }).shop.pieces.map((p) => p.type)).toEqual(['K', 'P', 'P', 'P', 'P']);
    expect(newRun({ mode: 'classic', difficulty: 'normal', reveal: false }).shop.pieces.map((p) => p.type)).toEqual(['K', 'P', 'P', 'P']);
  });

  it('does not mutate the input', () => {
    const run = newRun();
    applyResult(run, 'b');
    expect(run.lives).toBe(START_LIVES);
    expect(run.record.l).toBe(0);
  });
});
