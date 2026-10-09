import { describe, expect, it } from 'vitest';
import { BOARD_8, BOARDS } from '../chess/boardSpec';
import { makePiece } from '../rules/pieces';
import { isCurrentRules, parseSnapshot, snapshotArmy, snapshotBoard, snapshotPieces } from './snapshot';
import { RULES_VERSION } from './version';

const army = () => [
  makePiece('K', { file: 4, rank: 0 }),
  makePiece('X', { file: 0, rank: 0 }),
  makePiece('E', { file: 3, rank: 1 }),
  makePiece('Q'), // benched: left out
];

describe('army snapshots', () => {
  it('keeps placed pieces, the board and the rules version', () => {
    const snap = snapshotArmy(army(), BOARD_8, { mode: 'classic', round: 3, fairy: true });
    expect(snap).toMatchObject({ rules: RULES_VERSION, board: 'acc8', round: 3, mode: 'classic', fairy: true });
    expect(snap.pieces).toEqual([
      { type: 'K', file: 4, rank: 0 },
      { type: 'X', file: 0, rank: 0 },
      { type: 'E', file: 3, rank: 1 },
    ]);
    expect(isCurrentRules(snap)).toBe(true);
    expect(snapshotBoard(snap)).toBe(BOARD_8);
  });

  it('round-trips through JSON and back to pieces', () => {
    const snap = snapshotArmy(army(), BOARD_8, { mode: 'classic', round: 3, fairy: true });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).toEqual(snap);
    expect(snapshotPieces(parsed!).map((p) => [p.type, p.square])).toEqual([
      ['K', { file: 4, rank: 0 }],
      ['X', { file: 0, rank: 0 }],
      ['E', { file: 3, rank: 1 }],
    ]);
  });

  it('flags armies from other rules versions', () => {
    const snap = snapshotArmy(army(), BOARD_8, { mode: 'classic', round: 3, fairy: true });
    expect(isCurrentRules({ ...snap, rules: RULES_VERSION + 1 })).toBe(false);
  });

  it('rejects malformed or illegal armies', () => {
    const good = snapshotArmy(army(), BOARD_8, { mode: 'classic', round: 3, fairy: true });
    const bad: unknown[] = [
      null,
      { ...good, format: 2 },
      { ...good, board: 'acc9' },
      { ...good, mode: 'huge' },
      { ...good, pieces: [...good.pieces, { type: 'Y', file: 1, rank: 0 }] },
      { ...good, pieces: good.pieces.filter((p) => p.type !== 'K') }, // no king
      { ...good, pieces: [...good.pieces, { type: 'P', file: 1, rank: 0 }] }, // pawn on the back row
      { ...good, board: BOARDS[0].variant, pieces: [...good.pieces, { type: 'R', file: 7, rank: 0 }] }, // off a 5×5 board
    ];
    for (const data of bad) expect(parseSnapshot(data)).toBeNull();
  });
});
