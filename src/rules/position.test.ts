import { beforeAll, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import { makePiece, type PieceType, type Square } from './pieces';
import { BOARD_8 } from '../chess/boardSpec';
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

describe('startPosition with synergies', () => {
  // Three Knights for the player (Cavalry), two Cannons for the AI (Siege).
  const player = () => [piece('K', 4, 0), piece('N', 1, 0), piece('N', 6, 0), piece('N', 3, 1)];
  const ai = () => [piece('K', 4, 0), piece('X', 0, 0), piece('X', 7, 1)];

  it('upgrades both armies, and says what it upgraded and how they were placed', () => {
    const start = startPosition(player(), ai(), true, BOARD_8, true);
    if (!start.ok) throw new Error('expected a legal start');
    // The front Knight (d2) fights as a Centaur; the AI's front Cannon (h7) as a Siege Cannon.
    expect(start.fen).toBe('x3k3/7s/8/8/8/8/3T4/1N2K1N1 w - - 0 1');
    expect(start.synergies?.before).toBe('x3k3/7x/8/8/8/8/3N4/1N2K1N1');
    expect(start.synergies?.upgrades.map((u) => [u.side, u.from, u.to, u.square])).toEqual([
      ['w', 'N', 'T', { file: 3, rank: 1 }],
      ['b', 'X', 'S', { file: 7, rank: 6 }],
    ]);
  });

  it('changes nothing when off', () => {
    const start = startPosition(player(), ai(), true, BOARD_8);
    expect(start).toEqual({ ok: true, fen: 'x3k3/7x/8/8/8/8/3N4/1N2K1N1 w - - 0 1', firstMover: 'w' });
  });

  it('lets a king that an upgrade puts in check move first', () => {
    // The AI's two Cannons give it Siege: the front one (f6) fights as a Siege Cannon and, with the b2
    // pawn as its screen, checks the king on a1 down the long diagonal. As a Cannon it doesn't.
    const mine = [piece('K', 0, 0), piece('P', 1, 1)];
    const theirs = [piece('K', 7, 0), piece('X', 5, 2), piece('X', 0, 0)];
    expect(startPosition(mine, theirs, false, BOARD_8)).toMatchObject({ ok: true, firstMover: 'b' });
    expect(startPosition(mine, theirs, false, BOARD_8, true)).toMatchObject({ ok: true, firstMover: 'w' });
  });
});
