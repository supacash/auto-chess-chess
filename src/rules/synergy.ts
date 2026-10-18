import type { BoardSpec } from '../chess/boardSpec';
import { type Piece, PIECE_VALUE, type PieceType, type Square } from './pieces';

/**
 * Synergies (a prototype, a New game option for fairy runs). Pieces belong to families by how they
 * move, and fielding enough of a family upgrades its front pieces for the battle, the way a promotion
 * does: a pawn starts as a Knight, a Knight as a Centaur. Both sides get them, worked out from each
 * army as placed (the bench doesn't count, and an upgraded piece doesn't count again for another
 * family). The upgrades last only for that battle. See DESIGN.md (Synergies).
 */

export type FamilyId = 'infantry' | 'cavalry' | 'guard' | 'siege';

export interface Family {
  id: FamilyId;
  name: string;
  /** The piece that stands for the family (its chip's picture). */
  icon: PieceType;
  /** How its members move, in a word or two. */
  kind: string;
  /** Pieces that count toward the family. Compound pieces can count toward two. */
  members: readonly PieceType[];
  /** Members needed for each tier: reaching the n-th tier upgrades n pieces. */
  tiers: readonly number[];
  /** The members that get upgraded, and what each fights as. */
  upgrades: Partial<Record<PieceType, PieceType>>;
}

/**
 * The families, first numbers (not yet balanced: SIMULATION.md §27). Each upgrade is worth 2 to 4
 * points. AI armies don't build for synergies, so the thresholds are high enough that they reach them
 * only now and then: Infantry needs a full eight pawns, because the AI fields six or more from round 5
 * (with six, nearly every AI army would get a free Knight).
 */
export const FAMILIES: readonly Family[] = [
  {
    id: 'infantry',
    name: 'Infantry',
    icon: 'P',
    kind: 'pawns',
    members: ['P', 'E'],
    tiers: [8],
    upgrades: { P: 'N', E: 'N' },
  },
  {
    id: 'cavalry',
    name: 'Cavalry',
    icon: 'N',
    kind: 'leapers',
    members: ['N', 'L', 'U', 'T', 'A', 'C', 'Z', 'Y'],
    tiers: [3, 6],
    upgrades: { N: 'T', L: 'U' },
  },
  {
    id: 'guard',
    name: 'Guard',
    icon: 'M',
    kind: 'steppers',
    members: ['F', 'W', 'M', 'T', 'D', 'H', 'Y'],
    tiers: [3, 6],
    upgrades: { F: 'M', W: 'M', M: 'T' },
  },
  {
    id: 'siege',
    name: 'Siege',
    icon: 'X',
    kind: 'hoppers',
    members: ['X', 'S', 'G'],
    tiers: [2, 4],
    upgrades: { X: 'S', G: 'X' },
  },
];

export function family(id: FamilyId): Family {
  return FAMILIES.find((f) => f.id === id)!;
}

/** The families a piece counts toward (none for the King, the Heir, Bishops, Rooks and Queens). */
export function familiesOf(type: PieceType): Family[] {
  return FAMILIES.filter((f) => f.members.includes(type));
}

/** How many tiers of `fam` an army with `count` of its members reaches (0 = none). */
export function synergyTier(fam: Family, count: number): number {
  return fam.tiers.filter((t) => count >= t).length;
}

export interface FamilyStatus {
  family: Family;
  /** Members fielded. */
  count: number;
  /** Tiers reached (0 = not active). */
  tier: number;
  /** Members needed for the next tier, or null at the top one. */
  next: number | null;
}

/** Each family's count and tier for an army's placed piece types (families with no members are left out). */
export function familyStatus(types: readonly PieceType[]): FamilyStatus[] {
  return FAMILIES.map((fam) => {
    const count = types.filter((t) => fam.members.includes(t)).length;
    const tier = synergyTier(fam, count);
    return { family: fam, count, tier, next: fam.tiers[tier] ?? null };
  }).filter((s) => s.count > 0);
}

/** A piece that fights the battle as something stronger. */
export interface SynergyUpgrade {
  /** The piece's id. */
  id: string;
  family: FamilyId;
  from: PieceType;
  to: PieceType;
  /** Where it stands, in its side's own coordinates (rank 0 = its back row). */
  square: Square;
}

/**
 * The pieces an army's synergies upgrade. Each tier reached upgrades one of the family's members that
 * can be upgraded: the frontmost first, then the one nearest the middle file, then the leftmost.
 * Benched pieces don't count or get upgraded. Squares are the army's own (rank 0 = its back row).
 */
export function synergyUpgrades(pieces: readonly Piece[], spec: BoardSpec): SynergyUpgrade[] {
  const placed = pieces.filter((p): p is Piece & { square: Square } => p.square !== null);
  const types = placed.map((p) => p.type);
  const middle = (spec.files - 1) / 2;
  const order = (a: Square, b: Square) =>
    b.rank - a.rank || Math.abs(a.file - middle) - Math.abs(b.file - middle) || a.file - b.file;
  const out: SynergyUpgrade[] = [];
  for (const { family: fam, tier } of familyStatus(types)) {
    if (tier === 0) continue;
    const candidates = placed.filter((p) => fam.upgrades[p.type]).sort((a, b) => order(a.square, b.square));
    for (const p of candidates.slice(0, tier)) {
      out.push({ id: p.id, family: fam.id, from: p.type, to: fam.upgrades[p.type]!, square: p.square });
    }
  }
  return out;
}

/** The army as it fights with its synergies: upgraded pieces swapped for what they fight as (a new array). */
export function applySynergies(pieces: readonly Piece[], spec: BoardSpec): Piece[] {
  return applyUpgrades(pieces, synergyUpgrades(pieces, spec));
}

/** `pieces` with `upgrades` (from synergyUpgrades) made: a new array; the pieces not upgraded are kept as they are. */
export function applyUpgrades(pieces: readonly Piece[], upgrades: readonly SynergyUpgrade[]): Piece[] {
  const upgraded = new Map(upgrades.map((u) => [u.id, u.to]));
  return pieces.map((p) => {
    const to = upgraded.get(p.id);
    if (!to) return p;
    // A pawn that fights as a Knight leaves its affinity behind (it only matters in the shop).
    const { affinity: _, ...rest } = p;
    return { ...rest, type: to };
  });
}

/** Points the upgrades add to an army for the battle. */
export function upgradePoints(upgrades: readonly SynergyUpgrade[]): number {
  return upgrades.reduce((sum, u) => sum + PIECE_VALUE[u.to] - PIECE_VALUE[u.from], 0);
}
