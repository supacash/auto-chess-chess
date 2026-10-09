import { describe, expect, it } from 'vitest';
import { makePiece } from '../rules/pieces';
import { newRun } from '../rules/run';
import { parseSave, type SavedGame } from './storage';

function sample(): SavedGame {
  const run = newRun();
  run.shop.pieces[0].square = { file: 4, rank: 0 };
  return { version: 1, run, ai: { styleId: 'fortress', pieces: [makePiece('K', { file: 6, rank: 0 })] } };
}

describe('parseSave', () => {
  it('round-trips a valid save through JSON', () => {
    const game = sample();
    expect(parseSave(JSON.parse(JSON.stringify(game)))).toEqual(game);
  });

  it('rejects other versions and junk', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('hello')).toBeNull();
    expect(parseSave({ ...sample(), version: 2 })).toBeNull();
  });

  it('rejects bad numbers, squares, piece types and styles', () => {
    const cases: ((g: any) => void)[] = [
      (g) => (g.run.lives = 0),
      (g) => (g.run.shop.gold = -1),
      (g) => (g.run.round = 1.5),
      (g) => (g.run.shop.pieces[1].square = { file: 2, rank: 5 }),
      (g) => (g.run.shop.pieces[1].type = 'X'),
      (g) => (g.run.shop.pieces = g.run.shop.pieces.filter((p: any) => p.type !== 'K')),
      (g) => (g.ai.styleId = 'nope'),
      (g) => (g.run.record.w = '3'),
    ];
    for (const mutate of cases) {
      const g = JSON.parse(JSON.stringify(sample()));
      mutate(g);
      expect(parseSave(g)).toBeNull();
    }
  });

  it('keeps run settings, and gives saves from before settings existed the defaults (on Classic 8×8)', () => {
    const g: any = JSON.parse(JSON.stringify(sample()));
    g.run.settings = { mode: 'growing', difficulty: 'easy', reveal: true };
    expect(parseSave(g)?.run.settings).toEqual({ mode: 'growing', difficulty: 'easy', reveal: true });
    delete g.run.settings;
    expect(parseSave(g)?.run.settings).toEqual({ mode: 'classic', difficulty: 'normal', reveal: false });
    // Saves from before modes existed were played on 8×8, so they stay Classic.
    g.run.settings = { difficulty: 'hard', reveal: false };
    expect(parseSave(g)?.run.settings.mode).toBe('classic');
    g.run.settings = { mode: 'huge', difficulty: 'insane', reveal: 1 };
    expect(parseSave(g)?.run.settings).toEqual({ mode: 'classic', difficulty: 'normal', reveal: false });
  });

  it('keeps the battle-in-progress flag only when it is true', () => {
    expect(parseSave({ ...sample(), battleInProgress: true })?.battleInProgress).toBe(true);
    expect(parseSave({ ...sample(), battleInProgress: 'yes' })).not.toHaveProperty('battleInProgress');
  });

  it('drops unknown extra fields', () => {
    const g: any = JSON.parse(JSON.stringify(sample()));
    g.run.extra = 'x';
    g.run.shop.pieces[0].evil = true;
    const parsed = parseSave(g)!;
    expect('extra' in parsed.run).toBe(false);
    expect('evil' in parsed.run.shop.pieces[0]).toBe(false);
  });
});
