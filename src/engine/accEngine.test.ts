import { beforeAll, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import { AccEngine } from './accEngine';
import { mateIn } from './pick';

beforeAll(loadRulesForNode);

describe('AccEngine', () => {
  it('finds a mate in one and reports it as pick.ts reads mates', async () => {
    const engine = new AccEngine({ depth: 4, nodes: 0 });
    await engine.newGame('acc8');
    const lines = await engine.candidates('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 8);
    expect(lines[0].move).toBe('a1a8');
    expect(mateIn(lines[0].score)).toBe(1);
    engine.terminate();
  });

  it('returns up to three distinct moves, best first, from a start position plus moves', async () => {
    const engine = new AccEngine({ depth: 4, nodes: 0 });
    await engine.newGame('acc8');
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
    const lines = await engine.candidates(fen, 8, { fen, moves: ['e2e4', 'e7e5'] });
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(new Set(lines.map((l) => l.move)).size).toBe(lines.length);
    // The others are within the pick margin of the best (src/engine/pick.ts).
    for (const l of lines) expect(l.score).toBeGreaterThanOrEqual(lines[0].score - 50);
    engine.terminate();
  });

  it('searches the same way every time from a new game', async () => {
    const engine = new AccEngine({ depth: 6, nodes: 50_000 });
    const fen = 'r1bqk1nr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBJR w - - 0 1';
    const run = async () => {
      await engine.newGame('acc8k2');
      return [await engine.candidates(fen, 8), await engine.candidates(fen, 8, { fen, moves: ['e2e4'] })];
    };
    expect(await run()).toEqual(await run());
    engine.terminate();
  });
});
