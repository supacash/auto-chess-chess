import { describe, expect, it } from 'vitest';
import { BOARD_8, BOARDS } from '../chess/boardSpec';
import { isPawnLike, makePiece, PIECE_TYPES, PIECE_VALUE, type PieceType } from './pieces';
import {
  applySynergies,
  FAMILIES,
  family,
  familiesOf,
  familyStatus,
  synergyTier,
  synergyUpgrades,
  upgradePoints,
} from './synergy';

const at = (type: PieceType, file: number, rank: number) => makePiece(type, { file, rank });
const names = (types: PieceType[]) => types.map((t) => familiesOf(t).map((f) => f.id));

describe('families', () => {
  it('group pieces by how they move; compounds can count twice', () => {
    expect(names(['P', 'E', 'N', 'T', 'D', 'X', 'S'])).toEqual([
      ['infantry'],
      ['infantry'],
      ['cavalry'],
      ['cavalry', 'guard'],
      ['guard'],
      ['siege'],
      ['siege'],
    ]);
  });

  it('leave out the King, the Heir and the plain sliders', () => {
    expect(names(['K', 'J', 'B', 'R', 'Q'])).toEqual([[], [], [], [], []]);
  });

  it('upgrade only their own members, into stronger non-royal pieces that can stand anywhere', () => {
    const sources = new Set<PieceType>();
    for (const fam of FAMILIES) {
      for (const [from, to] of Object.entries(fam.upgrades) as [PieceType, PieceType][]) {
        expect(fam.members).toContain(from);
        expect(PIECE_VALUE[to]).toBeGreaterThan(PIECE_VALUE[from]);
        expect(['K', 'J'].includes(to) || isPawnLike(to)).toBe(false);
        // No piece type can be upgraded by two families.
        expect(sources.has(from)).toBe(false);
        sources.add(from);
      }
      expect([...fam.tiers].sort((a, b) => a - b)).toEqual(fam.tiers);
    }
  });

  it('only use known pieces', () => {
    for (const fam of FAMILIES) for (const t of fam.members) expect(PIECE_TYPES).toContain(t);
  });
});

describe('synergyTier', () => {
  it('counts the tiers reached', () => {
    const cavalry = family('cavalry');
    expect([0, 2, 3, 5, 6, 9].map((n) => synergyTier(cavalry, n))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(synergyTier(family('infantry'), 7)).toBe(0);
    expect(synergyTier(family('infantry'), 8)).toBe(1);
  });
});

describe('familyStatus', () => {
  it("gives each fielded family's count, tier and next threshold", () => {
    const status = familyStatus(['K', 'N', 'N', 'T', 'F', 'Q']);
    expect(status.map((s) => [s.family.id, s.count, s.tier, s.next])).toEqual([
      ['cavalry', 3, 1, 6],
      ['guard', 2, 0, 3],
    ]);
  });

  it('has no next threshold at the top tier', () => {
    expect(familyStatus(['X', 'X', 'S', 'X'])[0]).toMatchObject({ tier: 2, next: null });
  });
});

describe('synergyUpgrades', () => {
  it('upgrades the frontmost member, then the one nearest the middle, then the leftmost', () => {
    const back = at('N', 3, 0);
    const edge = at('N', 0, 1);
    const middle = at('N', 4, 1);
    const left = at('N', 3, 1);
    const pieces = [at('K', 4, 0), back, edge, middle, left, at('N', 7, 0), at('N', 6, 0)];
    // Six leapers: two upgrades, both on the front row, nearest the middle (d and e tie: d first).
    expect(synergyUpgrades(pieces, BOARD_8).map((u) => u.id)).toEqual([left.id, middle.id]);
  });

  it('upgrades one piece per tier, only members that can be upgraded', () => {
    // Three leapers reach tier 1, but the Archbishop can't be upgraded: the Knight is.
    // The Knight (b1) and the Camel (g1) are as far from the middle: the leftmost goes first.
    const knight = at('N', 1, 0);
    const pieces = [at('K', 4, 0), at('A', 3, 1), knight, at('L', 6, 0)];
    expect(synergyUpgrades(pieces, BOARD_8)).toEqual([
      { id: knight.id, family: 'cavalry', from: 'N', to: 'T', square: { file: 1, rank: 0 } },
    ]);
  });

  it('ignores the bench, for counting and for upgrading', () => {
    const benched = makePiece('X');
    expect(synergyUpgrades([at('K', 4, 0), at('X', 2, 1), benched], BOARD_8)).toEqual([]);
    expect(synergyUpgrades([at('K', 4, 0), at('X', 2, 1), at('X', 5, 0), benched], BOARD_8)).toHaveLength(1);
  });

  it('works out every family separately', () => {
    const pieces = [
      at('K', 4, 0),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((f) => at('P', f, 1)),
      at('X', 0, 0),
      at('X', 7, 0),
      at('F', 1, 0),
      at('W', 6, 0),
      at('M', 2, 0),
    ];
    const upgrades = synergyUpgrades(pieces, BOARD_8);
    expect(upgrades.map((u) => `${u.family}:${u.from}>${u.to}`)).toEqual([
      'infantry:P>N',
      'guard:M>T',
      'siege:X>S',
    ]);
    expect(upgradePoints(upgrades)).toBe(2 + 3 + 3);
  });

  it('upgrades within the side’s own home rows on every board', () => {
    for (const spec of BOARDS) {
      const pieces = [at('K', 0, 0), at('N', 1, spec.homeRows - 1), at('N', 2, 0), at('N', 3, 0)];
      const [u] = synergyUpgrades(pieces, spec);
      expect(u.square.rank).toBe(spec.homeRows - 1);
    }
  });
});

describe('applySynergies', () => {
  it('swaps upgraded pieces for what they fight as, leaving the input alone', () => {
    const pawns = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => makePiece('P', { file: f, rank: 1 }, f === 3 ? 'N' : undefined));
    const pieces = [at('K', 4, 0), ...pawns];
    const fought = applySynergies(pieces, BOARD_8);
    expect(fought).not.toBe(pieces);
    expect(pieces.every((p) => p.type !== 'N')).toBe(true);
    // The d-pawn (a knight-pawn, nearest the middle with e) fights as a Knight, without its affinity.
    const knight = fought.find((p) => p.type === 'N')!;
    expect(knight).toEqual({ id: pawns[3].id, type: 'N', square: { file: 3, rank: 1 } });
    expect(fought.filter((p) => p.type === 'P')).toHaveLength(7);
  });

  it('changes nothing without a synergy', () => {
    const pieces = [at('K', 4, 0), at('N', 1, 0), at('Q', 3, 0)];
    expect(applySynergies(pieces, BOARD_8)).toEqual(pieces);
  });
});
