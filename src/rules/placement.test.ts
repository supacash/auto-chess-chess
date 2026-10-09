import { describe, expect, it } from 'vitest';
import { makePiece, type Square } from './pieces';
import { armyErrors, canPlace, movePiece, pieceAt } from './placement';

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
});
