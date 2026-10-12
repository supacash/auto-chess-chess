import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_8, BOARDS } from '../chess/boardSpec';
import { loadRulesForNode } from '../chess/testRules';
import { makePiece, type PieceType } from '../rules/pieces';
import {
  ACHIEVEMENTS,
  armyAchievements,
  battleAchievements,
  collectionAchievements,
  CROWD,
  FUSION_RESULTS,
  HOARD_GOLD,
  runAchievements,
  matchAchievements,
  mergeAchievements,
  SHOP_FAIRY,
  SHOPAHOLIC_REROLLS,
  shopAchievements,
} from './achievements';
import type { BattleResult } from '../rules/battle';
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
    expect(armyAchievements(army(['Q', 'Z'], CROWD))).toEqual(['solomon', 'absoluteUnit']); // 120+ points too
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

  // A battle's facts, with a draw on the board by default.
  const facts = (
    fen: string,
    moves: string[],
    side: 'w' | 'b' = 'w',
    over: Partial<BattleResult> = {},
    worstDeficit = 0,
  ) => ({
    fen,
    moves,
    spec: BOARD_8,
    side,
    result: { winner: 'draw' as const, reason: 'move-limit' as const, material: { w: 0, b: 0 }, plies: 0, ...over },
    worstDeficit,
  });

  it('spot Holy Diver: a bishop takes in a corner from the opposite corner, for the right side', () => {
    const fen = 'k6r/8/8/8/8/8/8/B5K1 w - - 0 1';
    expect(battleAchievements(facts(fen, ['a1h8']))).toContain('holyDiver');
    expect(battleAchievements(facts(fen, ['a1h8'], 'b'))).not.toContain('holyDiver');
    // Not from a corner, or not a capture: no.
    expect(battleAchievements(facts('k6r/8/8/8/8/8/1B6/6K1 w - - 0 1', ['b2h8']))).not.toContain('holyDiver');
    expect(battleAchievements(facts('k7/8/8/8/8/8/8/B5K1 w - - 0 1', ['a1h8']))).not.toContain('holyDiver');
  });

  it('spot the battle feats: David and Goliath, Comeback Kid, Photo Finish, Pawn Storm, Royal Wedding, Long Live the King', () => {
    const win = (reason: BattleResult['reason'], material = { w: 0, b: 0 }) => ({
      winner: 'w' as const,
      reason,
      material,
    });
    // A lone rook (5) against two queens (18) and won.
    expect(battleAchievements(facts('k2qq3/8/8/8/8/8/8/R5K1 w - - 0 1', [], 'w', win('checkmate')))).toContain(
      'davidGoliath',
    );
    expect(battleAchievements(facts('7k/8/8/8/8/8/8/R5K1 w - - 0 1', [], 'w', win('checkmate'), 12))).toContain(
      'comeback',
    );
    expect(
      battleAchievements(facts('7k/8/8/8/8/8/8/R5K1 w - - 0 1', [], 'w', win('move-limit', { w: 6, b: 5 }))),
    ).toContain('photoFinish');
    // A pawn promotes, and the last move (by the pawn) mates.
    const promo = battleAchievements(facts('k7/7P/8/8/8/8/8/6K1 w - - 0 1', ['h7h8q'], 'w', win('checkmate')));
    expect(promo).toContain('royalWedding');
    expect(promo).toContain('pawnStorm');
    // The King falls, the Heir carries on and wins.
    const heir = battleAchievements(facts('r6k/8/8/8/8/8/8/K6J b - - 0 1', ['a8a1'], 'w', win('checkmate')));
    expect(heir).toContain('longLive');
    // A draw earns none of them.
    expect(battleAchievements(facts('k2qq3/8/8/8/8/8/8/R5K1 w - - 0 1', [], 'w', {}, 20))).toEqual([]);
  });

  it('come from the shop, the army and the match', () => {
    expect(shopAchievements(HOARD_GOLD, 0)).toEqual(['hoarder']);
    expect(shopAchievements(0, SHOPAHOLIC_REROLLS)).toEqual(['shopaholic']);
    expect(armyAchievements(army(['L', 'U', 'T'], 3))).toContain('barnyard');
    expect(armyAchievements(army(['Z'], 10))).toContain('absoluteUnit'); // 10 Amazons: 120 points
    expect(armyAchievements(army(['Q'], 13))).not.toContain('absoluteUnit'); // 13 Queens: 117 points
    // A full 5×5 home (two rows of five, the army cap): All Hands on Deck.
    const five = BOARDS[0];
    const full = [
      makePiece('K', { file: 2, rank: 0 }),
      ...[0, 1, 3, 4].map((f) => makePiece('N', { file: f, rank: 0 })),
      ...[0, 1, 2, 3, 4].map((f) => makePiece('P', { file: f, rank: 1 })),
    ];
    expect(armyAchievements(full, five)).toContain('allHands');
    expect(armyAchievements(full.slice(1), five)).not.toContain('allHands');
    expect(matchAchievements(1, 0, 20)).toEqual(['lastStanding', 'untouchable']);
    expect(matchAchievements(1, 2, 20)).toEqual(['lastStanding']);
    expect(matchAchievements(2, 3, 1)).toEqual(['kingmaker']);
  });

  it('complete the career collections once every piece is in', () => {
    expect(collectionAchievements({ fielded: SHOP_FAIRY, fused: [] })).toEqual(['zooKeeper']);
    expect(collectionAchievements({ fielded: SHOP_FAIRY.slice(1), fused: FUSION_RESULTS })).toEqual(['fusionChef']);
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

describe('run achievements', () => {
  const settings = {
    mode: 'classic',
    difficulty: 'hard',
    reveal: false,
    side: 'white',
    fairy: false,
    manual: false,
  } as const;

  it('Warlord: a won run on Hard without the board reveal, standard or fairy pieces, any board', () => {
    expect(runAchievements(true, 3, settings)).toEqual(['warlord']);
    expect(runAchievements(true, 0, { ...settings, fairy: true, mode: 'growing' })).toEqual(['undefeated', 'warlord']);
    expect(runAchievements(true, 1, { ...settings, reveal: true })).toEqual([]);
    expect(runAchievements(true, 1, { ...settings, difficulty: 'normal' })).toEqual([]);
    expect(runAchievements(false, 0, settings)).toEqual([]);
  });
});
