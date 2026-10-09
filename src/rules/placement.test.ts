import { describe, expect, it } from 'vitest';
import { BOARD_8, BOARDS } from '../chess/boardSpec';
import { makePiece, type Square } from './pieces';
import { armyCap, armyErrors, BENCH_SIZE, canPlace, capacityError, fitToBoard, movePiece, pieceAt } from './placement';

const sq = (file: number, rank: number): Square => ({ file, rank });

describe('canPlace', () => {
  it('allows only the three home ranks', () => {
    expect(canPlace('N', sq(0, 0))).toBe(true);
    expect(canPlace('N', sq(7, 2))).toBe(true);
    expect(canPlace('N', sq(3, 3))).toBe(false);
    expect(canPlace('N', sq(8, 0))).toBe(false);
    expect(canPlace('N', sq(0, -1))).toBe(false);
  });

  it('keeps the king off the front row', () => {
    expect(canPlace('K', sq(4, 2))).toBe(false);
    expect(canPlace('K', sq(4, 1))).toBe(true);
    expect(canPlace('K', sq(4, 0))).toBe(true);
  });

  it('keeps pawns off the back row', () => {
    expect(canPlace('P', sq(4, 0))).toBe(false);
    expect(canPlace('P', sq(4, 1))).toBe(true);
    expect(canPlace('P', sq(4, 2))).toBe(true);
  });
});

describe('movePiece', () => {
  it('places a bench piece on an empty square', () => {
    const n = makePiece('N');
    const result = movePiece([n], n.id, sq(1, 0));
    expect(result?.[0].square).toEqual(sq(1, 0));
  });

  it('rejects illegal squares', () => {
    const k = makePiece('K');
    expect(movePiece([k], k.id, sq(4, 2))).toBeNull();
  });

  it('swaps two board pieces', () => {
    const a = makePiece('N', sq(0, 0));
    const b = makePiece('B', sq(1, 1));
    const result = movePiece([a, b], a.id, sq(1, 1))!;
    expect(pieceAt(result, sq(1, 1))?.id).toBe(a.id);
    expect(pieceAt(result, sq(0, 0))?.id).toBe(b.id);
  });

  it('rejects a swap that would put the displaced piece somewhere illegal', () => {
    const pawn = makePiece('P', sq(0, 2));
    const rook = makePiece('R', sq(0, 0));
    // Rook moves onto the pawn: the pawn would land on the back row.
    expect(movePiece([pawn, rook], rook.id, sq(0, 2))).toBeNull();
  });

  it('sends the displaced piece to the bench when the mover came from the bench', () => {
    const placed = makePiece('N', sq(0, 0));
    const bench = makePiece('B');
    const result = movePiece([placed, bench], bench.id, sq(0, 0))!;
    expect(pieceAt(result, sq(0, 0))?.id).toBe(bench.id);
    expect(result.find((p) => p.id === placed.id)?.square).toBeNull();
  });

  it('moves a piece back to the bench', () => {
    const n = makePiece('N', sq(0, 0));
    expect(movePiece([n], n.id, null)?.[0].square).toBeNull();
  });
});

describe('armyErrors', () => {
  it('requires a placed king', () => {
    expect(armyErrors([makePiece('P', sq(0, 1))])).toContain('Army must have exactly one king');
    expect(armyErrors([makePiece('K')])).toContain('Place your king on the board');
  });

  it('accepts a valid army with benched pieces', () => {
    expect(armyErrors([makePiece('K', sq(4, 0)), makePiece('P', sq(4, 1)), makePiece('Q')])).toEqual([]);
  });

  it('flags overlapping and illegal pieces', () => {
    const errs = armyErrors([makePiece('K', sq(4, 2)), makePiece('N', sq(0, 0)), makePiece('B', sq(0, 0))]);
    expect(errs).toContain('Two pieces on a1');
    expect(errs.some((e) => e.startsWith('e3'))).toBe(true);
  });

  it('allows any mix of pieces (Fairy-Stockfish has no piece-count limit)', () => {
    const pawns = Array.from({ length: 8 }, (_, f) => makePiece('P', sq(f, 1)));
    const bishops = [makePiece('B', sq(0, 0)), makePiece('B', sq(1, 0)), makePiece('B', sq(2, 0))];
    expect(armyErrors([makePiece('K', sq(4, 0)), ...pawns, ...bishops])).toEqual([]);
  });
});

