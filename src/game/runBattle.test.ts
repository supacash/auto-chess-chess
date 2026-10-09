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

  it('reports the engine eval from white’s point of view', async () => {
    const evals: (number | null)[] = [];
    const engine: MoveSource = {
      newGame: async () => {},
      // Black to move, black sees itself +2.5: white's view is -2.5. Then white is silent.
      candidates: async (fen) => (fen.includes(' b ') ? [{ move: 'h7h6', score: 250 }] : []),
    };
    await runBattle('4k3/7p/8/8/8/8/8/4K3 b - - 0 1', engine, seededRng(1), async (_m, _c, _p, e) => {
      evals.push(e);
    }, { plyLimit: 2 });
    expect(evals).toEqual([-250, null]);
  });

  it('respects a custom ply limit', async () => {
    const result = await runBattle('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w - - 0 1', silentEngine, seededRng(3), async () => {}, { plyLimit: 4 });
    expect(result).toMatchObject({ reason: 'move-limit', plies: 4 });
  });

  it('ends early on a decisive lead when enabled', async () => {
    // White is a queen and rook up with no way for black to change that quickly; the black king just shuffles.
    const result = await runBattle('7k/8/8/8/8/8/8/QR4K1 w - - 0 1', silentEngine, seededRng(1), async () => {}, {
      plyLimit: 60,
      decisive: { lead: 10, plies: 3 },
    });
    expect(result).toMatchObject({ winner: 'w', reason: 'decisive', plies: 3 });
  });
});
