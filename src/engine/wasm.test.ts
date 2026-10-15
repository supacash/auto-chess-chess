import { describe, expect, it } from 'vitest';
import { PIECE_TYPES, PIECES } from '../rules/pieces';
import { Board, engineVersion, pieceBetza } from './wasm/acc';
import { loadEngineForNode } from './wasmNode';

loadEngineForNode();

describe('engine WASM', () => {
  it('loads in Node and reports its version', () => {
    expect(engineVersion()).toBeGreaterThanOrEqual(1);
  });

  it('knows every piece, and moves the fairy pieces as the game defines them', () => {
    for (const type of PIECE_TYPES) {
      const betza = pieceBetza(type);
      expect(betza, type).toBeDefined();
      // The Heir is a second king; the engine moves it as one.
      if (PIECES[type].betza && type !== 'J') expect(betza, type).toBe(PIECES[type].betza);
    }
  });

  it('plays moves like ffish', () => {
    const board = new Board('acc8', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    expect(board.numberLegalMoves()).toBe(20);
    expect(board.push('e2e4')).toBe(true);
    expect(board.push('e2e4')).toBe(false);
    expect(board.fen()).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1');
    board.pop();
    expect(board.turn()).toBe(true);
    expect(board.perft(3)).toBe(8902);
    board.delete();
  });
});
