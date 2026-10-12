import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { loadRulesForNode } from '../chess/testRules';
import { makePiece, type PieceType } from '../rules/pieces';
import { ACHIEVEMENTS, armyAchievements, battleAchievements, CROWD, mergeAchievements } from './achievements';
import { emptyRecords, parseRecords, recordAchievements } from './records';
import { mergeRecords } from './recordsSync';

beforeAll(loadRulesForNode);

/** `n` pieces of `types` (cycled) on the board, plus a king. */
const army = (types: PieceType[], n: number, benched = 0) => [
  makePiece('K', { file: 4, rank: 0 }),
  ...Array.from({ length: n }, (_, i) =>
    makePiece(types[i % types.length], { file: i % 8, rank: 1 + Math.floor(i / 8) }),
  ),
  ...Array.from({ length: benched }, () => makePiece(types[0])),
];

describe('achievements', () => {
  it('have unique ids', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('count a family on the board, fusions included, and not the bench', () => {
    expect(armyAchievements(army(['N'], CROWD))).toEqual(['cavalry']);
    expect(armyAchievements(army(['N', 'A', 'T', 'U'], CROWD))).toContain('cavalry');
    expect(armyAchievements(army(['B', 'A', 'H', 'S'], CROWD))).toContain('vatican');
    expect(armyAchievements(army(['N'], CROWD - 1, 5))).toEqual([]); // the bench doesn't count
    expect(armyAchievements(army(['Q', 'Z'], CROWD))).toEqual(['solomon']);
    expect(armyAchievements(army(['P', 'E'], CROWD))).toEqual(['pawns']);
    expect(armyAchievements(army(['D', 'H'], 2))).toEqual(['dragons']);
  });

  it('come from merges: a Rook from rook-pawns, a Stackman, an Heir (and a second one)', () => {
    expect(mergeAchievements('R', [])).toEqual(['boulder']);
    expect(mergeAchievements('Y', [])).toEqual(['stackman']);
    expect(mergeAchievements('J', [makePiece('J')])).toEqual(['son']);
    expect(mergeAchievements('J', [makePiece('J'), makePiece('J')])).toEqual(['son', 'secondSon']);
    expect(mergeAchievements('Q', [])).toEqual([]);
  });

  it('spot Holy Diver: a bishop takes in a corner from the opposite corner, for the right side', () => {
    const fen = 'k6r/8/8/8/8/8/8/B5K1 w - - 0 1';
    expect(battleAchievements(fen, ['a1h8'], BOARD_8, 'w')).toEqual(['holyDiver']);
    expect(battleAchievements(fen, ['a1h8'], BOARD_8, 'b')).toEqual([]);
    // Not from a corner, or not a capture: no.
    expect(battleAchievements('k6r/8/8/8/8/8/1B6/6K1 w - - 0 1', ['b2h8'], BOARD_8, 'w')).toEqual([]);
    expect(battleAchievements('k7/8/8/8/8/8/8/B5K1 w - - 0 1', ['a1h8'], BOARD_8, 'w')).toEqual([]);
  });

  it('are kept in the records once, from the first time, and merge across devices', () => {
    const first = recordAchievements(emptyRecords(), ['cavalry', 'cavalry'], 100);
    expect(first.unlocked).toEqual(['cavalry']);
    const again = recordAchievements(first.records, ['cavalry', 'wall'], 200);
    expect(again.unlocked).toEqual(['wall']);
    expect(again.records.achievements).toEqual({ cavalry: 100, wall: 200 });
    expect(parseRecords(JSON.parse(JSON.stringify(again.records))).achievements).toEqual({ cavalry: 100, wall: 200 });
    expect(parseRecords({ ...again.records, achievements: { nope: 1, wall: -5 } }).achievements).toEqual({});
    const cloud = { ...emptyRecords(), achievements: { cavalry: 50, son: 300 } };
    expect(mergeRecords(cloud, again.records, emptyRecords()).achievements).toEqual({
      cavalry: 50,
      wall: 200,
      son: 300,
    });
  });
});
