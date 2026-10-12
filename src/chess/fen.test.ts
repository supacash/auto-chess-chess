import { describe, expect, it } from 'vitest';
import { material, mirrorFen, mirrorSquare, royalCaptured } from './fen';

describe('mirrorFen', () => {
  it('reverses ranks, swaps colours and the side to move, and keeps files', () => {
    expect(mirrorFen('4k3/p7/8/8/8/8/1P6/R3K3 w - - 0 1', 8)).toBe('r3k3/1p6/8/8/8/8/P7/4K3 b - - 0 1');
  });

  it('undoes itself and keeps material per side swapped', () => {
    const fen = 'r1k2/1p3/5/1PN2/2K2 b - - 0 1';
    expect(mirrorFen(mirrorFen(fen, 5), 5)).toBe(fen);
    const m = material(fen);
    expect(material(mirrorFen(fen, 5))).toEqual({ w: m.b, b: m.w });
  });

  it('mirrors square names', () => {
    expect(mirrorSquare('e2', 8)).toBe('e7');
    expect(mirrorSquare('a1', 5)).toBe('a5');
  });
});

describe('royalCaptured', () => {
  it('reports a captured King or Heir, and nothing for other captures', () => {
    expect(royalCaptured('r6k/8/8/8/8/8/8/K6J b - - 0 1', '7k/8/8/8/8/8/8/r6J w - - 0 1')).toEqual({
      side: 'w',
      lost: 'King',
    });
    expect(royalCaptured('r6k/8/8/8/8/8/8/J6K b - - 0 1', '7k/8/8/8/8/8/8/r6K w - - 0 1')).toEqual({
      side: 'w',
      lost: 'Heir',
    });
    expect(royalCaptured('j6k/8/8/8/8/8/8/R6K w - - 0 1', 'R6k/8/8/8/8/8/8/7K b - - 0 1')).toEqual({
      side: 'b',
      lost: 'Heir',
    });
    expect(royalCaptured('r6k/8/8/8/8/8/8/R6K w - - 0 1', 'R6k/8/8/8/8/8/8/7K b - - 0 1')).toBeNull();
  });
});
