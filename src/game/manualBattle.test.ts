import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { loadRulesForNode } from '../chess/testRules';
import { positionCommand } from '../engine/pick';
import { seededRng } from '../rules/rng';
import { ManualBattle } from './manualBattle';
import type { MoveSource } from './runBattle';

beforeAll(loadRulesForNode);

const START = '4k3/p7/8/8/8/8/P7/4K3 w - - 0 1';

describe('ManualBattle', () => {
  it('lists the player’s legal moves by square, only on their turn', () => {
    const b = new ManualBattle(START, BOARD_8);
    const legal = b.legalMoves();
    expect(legal.get('a2')?.sort()).toEqual(['a2a3', 'a2a4']);
    expect(legal.get('e1')).toHaveLength(5);
    expect(b.playerMove('a2a5')).toBeNull();
    expect(b.playerMove('a2a4')).not.toBeNull();
    expect(b.legalMoves().size).toBe(0);
    expect(b.playerMove('e1d1')).toBeNull(); // not the player's turn
    b.delete();
  });

  it('asks the engine for the opponent’s move with the whole game so far', async () => {
    const commands: string[] = [];
    const engine: MoveSource = {
      newGame: async () => {},
      candidates: async (fen, _d, history) => {
        commands.push(positionCommand(fen, history));
        return [{ move: 'e8d8', score: 0 }];
      },
    };
    const b = new ManualBattle(START, BOARD_8);
    b.playerMove('e1d1');
    const move = await b.opponentMove(engine, seededRng(1));
    expect(move.uci).toBe('e8d8');
    expect(commands).toEqual([`position fen ${START} moves e1d1`]);
    expect(b.state).toEqual({ fen: START, moves: ['e1d1', 'e8d8'] });
    b.delete();
  });

  it('falls back to a random legal move when the engine has none', async () => {
    const silent: MoveSource = { newGame: async () => {}, candidates: async () => [] };
    const b = new ManualBattle(START, BOARD_8, ['e1d1']);
    await b.opponentMove(silent, seededRng(2));
    expect(b.moves).toHaveLength(2);
    expect(b.playerToMove).toBe(true);
    b.delete();
  });

  it('undoes the player’s move and the reply, and never past the player’s first move', () => {
    // The opponent moved first here.
    const b = new ManualBattle('4k3/p7/8/8/8/8/P7/4K3 b - - 0 1', BOARD_8, ['e8d8']);
    expect(b.canUndo()).toBe(false);
    b.playerMove('e1d1');
    expect(b.canUndo()).toBe(true);
    b.undo();
    expect(b.moves).toEqual(['e8d8']);
    b.playerMove('e1f1');
    // Simulate the reply, then undo both.
    const resumed = new ManualBattle(b.start, BOARD_8, [...b.moves, 'd8c8']);
    resumed.undo();
    expect(resumed.moves).toEqual(['e8d8']);
    expect(resumed.playerToMove).toBe(true);
    b.delete();
    resumed.delete();
  });

  it('resumes a saved game and rejects an illegal saved move', () => {
    const b = new ManualBattle(START, BOARD_8, ['a2a4', 'a7a5']);
    expect(b.fen.startsWith('4k3/8/8/p7/P7/8/8/4K3 w')).toBe(true);
    b.delete();
    expect(() => new ManualBattle(START, BOARD_8, ['a2a5'])).toThrow();
  });

  it('has no move limit, ends on the board, and resigning loses', () => {
    const mate = new ManualBattle('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', BOARD_8);
    expect(mate.result()).toBeNull();
    mate.playerMove('a1a8');
    expect(mate.result()).toMatchObject({ winner: 'w', reason: 'checkmate' });
    expect(mate.canUndo()).toBe(false);
    mate.delete();
    const b = new ManualBattle(START, BOARD_8);
    expect(b.resign()).toMatchObject({ winner: 'b', reason: 'resign' });
    expect(b.legalMoves().size).toBe(0);
    b.delete();
  });
});