describe('small boards', () => {
  const b5 = BOARDS[0]; // 5×5, 2 home rows

  it('uses the board width and its home rows', () => {
    expect(canPlace('N', sq(4, 1), b5)).toBe(true);
    expect(canPlace('N', sq(5, 0), b5)).toBe(false);
    expect(canPlace('N', sq(0, 2), b5)).toBe(false);
    // Rank 1 is the front row on a 2-row board: no king there, pawns only there.
    expect(canPlace('K', sq(2, 1), b5)).toBe(false);
    expect(canPlace('P', sq(2, 1), b5)).toBe(true);
    expect(canPlace('P', sq(2, 0), b5)).toBe(false);
  });

  it('benches pieces that do not fit the board', () => {
    const pieces = [
      makePiece('K', sq(4, 0)),
      makePiece('R', sq(7, 0)),
      makePiece('P', sq(1, 2)),
      makePiece('N', sq(4, 0)),
    ];
    const fitted = fitToBoard(pieces, b5);
    expect(fitted.map((p) => p.square)).toEqual([sq(4, 0), null, null, null]);
    expect(armyErrors(fitted, b5)).toEqual([]);
  });
});

describe('board limit and bench', () => {
  it('allows two pieces per file on the board, within the home squares', () => {
    expect(BOARDS.map(armyCap)).toEqual([10, 12, 14, 16]);
  });

  it('blocks placing past the limit but allows swaps', () => {
    // 8×8 has 24 home squares but a limit of 16. (On the smaller boards the limit is every home square.)
    const placed = [makePiece('K', sq(4, 0))];
    for (const f of [0, 1, 2, 3, 5, 6, 7]) placed.push(makePiece('N', sq(f, 0)));
    for (let f = 0; f < 8; f++) placed.push(makePiece('P', sq(f, 1)));
    expect(placed).toHaveLength(16);
    const extra = makePiece('B');
    const pieces = [...placed, extra];
    expect(capacityError(pieces, extra.id, sq(0, 2), BOARD_8)).toContain('army is full');
    expect(movePiece(pieces, extra.id, sq(0, 2), BOARD_8)).toBeNull();
    // Swapping a benched piece for a placed one keeps the count.
    const swapped = movePiece(pieces, extra.id, sq(1, 0), BOARD_8)!;
    expect(swapped.find((p) => p.id === extra.id)!.square).toEqual(sq(1, 0));
    expect(armyErrors(swapped, BOARD_8)).toEqual([]);
  });

  it('keeps at most BENCH_SIZE pieces on the bench', () => {
    const king = makePiece('K', sq(4, 0));
    const bench = Array.from({ length: BENCH_SIZE }, () => makePiece('P'));
    const pieces = [king, makePiece('R', sq(0, 0)), ...bench];
    const rook = pieces[1];
    expect(capacityError(pieces, rook.id, null)).toContain('bench is full');
    expect(movePiece(pieces, rook.id, null)).toBeNull();
  });

  it('flags an over-full board', () => {
    // 17 pieces on 8×8 (limit 16): a full back row, a full pawn row and one more.
    const pieces = [makePiece('K', sq(4, 0))];
    for (const f of [0, 1, 2, 3, 5, 6, 7]) pieces.push(makePiece('N', sq(f, 0)));
    for (let f = 0; f < 8; f++) pieces.push(makePiece('P', sq(f, 1)));
    expect(armyErrors(pieces, BOARD_8)).toEqual([]);
    pieces.push(makePiece('R', sq(0, 2)));
    expect(armyErrors(pieces, BOARD_8)).toEqual(['Too many pieces on the board (at most 16)']);
  });
});
