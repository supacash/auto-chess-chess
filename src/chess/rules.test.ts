import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_8, BOARDS, parseSquare, squareName, variantsIni } from './boardSpec';
import { fenTurn, material, parsePlacement, placementField } from './fen';
import { Game, kingInCheck, parseUci } from './rules';
import { loadRulesForNode } from './testRules';

beforeAll(loadRulesForNode);

const board5 = BOARDS[0];

describe('boardSpec', () => {
  it('names squares on any size', () => {
    expect(squareName(0, 0)).toBe('a1');
    expect(squareName(9, 9)).toBe('j10');
    expect(parseSquare('j10')).toEqual({ file: 9, rank: 9 });
  });

  it('defines every board as a variant', () => {
    const ini = variantsIni();
    for (const b of BOARDS) expect(ini).toContain(`[${b.variant}:chess]`);
    expect(ini).toContain('doubleStepRegionBlack = *4'); // 5×5
  });
});

describe('fen', () => {
  it('round-trips placement and counts material', () => {
    const fen = '4k/5/5/PP3/K3R w - - 0 1';
    const rows = parsePlacement(fen, 5);
    expect(rows).toHaveLength(5);
    expect(rows[4][4]).toEqual({ type: 'R', color: 'w' });
    const grid = [...rows].reverse();
    expect(placementField(grid)).toBe('4k/5/5/PP3/K3R');
    expect(material(fen)).toEqual({ w: 7, b: 0 });
    expect(fenTurn(fen)).toBe('w');
  });

  it('reads multi-digit empty runs', () => {
    expect(parsePlacement('10/k8K', 10)[0]).toHaveLength(10);
  });
});

