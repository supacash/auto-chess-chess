import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { loadRulesForNode } from '../chess/testRules';
import { PIECES } from '../rules/pieces';
import { armyErrors } from '../rules/placement';
import { seededRng } from '../rules/rng';
import { START_HP } from './match';
import { MatchSession, withKingPlaced } from './matchSession';

beforeAll(loadRulesForNode);

const match = (seed = 11) =>
  new MatchSession(
    seed,
    'me',
    [
      { id: 'me', name: 'Me', bot: false },
      { id: 'bot1', name: 'Bot 1', bot: true },
      { id: 'bot2', name: 'Bot 2', bot: true },
      { id: 'bot3', name: 'Bot 3', bot: true },
    ],
    { blitz: false },
    seededRng(seed),
  );

describe('MatchSession', () => {
  it('starts in the shop on Classic 8×8 with standard offers only and a hidden opponent', () => {
    const m = match();
    expect(m.phase).toBe('shop');
    expect(m.board).toBe(BOARD_8);
    expect(m.shop.pieces.map((p) => p.type)).toEqual(['K', 'P', 'P', 'P']);
    expect(m.shop.offers?.every((t) => PIECES[t].group === 'standard')).toBe(true);
    expect(m.opponent()).toBeNull();
    expect(m.players.every((p) => p.hp === START_HP)).toBe(true);
  });

  it('locks armies (placing a forgotten king), pairs everyone, and builds legal battles', () => {
    const m = match();
    m.lockArmies();
    expect(m.phase).toBe('battle');
    expect(m.army('me').map((p) => p.type)).toEqual(['K']); // only the auto-placed king is on the board
    expect(armyErrors(m.army('me'), BOARD_8)).toEqual([]);
    expect(m.pairings).toHaveLength(2);
    expect(m.myPairing()).not.toBeNull();
    for (const p of m.pairings) {
      const b = m.battle(p);
      // Both armies are on the board: white's king at the bottom, black's mirrored at the top.
      if (b.start) expect(b.start.fen.split(' ')[0]).toMatch(/K/);
      if (b.start) expect(b.start.fen.split(' ')[0]).toMatch(/k/);
    }
  });

  it('applies results: damage, income and the next round’s shop', () => {
    const m = match();
    m.lockArmies();
    const mine = m.myPairing()!;
    const iAmWhite = mine.white === 'me';
    const goldBefore = m.shop.gold;
    m.finishRound(
      m.pairings.map((p) => ({
        pairing: p,
        winner: p === mine ? (iAmWhite ? 'b' : 'w') : 'draw', // I lose; the other battle is drawn
        material: { w: 10, b: 10 },
      })),
    );
    expect(m.me.hp).toBe(START_HP - 3); // round 1 + 10/5
    expect(m.round).toBe(2);
    expect(m.phase).toBe('shop');
    expect(m.shop.gold).toBe(goldBefore + 5); // loss income (no streak yet)
    expect(m.streaks.get('me')).toBe(-1);
    expect(m.pairings).toEqual([]);
  });

  it('ends for the player when they are knocked out', () => {
    const m = match();
    m.players = m.players.map((p) => (p.id === 'me' ? { ...p, hp: 1 } : p));
    m.lockArmies();
    const mine = m.myPairing()!;
    m.finishRound([{ pairing: mine, winner: mine.white === 'me' ? 'b' : 'w', material: { w: 0, b: 0 } }]);
    expect(m.me.place).toBe(4);
    expect(m.phase).toBe('over');
  });

  it('places a benched king on a central back-row square', () => {
    const m = match();
    const placed = withKingPlaced(m.shop.pieces, BOARD_8);
    expect(placed.find((p) => p.type === 'K')!.square).toEqual({ file: 3, rank: 0 });
  });
});
