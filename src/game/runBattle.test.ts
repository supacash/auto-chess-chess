import { describe, expect, it } from 'vitest';
import { PLY_LIMIT } from '../rules/battle';
import { seededRng } from '../rules/rng';
import { type MoveSource, runBattle } from './runBattle';

/** Engine stand-in that never answers, forcing the random-legal-move fallback. */
const silentEngine: MoveSource = {
  newGame: async () => {},
  candidates: async () => [],
};

describe('runBattle', () => {
  it('ends immediately when the side to move starts checkmated', async () => {
    let moves = 0;
    const result = await runBattle('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1', silentEngine, seededRng(1), async () => {
      moves++;
    });
    expect(result).toMatchObject({ winner: 'w', reason: 'checkmate', plies: 0 });
    expect(moves).toBe(0);
  });

  it('never exceeds the ply limit', async () => {
    for (let seed = 0; seed < 5; seed++) {
      const result = await runBattle('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w - - 0 1', silentEngine, seededRng(seed), async () => {});
      expect(result.plies).toBeLessThanOrEqual(PLY_LIMIT);
    }
  });

  it('plays the engine move when one is offered', async () => {
    const engine: MoveSource = {
      newGame: async () => {},
      candidates: async (fen) => (fen.includes(' w ') ? [{ move: 'a1a8', score: 100_000 }] : []),
    };
    const result = await runBattle('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', engine, seededRng(1), async () => {});
    expect(result).toMatchObject({ winner: 'w', reason: 'checkmate', plies: 1 });
  });
});
