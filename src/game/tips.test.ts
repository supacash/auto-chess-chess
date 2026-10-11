import { describe, expect, it } from 'vitest';
import type { Shop } from '../rules/economy';
import { makePiece } from '../rules/pieces';
import { nextTip, type TipId } from './tips';

const shop = (over: Partial<Shop> = {}): Shop => ({ gold: 3, pieces: [makePiece('K')], ...over });
const none = new Set<TipId>();

describe('nextTip', () => {
  it('starts with how to play, then the next relevant tip once dismissed', () => {
    expect(nextTip(shop({ offers: ['PR'] }), 1, none)).toBe('start');
    expect(nextTip(shop({ offers: ['PR'] }), 1, new Set(['start']))).toBe('affinity');
    expect(nextTip(shop(), 1, new Set(['start']))).toBeNull();
  });

  it('puts a ready set right after how to play', () => {
    const rookPawns = [1, 2, 3].map(() => makePiece('P', null, 'R'));
    const army = shop({ pieces: [makePiece('K'), ...rookPawns], gold: 12 });
    expect(nextTip(army, 1, none)).toBe('start');
    expect(nextTip(army, 4, new Set<TipId>(['start']))).toBe('merge');
  });

  it('mentions interest with gold to save and the opponent list from round 2', () => {
    const seen = new Set<TipId>(['start', 'affinity']);
    expect(nextTip(shop({ gold: 12 }), 3, seen)).toBe('interest');
    expect(nextTip(shop({ gold: 2 }), 3, seen)).toBe('opponent');
    expect(nextTip(shop({ gold: 2 }), 3, new Set<TipId>(['start', 'affinity', 'opponent']))).toBeNull();
  });
});
