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

  it('moves the newer fusions as defined (Dragon King, Dragon Horse, Wildebeest, Siege Cannon)', () => {
    const moves = (fen: string, from: string) =>
      new Game(BOARD_8, fen)
        .legalMoves()
        .filter((m) => m.startsWith(from))
        .map((m) => m.slice(from.length));
    // Dragon King on d4: rook lines plus the four diagonal steps.
    const dragonKing = moves('7k/8/8/8/3D4/8/8/K7 w - - 0 1', 'd4');
    expect(dragonKing).toEqual(expect.arrayContaining(['d8', 'a4', 'h4', 'c3', 'e5']));
    expect(dragonKing).not.toContain('b2');
    // Dragon Horse on d4: bishop lines plus the four straight steps.
    const dragonHorse = moves('7k/8/8/8/3H4/8/8/K7 w - - 0 1', 'd4');
    expect(dragonHorse).toEqual(expect.arrayContaining(['g7', 'd5', 'c4']));
    expect(dragonHorse).not.toContain('d6');
    // Wildebeest on d4: knight and camel jumps.
    expect(moves('7k/8/8/8/3U4/8/8/K7 w - - 0 1', 'd4')).toEqual(expect.arrayContaining(['e6', 'e7', 'g5']));
    // Siege Cannon on d1: captures the queen only by jumping the pawn on d4.
    const cannon = moves('3q3k/8/8/8/3P4/8/8/K2S4 w - - 0 1', 'd1');
    expect(cannon).toContain('d8');
    expect(cannon).not.toContain('d5');
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
  it('grows 5→6→7→8→9 every two rounds and stays at 9×9', async () => {
    const { boardForRound, plyLimit, homeSquares, pawnSquares } = await import('./boardSpec');
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 25].map((r) => boardForRound(r).files)).toEqual([5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
    expect(boardForRound(1).homeRows).toBe(2);
    expect(boardForRound(7).homeRows).toBe(3);
    expect(BOARDS.map(plyLimit)).toEqual([60, 70, 80, 90, 100]);
    expect(BOARD_8.files).toBe(8);
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

  it('jumps the Stackman to any square up to two away, over pieces in between', () => {
    const moves = (fen: string) =>
      new Game(BOARD_8, fen)
        .legalMoves()
        .filter((m) => m.startsWith('d4'))
        .map((m) => m.slice(2));
    // Alone on d4: every square of the 5×5 box around it (24), nothing further.
    const box = ['b', 'c', 'd', 'e', 'f'].flatMap((f) => [2, 3, 4, 5, 6].map((r) => f + r)).filter((s) => s !== 'd4');
    const open = moves('7k/8/8/8/3Y4/8/8/K7 w - - 0 1');
    expect(open.sort()).toEqual(box.sort());
    // Its own pawn on d5 can't be taken, but d6 beyond it is still in reach (a jump, not a slide).
    const jumping = moves('7k/8/8/3P4/3Y4/8/8/K7 w - - 0 1');
    expect(jumping).not.toContain('d5');
    expect(jumping).toContain('d6');
    expect(jumping).not.toContain('d7');
  });

  it('plays two kings (an Heir) by the Spartan rules: either can be taken, the last can be mated', () => {
    // White's King (a1) and Heir (h1); the King is attacked by a rook: not check, and Black may take it.
    const twoKings = new Game(BOARD_8, 'r6k/8/8/8/8/8/8/K6J w - - 0 1');
    expect(twoKings.variant).toBe('acc8k2');
    expect(twoKings.isCheck()).toBe(false);
    expect(twoKings.legalMoves()).toContain('h1h2');
    twoKings.delete();
    const capture = new Game(BOARD_8, 'r6k/8/8/8/8/8/8/K6J b - - 0 1');
    expect(capture.legalMoves()).toContain('a8a1');
    expect(capture.play('a8a1')).not.toBeNull();
    // Only the Heir left: it's the king now. Here it's in check and must deal with it.
    expect(capture.isCheck()).toBe(true);
    capture.delete();
    // Taking the Heir instead leaves the King royal, in check the same way.
    const heirTaken = new Game(BOARD_8, 'r6k/8/8/8/8/8/8/J6K b - - 0 1');
    expect(heirTaken.play('a8a1')).not.toBeNull();
    expect(heirTaken.isCheck()).toBe(true);
    heirTaken.delete();
    // The Heir is followed through the moves: shown as J where it stands, gone once captured, back on undo.
    const follow = new Game(BOARD_8, 'r6k/8/8/8/8/8/8/K6J w - - 0 1');
    follow.play('h1g2');
    expect(follow.fen().split(' ')[0]).toBe('r6k/8/8/8/8/8/6J1/K7');
    follow.play('a8g8');
    follow.play('a1b1');
    expect(follow.play('g8g2')).not.toBeNull(); // the rook takes the Heir
    expect(follow.fen().split(' ')[0]).not.toContain('J');
    follow.undo();
    expect(follow.fen().split(' ')[0]).toContain('J');
    follow.delete();
    // Two Heirs (Dynasty): three kings, none royal until one is left; each Heir is followed.
    const three = new Game(BOARD_8, 'r6k/8/8/8/8/8/8/K2J3J b - - 0 1');
    expect(three.variant).toBe('acc8k2');
    expect(three.fen().split(' ')[0]).toBe('r6k/8/8/8/8/8/8/K2J3J');
    expect(three.play('a8a1')).not.toBeNull(); // the King is taken: two Heirs left, neither in check
    expect(three.isCheck()).toBe(false);
    expect(three.play('d1d2')).not.toBeNull();
    expect(three.fen().split(' ')[0]).toBe('7k/8/8/8/8/8/3J4/r6J');
    three.undo();
    expect(three.fen().split(' ')[0]).toBe('7k/8/8/8/8/8/8/r2J3J');
    three.delete();
    // Both attacked at once isn't check (let alone mate): one of them has to be captured first.
    const both = new Game(BOARD_8, '7k/8/8/8/8/8/8/K2r3J w - - 0 1'); // the rook on d1 attacks both
    expect(both.isCheck()).toBe(false);
    expect(both.terminal()).toBeNull();
    both.delete();
    // A single-king game is still plain chess, on the plain variant.
    expect(new Game(BOARD_8, '7k/8/8/8/8/8/8/K7 w - - 0 1').variant).toBe('acc8');
  });

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