describe('Game', () => {
  it('plays legal moves and rejects illegal ones on 8×8', () => {
    const g = new Game(BOARD_8, '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    expect(g.play('e2e4')).toEqual({ uci: 'e2e4', from: 'e2', to: 'e4' });
    expect(g.turn()).toBe('b');
    expect(g.play('e8e6')).toBeNull();
    g.delete();
  });

  it('has no castling even with rooks and king on their home squares', () => {
    const g = new Game(BOARD_8, '4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(g.legalMoves()).not.toContain('e1g1');
    expect(g.legalMoves()).not.toContain('e1c1');
    g.delete();
  });

  it('allows a pawn two-step from the second rank on small boards, for both sides', () => {
    const w = new Game(board5, '4k/p4/5/P4/4K w - - 0 1');
    expect(w.legalMoves()).toContain('a2a3');
    w.delete();
    const b = new Game(board5, '4k/p4/5/5/4K b - - 0 1');
    expect(b.legalMoves()).toContain('a4a2');
    b.delete();
  });

  it('promotes on the last rank of a small board', () => {
    const g = new Game(board5, '4k/P4/5/5/4K w - - 0 1');
    expect(g.legalMoves()).toContain('a4a5q');
    g.delete();
  });

  it('reports why a game ended', () => {
    const mate = new Game(BOARD_8, 'R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
    expect(mate.terminal()).toBe('checkmate');
    mate.delete();
    const stale = new Game(BOARD_8, '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(stale.terminal()).toBe('stalemate');
    stale.delete();
    const bare = new Game(BOARD_8, '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(bare.terminal()).toBe('insufficient');
    bare.delete();
    const fifty = new Game(BOARD_8, '4k3/8/8/8/8/8/8/R3K3 w - - 100 80');
    expect(fifty.terminal()).toBe('fifty-move');
    fifty.delete();
    const live = new Game(BOARD_8, '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    expect(live.terminal()).toBeNull();
    live.delete();
  });

  it('detects threefold repetition', () => {
    const g = new Game(BOARD_8, '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    for (const m of ['a1a2', 'e8d8', 'a2a1', 'd8e8', 'a1a2', 'e8d8', 'a2a1', 'd8e8']) expect(g.play(m)).not.toBeNull();
    expect(g.terminal()).toBe('repetition');
    g.delete();
  });
});

describe('kingInCheck and parseUci', () => {
  it('checks either king from a bare placement', () => {
    expect(kingInCheck(BOARD_8, '4k3/8/8/8/8/8/8/4R1K1', 'b')).toBe(true);
    expect(kingInCheck(BOARD_8, '4k3/8/8/8/8/8/8/4R1K1', 'w')).toBe(false);
  });

  it('parses promotions and two-digit ranks', () => {
    expect(parseUci('a7a8q')).toEqual({ uci: 'a7a8q', from: 'a7', to: 'a8' });
    expect(parseUci('j9j10')).toEqual({ uci: 'j9j10', from: 'j9', to: 'j10' });
    expect(parseUci('nonsense')).toBeNull();
  });
});

describe('board schedule', () => {
  it('grows 5→6→7→8 every two rounds and stays at 8×8', async () => {
    const { boardForRound, plyLimit, homeSquares, pawnSquares } = await import('./boardSpec');
    expect([1, 2, 3, 4, 5, 6, 7, 12].map((r) => boardForRound(r).files)).toEqual([5, 5, 6, 6, 7, 7, 8, 8]);
    expect(boardForRound(1).homeRows).toBe(2);
    expect(boardForRound(7).homeRows).toBe(3);
    expect(BOARDS.map(plyLimit)).toEqual([60, 70, 80, 90]);
    expect(homeSquares(BOARDS[0])).toBe(10);
    expect(pawnSquares(BOARDS[0])).toBe(5);
    expect(pawnSquares(BOARD_8)).toBe(16);
  });
});

describe('fairy pieces', () => {
  const moves = (fen: string, from: string, spec = BOARD_8) => {
    const g = new Game(spec, fen);
    const out = g
      .legalMoves()
      .filter((m) => m.startsWith(from))
      .sort();
    g.delete();
    return out;
  };

  it('defines every fairy piece for the engine, with the Berolina pawn promoting', () => {
    const ini = variantsIni([BOARD_8]);
    expect(ini).toContain('e:mfFcfWifmnF2');
    expect(ini).toContain('x:mRcpR');
    expect(ini).toContain('promotionPawnTypes = pe');
  });

  it('moves the Berolina pawn diagonally (two-step only from rank 2) and captures straight ahead', () => {
    expect(moves('4k3/8/8/8/8/8/3E4/4K3 w - - 0 1', 'd2')).toEqual(['d2b4', 'd2c3', 'd2e3', 'd2f4']);
    expect(moves('4k3/8/8/8/8/3E4/8/4K3 w - - 0 1', 'd3')).toEqual(['d3c4', 'd3e4']);
    expect(moves('4k3/8/8/3p4/3E4/8/8/4K3 w - - 0 1', 'd4')).toEqual(['d4c5', 'd4d5', 'd4e5']);
    expect(moves('2k2/E4/5/5/2K2 w - - 0 1', 'a4', BOARDS[0])).toContain('a4b5q');
  });

  it('moves the short-range and leaping pieces', () => {
    expect(moves('4k3/8/8/8/3F4/8/8/4K3 w - - 0 1', 'd4')).toEqual(['d4c3', 'd4c5', 'd4e3', 'd4e5']);
    expect(moves('4k3/8/8/8/3W4/8/8/4K3 w - - 0 1', 'd4')).toEqual(['d4c4', 'd4d3', 'd4d5', 'd4e4']);
    expect(moves('4k3/8/8/8/3M4/8/8/4K3 w - - 0 1', 'd4')).toHaveLength(8);
    expect(moves('4k3/8/8/8/3L4/8/8/7K w - - 0 1', 'd4')).toEqual([
      'd4a3',
      'd4a5',
      'd4c1',
      'd4c7',
      'd4e1',
      'd4e7',
      'd4g3',
      'd4g5',
    ]);
  });

  it('hops the Grasshopper over a piece and captures with the Cannon only over a screen', () => {
    expect(moves('4k3/8/8/8/2PGP3/8/8/4K3 w - - 0 1', 'd4')).toEqual(['d4b4', 'd4f4']);
    const cannon = moves('3k4/3p4/8/8/3P4/8/8/3XK3 w - - 0 1', 'd1');
    expect(cannon).toContain('d1d7'); // over the screen on d4
    expect(cannon).not.toContain('d1d4');
  });

  it('combines moves for the fusion pieces', () => {
    expect(moves('4k3/8/8/8/3T4/8/8/4K3 w - - 0 1', 'd4')).toHaveLength(16); // king 8 + knight 8
    expect(moves('7k/8/8/8/3A4/8/8/K7 w - - 0 1', 'd4')).toHaveLength(20); // bishop 13 (a1 has its king) − 1 + knight 8
    expect(moves('7k/8/8/8/3C4/8/8/K7 w - - 0 1', 'd4')).toHaveLength(22); // rook 14 + knight 8
    expect(moves('7k/8/8/8/3Z4/8/8/K7 w - - 0 1', 'd4').length).toBeGreaterThan(30);
  });
});
