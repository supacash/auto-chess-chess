import { type Rng, seededRng, shuffle } from '../rules/rng';

// Match perks: at a few rounds of a match, each player picks one of three perks to keep for the rest
// of it (bots pick too). Choices come from the match seed, so every client agrees on them. Perks
// that change health (Bulwark, Sharp edge, Second wind) are shared with the room; the rest only
// change the player's own shop and gold.

export type MatchPerkId = 'chest' | 'squire' | 'tithe' | 'haggler' | 'favour' | 'bulwark' | 'edge' | 'mend';

export interface MatchPerk {
  id: MatchPerkId;
  name: string;
  description: string;
  /** A short tag for the health list. */
  icon: string;
  /** Can be picked again. */
  stackable: boolean;
}

export const CHEST_GOLD = 5;
export const EDGE_DAMAGE = 2;
export const BULWARK_BLOCK = 2;
export const MEND_HP = 8;

export const MATCH_PERKS: MatchPerk[] = [
  { id: 'chest', name: 'War chest', description: `+${CHEST_GOLD} gold now.`, icon: '💰', stackable: true },
  { id: 'squire', name: 'Squire', description: 'A Knight on your bench now.', icon: '♞', stackable: true },
  { id: 'tithe', name: 'Tithe', description: '+1 gold every round.', icon: '🪙', stackable: true },
  {
    id: 'haggler',
    name: 'Haggler',
    description: 'Your first reroll each round is free.',
    icon: '🎲',
    stackable: false,
  },
  {
    id: 'favour',
    name: 'Royal favour',
    description: 'Queens and queen-pawns in your shop from now on.',
    icon: '👑',
    stackable: false,
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    description: `Lose ${BULWARK_BLOCK} less HP from each lost battle (at least 1).`,
    icon: '🛡',
    stackable: true,
  },
  {
    id: 'edge',
    name: 'Sharp edge',
    description: `Your wins deal ${EDGE_DAMAGE} more damage.`,
    icon: '⚔',
    stackable: true,
  },
  {
    id: 'mend',
    name: 'Second wind',
    description: `Heal ${MEND_HP} HP at the end of this round.`,
    icon: '❤',
    stackable: true,
  },
];

/** The rounds whose shop opens with a perk pick. */
export const PERK_ROUNDS = [3, 8, 13];
export const PERK_CHOICES = 3;

/** A player's picks: the perk picked in each perk round. */
export type PerkPicks = Partial<Record<number, MatchPerkId>>;

export function matchPerk(id: MatchPerkId): MatchPerk {
  return MATCH_PERKS.find((p) => p.id === id)!;
}

export function isMatchPerkId(v: unknown): v is MatchPerkId {
  return MATCH_PERKS.some((p) => p.id === v);
}

export function isPerkRound(round: number): boolean {
  return PERK_ROUNDS.includes(round);
}

/** The perks picked up to and including `round`, in the order picked. */
export function perksUpTo(picks: PerkPicks, round: number): MatchPerkId[] {
  return PERK_ROUNDS.filter((r) => r <= round).flatMap((r) => (picks[r] ? [picks[r]] : []));
}

export function countPerk(perks: readonly MatchPerkId[], id: MatchPerkId): number {
  return perks.filter((p) => p === id).length;
}

/** The three perks a player is offered in `round` (seeded: the same on every client). */
export function perkChoices(
  seed: number,
  round: number,
  playerId: string,
  owned: readonly MatchPerkId[],
): MatchPerkId[] {
  const rng: Rng = seededRng((seed ^ Math.imul(round + 7, 0x9e3779b1) ^ hashText(playerId)) >>> 0);
  const open = MATCH_PERKS.filter((p) => p.stackable || !owned.includes(p.id)).map((p) => p.id);
  return shuffle(open, rng).slice(0, PERK_CHOICES);
}

/** A bot's picks up to `round`: the first of its choices each time. */
export function botPicks(seed: number, botId: string, round: number): PerkPicks {
  const picks: PerkPicks = {};
  for (const r of PERK_ROUNDS) {
    if (r > round) break;
    picks[r] = perkChoices(seed, r, botId, perksUpTo(picks, r))[0];
  }
  return picks;
}

/** Health lost for a loss, after the winner's Sharp edges and the loser's Bulwarks (at least 1). */
export function perkedDamage(base: number, winner: readonly MatchPerkId[], loser: readonly MatchPerkId[]): number {
  return Math.max(1, base + EDGE_DAMAGE * countPerk(winner, 'edge') - BULWARK_BLOCK * countPerk(loser, 'bulwark'));
}

function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
