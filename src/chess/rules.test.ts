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
