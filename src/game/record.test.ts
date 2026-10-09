import { describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { makePiece } from '../rules/pieces';
import { type BattleRecord, parseRecord, RECORD_FORMAT, recordBoard } from './record';
import { snapshotArmy } from './snapshot';
import { RULES_VERSION } from './version';

const record = (): BattleRecord => ({
  format: RECORD_FORMAT,
  rules: RULES_VERSION,
  board: 'acc8',
  round: 2,
  fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  seed: 123,
  manual: false,
  moves: ['e1d1', 'e8d8'],
  evals: [10, null],
  result: { winner: 'draw', reason: 'insufficient', material: { w: 0, b: 0 }, plies: 2 },
  player: snapshotArmy([makePiece('K', { file: 4, rank: 0 })], BOARD_8, { mode: 'classic', round: 2, fairy: true }),
});

describe('battle records', () => {
  it('round-trip through JSON', () => {
    const r = record();
    expect(parseRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(recordBoard(r)).toBe(BOARD_8);
  });

  it('reject malformed data', () => {
    const r = record();
    const bad: unknown[] = [
      null,
      { ...r, format: 2 },
      { ...r, board: 'acc9' },
      { ...r, moves: ['e1d1', 'rm -rf'] },
      { ...r, evals: [1, 2, 3] },
      { ...r, evals: ['x'] },
      { ...r, seed: -1 },
      { ...r, result: { ...r.result, winner: 'me' } },
      { ...r, result: { ...r.result, reason: 'boredom' } },
      { ...r, player: { ...r.player, pieces: [] } },
    ];
    for (const data of bad) expect(parseRecord(data)).toBeNull();
  });
});
