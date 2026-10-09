import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { battleResult, material, nextLeadStreak, NO_STREAK, PLY_LIMIT } from './battle';

const load = (fen: string) => new Chess(fen, { skipValidation: true });

describe('material', () => {
  it('counts piece values per side, king excluded', () => {
    expect(material(load('4k3/pppp4/8/8/8/8/8/QR2K3 w - - 0 1'))).toEqual({ w: 14, b: 4 });
  });
});

describe('battleResult', () => {
  it('is null while the game is running', () => {
    expect(battleResult(load('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), 0)).toBeNull();
  });

  it('awards checkmate to the side that delivered it', () => {
    // Back-rank mate: black to move and mated.
    const r = battleResult(load('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), 10);
    expect(r).toMatchObject({ winner: 'w', reason: 'checkmate' });
  });

  it('treats stalemate as a draw', () => {
    expect(battleResult(load('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 5)).toMatchObject({ winner: 'draw', reason: 'stalemate' });
  });

  it('decides on material at the ply limit', () => {
    const fen = '4k3/pp6/8/8/8/8/8/R3K3 w - - 0 1';
    expect(battleResult(load(fen), PLY_LIMIT - 1)).toBeNull();
    expect(battleResult(load(fen), PLY_LIMIT)).toMatchObject({ winner: 'w', reason: 'move-limit', material: { w: 5, b: 2 } });
  });

  it('is a draw at the ply limit with equal material', () => {
    expect(battleResult(load('4k3/p7/8/8/8/8/P7/4K3 w - - 0 1'), PLY_LIMIT)).toMatchObject({ winner: 'draw' });
  });

  it('uses a custom ply limit', () => {
    const fen = '4k3/pp6/8/8/8/8/8/R3K3 w - - 0 1';
    expect(battleResult(load(fen), 89, { plyLimit: 90 })).toBeNull();
    expect(battleResult(load(fen), 90, { plyLimit: 90 })).toMatchObject({ winner: 'w', reason: 'move-limit', plies: 90 });
  });

  it('ends on a decisive lead only when enabled and held long enough', () => {
    const fen = '4k3/8/8/8/8/8/8/QR2K3 w - - 0 1'; // white +14
    const limits = { plyLimit: 60, decisive: { lead: 10, plies: 6 } };
    expect(battleResult(load(fen), 20, limits, { side: 'w', plies: 5 })).toBeNull();
    expect(battleResult(load(fen), 20, limits, { side: 'w', plies: 6 })).toMatchObject({ winner: 'w', reason: 'decisive' });
    expect(battleResult(load(fen), 20, { plyLimit: 60 }, { side: 'w', plies: 6 })).toBeNull();
  });

  it('prefers checkmate over a decisive lead', () => {
    const r = battleResult(load('R5k1/5ppp/8/8/8/8/8/Q5K1 b - - 0 1'), 10, { plyLimit: 60, decisive: { lead: 10, plies: 1 } }, { side: 'w', plies: 3 });
    expect(r).toMatchObject({ winner: 'w', reason: 'checkmate' });
  });
});

describe('nextLeadStreak', () => {
  it('counts consecutive plies with the same leader and resets otherwise', () => {
    let s = nextLeadStreak(NO_STREAK, { w: 20, b: 9 }, 10);
    expect(s).toEqual({ side: 'w', plies: 1 });
    s = nextLeadStreak(s, { w: 20, b: 10 }, 10);
    expect(s).toEqual({ side: 'w', plies: 2 });
    expect(nextLeadStreak(s, { w: 19, b: 10 }, 10)).toEqual(NO_STREAK);
    expect(nextLeadStreak(s, { w: 0, b: 12 }, 10)).toEqual({ side: 'b', plies: 1 });
  });
});
