import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { battleResult, material, PLY_LIMIT } from './battle';

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
});
