import { describe, expect, it } from 'vitest';
import { pawnSquares } from '../chess/boardSpec';
import { MAX_PAWNS } from './aiArmy';
import { AI_STYLES } from './aiArmy';
import { DAILY_THEMES, dailyOpponent, dailyTheme, poolFor } from './daily';
import { DAILY_POOL, poolBoard, poolPieces } from './dailyPool';
import { armyPoints, isPawnLike } from './pieces';
import { armyErrors } from './placement';

/** A date for each weekday theme (2026-10-11 was a Sunday). */
const dateOf = (themeId: string) => `2026-10-${11 + DAILY_THEMES.findIndex((t) => t.id === themeId)}`;

describe('daily army pool', () => {
  it('has unique ids, known styles and only legal armies', () => {
    expect(new Set(DAILY_POOL.map((a) => a.id)).size).toBe(DAILY_POOL.length);
    for (const army of DAILY_POOL) {
      const board = poolBoard(army);
      expect(board, army.id).toBeDefined();
      if (!board) continue;
      expect(
        army.rows.every((r) => r.length === board.files),
        army.id,
      ).toBe(true);
      expect(
        AI_STYLES.some((s) => s.id === army.style),
        army.id,
      ).toBe(true);
      const pieces = poolPieces(army);
      expect(armyErrors(pieces, board), army.id).toEqual([]);
      const pawns = pieces.filter((p) => isPawnLike(p.type)).length;
      expect(pawns, army.id).toBeLessThanOrEqual(Math.min(MAX_PAWNS, pawnSquares(board)));
      expect(pieces.filter((p) => p.type === 'Y').length, army.id).toBeLessThanOrEqual(1);
      expect(
        pieces.some((p) => p.type === 'J'),
        army.id,
      ).toBe(false);
      // Flipping keeps it legal.
      expect(armyErrors(poolPieces(army, true), board), army.id).toEqual([]);
    }
  });

  it('fits every army to some day, and gives every battle of Growing and Classic days armies to pick from', () => {
    const used = new Set<string>();
    for (const theme of DAILY_THEMES) {
      for (let battle = 1; battle <= 5; battle++) {
        for (const army of poolFor(dateOf(theme.id), battle)) used.add(army.id);
      }
    }
    expect(DAILY_POOL.filter((a) => !used.has(a.id)).map((a) => a.id)).toEqual([]);
    for (const day of ['growing', 'classic']) {
      for (let battle = 1; battle <= 5; battle++)
        expect(poolFor(dateOf(day), battle).length, `${day} ${battle}`).toBeGreaterThan(0);
    }
  });

  it('keeps fairy armies off standard days and other styles off Fortress days', () => {
    for (let battle = 1; battle <= 5; battle++) {
      for (const army of poolFor(dateOf('classic'), battle)) {
        expect(armyPoints(poolPieces(army).map((p) => p.type))).toBeGreaterThan(0);
        expect(army.rows.join('')).toMatch(/^[KQRBNP.]+$/);
      }
      for (const army of poolFor(dateOf('fortress'), battle)) expect(army.style).toBe('fortress');
    }
    expect(dailyTheme(dateOf('fortress')).id).toBe('fortress');
  });

  it('puts hand-made armies into some days, the same for everyone, and the drafter into the rest', () => {
    const days = Array.from({ length: 28 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
    const opponents = days.flatMap((d) => [1, 2, 3, 4, 5].map((b) => dailyOpponent(d, 11, b)));
    const pooled = opponents.filter((o) => o.poolId);
    expect(pooled.length).toBeGreaterThan(10);
    expect(pooled.length).toBeLessThan(opponents.length - 10);
    const again = dailyOpponent(days[0], 11, 1);
    expect(again.name).toBe(opponents[0].name);
    expect(again.pieces.map((p) => [p.type, p.square])).toEqual(opponents[0].pieces.map((p) => [p.type, p.square]));
    for (const o of pooled) expect(DAILY_POOL.find((a) => a.id === o.poolId)?.name).toBe(o.name);
  });
});
