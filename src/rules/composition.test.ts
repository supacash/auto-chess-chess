import { describe, expect, it } from 'vitest';
import { fitsEngine, pawnSlots } from './composition';
import type { PieceType } from './pieces';

const army = (s: string) => s.split('') as PieceType[];

describe('pawnSlots', () => {
  it('counts pawns', () => {
    expect(pawnSlots(army('KPPP'))).toBe(3);
  });

  it('allows the standard set of pieces for free', () => {
    expect(pawnSlots(army('KQRRBBNN'))).toBe(0);
  });

  it('counts pieces beyond 2 N/B/R and 1 Q as promoted pawns', () => {
    expect(pawnSlots(army('KBBB'))).toBe(1);
    expect(pawnSlots(army('KQQQ'))).toBe(2);
    expect(pawnSlots(army('KNNNRRRR'))).toBe(3);
    expect(pawnSlots(army('KPPPPPPPBBBB'))).toBe(9);
  });
});

describe('fitsEngine', () => {
  it('accepts up to 8 slots and rejects more', () => {
    expect(fitsEngine(army('KPPPPPPPP'))).toBe(true);
    expect(fitsEngine(army('KPPPPPPPBBB'))).toBe(true);
    expect(fitsEngine(army('KPPPPPPPBBBB'))).toBe(false);
    expect(fitsEngine(army('KQQQQQQQQQQ'))).toBe(false);
  });
});
