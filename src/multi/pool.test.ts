import { describe, expect, it } from 'vitest';
import { rollOffers } from '../rules/economy';
import { makePiece } from '../rules/pieces';
import { seededRng } from '../rules/rng';
import { BOT_HOLD, botHoldings, holdingsOf, offerLeft, POOL_SIZE, poolLeft, poolScale } from './pool';

describe('shared pawn pool', () => {
  it('counts held affinity pawns, and takes everyone’s out of the pool (never below 0)', () => {
    const pieces = [
      makePiece('K'),
      makePiece('P'),
      makePiece('P', null, 'R'),
      makePiece('P', null, 'R'),
      makePiece('R'),
    ];
    expect(holdingsOf(pieces)).toEqual({ R: 2 });
    const left = poolLeft([{ R: 2 }, { R: 3, N: 1 }, { Q: 99 }]);
    expect(left).toEqual({ N: POOL_SIZE.N - 1, B: POOL_SIZE.B, R: POOL_SIZE.R - 5, Q: 0 });
    expect(offerLeft(left, 'PR')).toBe(POOL_SIZE.R - 5);
    expect(offerLeft(left, 'R')).toBeNull();
  });

  it('gives bots a couple of one kind, the same on every client, queen-pawns only from round 6', () => {
    const h = botHoldings(3, 2, 'bot1');
    expect(Object.values(h)).toEqual([BOT_HOLD]);
    expect(botHoldings(3, 2, 'bot1')).toEqual(h);
    for (let seed = 0; seed < 40; seed++) expect(botHoldings(seed, 5, 'bot2').Q).toBeUndefined();
  });

  it('never offers a sold-out pawn, and offers scarce ones less', () => {
    const left = { ...POOL_SIZE, R: 0 };
    for (let seed = 0; seed < 50; seed++) {
      expect(rollOffers(4, seededRng(seed), false, 6, poolScale(left))).not.toContain('PR');
    }
    expect(poolScale({ ...POOL_SIZE, N: POOL_SIZE.N / 2 })('PN')).toBe(0.5);
    expect(poolScale(left)('N')).toBe(1);
  });
});
