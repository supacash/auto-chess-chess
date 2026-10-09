import { describe, expect, it } from 'vitest';
import { makePiece } from '../rules/pieces';
import { newRun } from '../rules/run';
import { migrateSave, parseSave, SAVE_VERSION, type SavedGame } from './storage';

function sample(): SavedGame {
  const run = newRun();
  run.shop.pieces[0].square = { file: 4, rank: 0 };
  return { version: SAVE_VERSION, run, ai: { styleId: 'fortress', pieces: [makePiece('K', { file: 6, rank: 0 })] } };
}

describe('migrateSave', () => {
  const v1 = (settings?: object) => {
    const g: any = JSON.parse(JSON.stringify(sample()));
    g.version = 1;
    if (settings) g.run.settings = settings;
    else delete g.run.settings;
    return g;
  };

  it('upgrades a v1 save from before settings to Classic, Normal, no reveal', () => {
    expect((migrateSave(v1()) as any).run.settings).toEqual({
      mode: 'classic',
      difficulty: 'normal',
      reveal: false,
      side: 'white',
    });
  });

  it('keeps settings a v1 save already had, filling in only the mode', () => {
    expect((migrateSave(v1({ difficulty: 'hard', reveal: true })) as any).run.settings).toEqual({
      mode: 'classic',
      difficulty: 'hard',
      reveal: true,
      side: 'white',
    });
    // Saves written by the first board-size build were still v1 but had a mode.
    expect(
      (migrateSave(v1({ mode: 'growing', difficulty: 'easy', reveal: false, side: 'white' })) as any).run.settings.mode,
    ).toBe('growing');
  });

  it('upgrades every v1 save to the current version and leaves current saves alone', () => {
    expect(migrateSave(v1())?.version).toBe(SAVE_VERSION);
    const current = sample();
    expect(migrateSave(JSON.parse(JSON.stringify(current)))).toEqual(JSON.parse(JSON.stringify(current)));
  });

  it('round-trips a v1 save through parseSave', () => {
    const parsed = parseSave(v1({ difficulty: 'hard', reveal: false, side: 'white' }));
    expect(parsed?.version).toBe(SAVE_VERSION);
    expect(parsed?.run.settings).toEqual({ mode: 'classic', difficulty: 'hard', reveal: false, side: 'white' });
  });
});

describe('v2 → v3', () => {
  it('gives v2 saves the White side', () => {
    const g: any = JSON.parse(JSON.stringify(sample()));
    g.version = 2;
    delete g.run.settings.side;
    delete g.run.color;
    const parsed = parseSave(g);
    expect(parsed?.run.settings.side).toBe('white');
    expect(parsed?.run.color).toBe('w');
  });
});

describe('parseSave', () => {
  it('round-trips a valid save through JSON', () => {
    const game = sample();
    expect(parseSave(JSON.parse(JSON.stringify(game)))).toEqual(game);
  });

  it('rejects other versions and junk', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('hello')).toBeNull();
    expect(parseSave({ ...sample(), version: SAVE_VERSION + 1 })).toBeNull(); // from a newer build
    expect(parseSave({ ...sample(), version: 0 })).toBeNull();
    expect(parseSave({ ...sample(), version: '2' })).toBeNull();
  });

  it('rejects bad numbers, squares, piece types and styles', () => {
    const cases: ((g: any) => void)[] = [
      (g) => (g.run.lives = 0),
      (g) => (g.run.shop.gold = -1),
      (g) => (g.run.round = 1.5),
      (g) => (g.run.shop.pieces[1].square = { file: 2, rank: 5 }),
      (g) => (g.run.shop.pieces[1].type = 'Y'),
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

  it('keeps run settings, and upgrades v1 saves from before settings existed to Classic 8×8', () => {
    const g: any = JSON.parse(JSON.stringify(sample()));
    g.run.settings = { mode: 'growing', difficulty: 'easy', reveal: true, side: 'white' };
    expect(parseSave(g)?.run.settings).toEqual({ mode: 'growing', difficulty: 'easy', reveal: true, side: 'white' });
    g.version = 1;
    delete g.run.settings;
    expect(parseSave(g)?.run.settings).toEqual({ mode: 'classic', difficulty: 'normal', reveal: false, side: 'white' });
    // Saves from before modes existed were played on 8×8, so they stay Classic.
    g.run.settings = { difficulty: 'hard', reveal: false, side: 'white' };
    expect(parseSave(g)?.run.settings.mode).toBe('classic');
    g.run.settings = { mode: 'huge', difficulty: 'insane', reveal: 1 };
    expect(parseSave(g)?.run.settings).toEqual({ mode: 'classic', difficulty: 'normal', reveal: false, side: 'white' });
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
