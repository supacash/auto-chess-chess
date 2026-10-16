import { describe, expect, it } from 'vitest';
import {
  bestDailyStreak,
  DAILY_EXTRA_GOLD,
  type DailyDay,
  dailyDate,
  dailyDay,
  dailyOpponent,
  dailyRng,
  dailyScore,
  dailyStreak,
  dailyTheme,
  newDailyRun,
  previousDate,
} from './daily';
import { applyResult, DAILY_BATTLES, isRunOver, newRun, nextRound } from './run';

/** An army's pieces and squares (piece ids differ from draft to draft). */
const army = (pieces: readonly { type: string; square: unknown }[]) => pieces.map((p) => [p.type, p.square]);

const day = (date: string, score = 100): DailyDay => ({ date, theme: 'growing', score, w: 1, l: 4, d: 0, gold: 0 });

describe('daily challenge', () => {
  it('changes at UTC midnight', () => {
    expect(dailyDate(Date.parse('2026-10-16T23:59:59Z'))).toBe('2026-10-16');
    expect(dailyDate(Date.parse('2026-10-17T00:00:00Z'))).toBe('2026-10-17');
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2027-01-01')).toBe('2026-12-31');
  });

  it('has a theme for each weekday', () => {
    // 2026-10-12 was a Monday.
    const week = Array.from({ length: 7 }, (_, i) => dailyTheme(`2026-10-${12 + i}`).id);
    expect(week).toEqual(['classic', 'growing', 'menagerie', 'black', 'fortress', 'hard', 'manual']);
    expect(dailyTheme('2026-10-12').settings).toMatchObject({ mode: 'classic', fairy: false });
    expect(dailyTheme('2026-10-15').settings.side).toBe('black');
    expect(dailyTheme('2026-10-17').settings.difficulty).toBe('hard');
    expect(dailyTheme('2026-10-18').settings.manual).toBe(true);
  });

  it('gives the same stream for the same date, version and purpose, and a different one otherwise', () => {
    const draw = (rng: () => number) => [rng(), rng(), rng()];
    expect(draw(dailyRng('2026-10-16', 11, 1, 'shop'))).toEqual(draw(dailyRng('2026-10-16', 11, 1, 'shop')));
    expect(draw(dailyRng('2026-10-16', 11, 1, 'shop'))).not.toEqual(draw(dailyRng('2026-10-17', 11, 1, 'shop')));
    expect(draw(dailyRng('2026-10-16', 11, 1, 'shop'))).not.toEqual(draw(dailyRng('2026-10-16', 12, 1, 'shop')));
    expect(draw(dailyRng('2026-10-16', 11, 1, 'shop'))).not.toEqual(draw(dailyRng('2026-10-16', 11, 2, 'shop')));
  });

  it('drafts the same opponents for everyone on a day, on growing boards and budgets', () => {
    const a = dailyOpponent('2026-10-16', 11, 3);
    const b = dailyOpponent('2026-10-16', 11, 3);
    expect(army(b.pieces)).toEqual(army(a.pieces));
    expect(b.style.id).toBe(a.style.id);
    expect(army(dailyOpponent('2026-10-17', 11, 3).pieces)).not.toEqual(army(a.pieces));
    const boards = [1, 2, 3, 4, 5].map((n) => dailyOpponent('2026-10-16', 11, n).board.files);
    expect(boards).toEqual([5, 6, 7, 8, 9]);
    const points = [1, 2, 3, 4, 5].map((n) => dailyOpponent('2026-10-16', 11, n).points);
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1]);
    // Fortress Friday: every opponent a Fortress.
    expect([1, 2, 3, 4, 5].map((n) => dailyOpponent('2026-10-16', 11, n).style.id)).toEqual(Array(5).fill('fortress'));
  });

  it('plays all five battles without lives, at rounds 2 to 10, with two rounds of income each', () => {
    let run = newDailyRun('2026-10-13');
    expect(run.round).toBe(2);
    expect(run.shop.gold).toBe(newRun().shop.gold + DAILY_EXTRA_GOLD);
    for (let i = 0; i < DAILY_BATTLES; i++) {
      expect(isRunOver(run)).toBe(false);
      const gold = run.shop.gold;
      run = applyResult(run, 'b');
      expect(run.shop.gold).toBe(gold + 10 + Math.min(3, Math.floor(gold / 10)));
      if (i < DAILY_BATTLES - 1) run = nextRound(run);
    }
    expect(run.round).toBe(10);
    expect(run.lives).toBe(3);
    expect(isRunOver(run)).toBe(true);
    expect(dailyDay(run)).toMatchObject({ date: '2026-10-13', w: 0, l: 5, score: run.shop.gold });
  });

  it('scores 100 a win, 50 a draw, plus the gold left', () => {
    expect(dailyScore({ w: 4, d: 1 }, 12)).toBe(462);
    expect(dailyScore({ w: 0, d: 0 }, 0)).toBe(0);
  });

  it('keeps a streak while every day is finished, and lets today still be played', () => {
    const days = [day('2026-10-12'), day('2026-10-14'), day('2026-10-15')];
    expect(dailyStreak(days, '2026-10-15')).toBe(2);
    expect(dailyStreak(days, '2026-10-16')).toBe(2); // today not played yet: still alive
    expect(dailyStreak(days, '2026-10-17')).toBe(0); // yesterday missed
    expect(dailyStreak([], '2026-10-16')).toBe(0);
    expect(bestDailyStreak(days)).toBe(2);
    expect(bestDailyStreak([day('2026-02-27'), day('2026-02-28'), day('2026-03-01'), day('2026-03-03')])).toBe(3);
  });
});
