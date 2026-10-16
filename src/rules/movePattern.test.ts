import { describe, expect, it } from 'vitest';
import { movePattern, type Reach } from './movePattern';
import { PIECE_TYPES, type PieceType } from './pieces';

/** The squares a piece reaches, as "dx,dy" (forward up) with how, centred on a 7×7 board. */
function reach(type: PieceType): Map<string, Reach> {
  const out = new Map<string, Reach>();
  movePattern(type).forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell) out.set(`${c - 3},${3 - r}`, cell);
    });
  });
  return out;
}

describe('movePattern', () => {
  it('draws every piece on a 7×7 board with its own square empty', () => {
    for (const type of PIECE_TYPES) {
      const grid = movePattern(type);
      expect(grid).toHaveLength(7);
      expect(grid.every((row) => row.length === 7)).toBe(true);
      expect(grid[3][3]).toBeNull();
      expect(reach(type).size).toBeGreaterThan(0);
    }
  });

  it('knows the standard pieces', () => {
    expect(reach('N').size).toBe(8);
    expect(reach('N').get('1,2')).toBe('any');
    expect(reach('K').size).toBe(8);
    expect(reach('R').size).toBe(12); // three squares each way on a 7×7 board
    expect(reach('B').size).toBe(12);
    expect(reach('Q').size).toBe(24);
  });

  it('separates a pawn’s moves from its captures, forward only', () => {
    const pawn = reach('P');
    expect(pawn.get('0,1')).toBe('move');
    expect(pawn.get('0,2')).toBe('move'); // its first move
    expect(pawn.get('1,1')).toBe('capture');
    expect(pawn.get('-1,1')).toBe('capture');
    expect(pawn.get('0,-1')).toBeUndefined();
    expect(pawn.size).toBe(4);
  });

  it('turns the Berolina pawn round: diagonal moves, straight captures', () => {
    const berolina = reach('E');
    expect(berolina.get('1,1')).toBe('move');
    expect(berolina.get('-2,2')).toBe('move'); // its first move
    expect(berolina.get('0,1')).toBe('capture');
    expect(berolina.size).toBe(5);
  });

  it('combines a fusion’s parts', () => {
    expect(reach('A').size).toBe(12 + 8); // bishop and knight
    expect(reach('T').size).toBe(8 + 8); // king and knight
    expect(reach('D').size).toBe(12 + 4); // rook and one diagonal step
    expect(reach('H').size).toBe(12 + 4); // bishop and one straight step
    expect(reach('U').size).toBe(8 + 8); // knight and camel
    expect(reach('U').get('3,1')).toBe('any');
  });

  it('lets the Stackman reach every square two away', () => {
    const stackman = reach('Y');
    expect(stackman.size).toBe(24);
    expect([...stackman.values()].every((r) => r === 'any')).toBe(true);
  });

  it('marks the hoppers: Grasshopper landings, Cannon slides', () => {
    const grasshopper = reach('G');
    expect(grasshopper.get('0,1')).toBeUndefined(); // it hops over the piece next to it
    expect(grasshopper.get('0,2')).toBe('hop');
    expect(grasshopper.size).toBe(16);
    expect(reach('X').size).toBe(12);
    expect([...reach('X').values()].every((r) => r === 'move')).toBe(true);
    expect(reach('S').size).toBe(24);
  });
});
