import { beforeAll, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import { makePiece, type PieceType, type Square } from './pieces';
import { mirror, placementFen, startPosition } from './position';

beforeAll(loadRulesForNode);

const sq = (file: number, rank: number): Square => ({ file, rank });
const piece = (type: PieceType, file: number, rank: number) => makePiece(type, sq(file, rank));

describe('placementFen', () => {
  it('puts the player as white and mirrors the AI as black', () => {
    const fen = placementFen([piece('K', 4, 0), piece('P', 0, 1)], [piece('K', 4, 0), piece('N', 1, 2)]);
    expect(fen).toBe('4k3/8/1n6/8/8/8/P7/4K3');
  });

  it('skips benched pieces', () => {
    expect(placementFen([piece('K', 0, 0), makePiece('Q')], [piece('K', 7, 0)])).toBe('7k/8/8/8/8/8/8/K7');
  });

  it('mirror flips ranks only', () => {
    expect(mirror(sq(2, 0))).toEqual(sq(2, 7));
    expect(mirror(sq(5, 2))).toEqual(sq(5, 5));
  });
});

describe('startPosition', () => {
  it('has no castling or en passant rights', () => {
    const start = startPosition([piece('K', 4, 0)], [piece('K', 4, 0)], false);
    expect(start.ok && start.fen.endsWith(' - - 0 1')).toBe(true);
  });

  it('lets the player move first only when asked to', () => {
    expect(startPosition([piece('K', 0, 0)], [piece('K', 7, 0)], true)).toMatchObject({ ok: true, firstMover: 'w' });
    const second = startPosition([piece('K', 0, 0)], [piece('K', 7, 0)], false);
    expect(second).toMatchObject({ ok: true, firstMover: 'b' });
    expect(second.ok && second.fen.split(' ')[1]).toBe('b');
  });

  it('lets a king in check move first', () => {
    // AI rook on e6 (AI-local e3) checks the white king on e1 down the open file.
    const start = startPosition([piece('K', 4, 0)], [piece('K', 0, 0), piece('R', 4, 2)], false);
    expect(start).toMatchObject({ ok: true, firstMover: 'w' });
  });

  it('rejects positions where both kings start in check', () => {
    // Player rook a3 checks the AI king on a8; AI rook e6 checks the player king on e1.
    const start = startPosition([piece('K', 4, 0), piece('R', 0, 2)], [piece('K', 0, 0), piece('R', 4, 2)], false);
    expect(start).toEqual({ ok: false, reason: 'both-in-check' });
  });
});
