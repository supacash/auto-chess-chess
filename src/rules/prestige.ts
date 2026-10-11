import { QUEEN_OFFER_ROUND, START_GOLD } from './economy';
import { type Rng, shuffle } from './rng';

// Prestige: after winning a run (FINAL_ROUND), the player can start over at round 1 one prestige
// level higher. Each level makes opponents tougher, and the player keeps one perk per level, picked
// from three. The climb from pawns to queens is the fun part, so prestige replays it with a twist
// instead of stretching out a late game where both boards are full of queens.

/** Extra AI points per round for each prestige level. */
export const PRESTIGE_STEP = 0.25;

export type PerkId = 'gold' | 'knight' | 'queenPawns' | 'freeReroll' | 'life' | 'income';

export interface Perk {
  id: PerkId;
  name: string;
  description: string;
  /** Can be picked again at a later prestige (its effect adds up). */
  stackable: boolean;
}

export const PERKS: Perk[] = [
  { id: 'gold', name: 'War chest', description: 'Start each run with 2 more gold.', stackable: true },
  { id: 'knight', name: 'Squire', description: 'Start each run with a Knight.', stackable: true },
  {
    id: 'queenPawns',
    name: 'Royal favour',
    description: 'Queens and queen-pawns show up in the shop from round 4 instead of 6.',
    stackable: false,
  },
  { id: 'freeReroll', name: 'Haggler', description: 'Your first reroll each round is free.', stackable: false },
  { id: 'life', name: 'Second wind', description: 'Start each run with an extra life.', stackable: false },
  { id: 'income', name: 'Tithe', description: 'Earn 1 more gold every round.', stackable: false },
];

export function isPerkId(v: unknown): v is PerkId {
  return PERKS.some((p) => p.id === v);
}

export function perk(id: PerkId): Perk {
  return PERKS.find((p) => p.id === id)!;
}

export function perkCount(perks: readonly PerkId[], id: PerkId): number {
  return perks.filter((p) => p === id).length;
}

/** Three perks to choose from at the next prestige: stackable ones, or ones the player doesn't have yet. */
export function perkChoices(perks: readonly PerkId[], rng: Rng, count = 3): Perk[] {
  const open = PERKS.filter((p) => p.stackable || !perks.includes(p.id));
  return shuffle(open, rng).slice(0, count);
}

export function startGold(perks: readonly PerkId[]): number {
  return START_GOLD + 2 * perkCount(perks, 'gold');
}

/** Extra lives on top of START_LIVES. */
export function extraLives(perks: readonly PerkId[]): number {
  return perkCount(perks, 'life');
}

/** The round queens and queen-pawns start showing up in the shop. */
export function queenOfferRound(perks: readonly PerkId[]): number {
  return perks.includes('queenPawns') ? 4 : QUEEN_OFFER_ROUND;
}

/** Extra gold every round. */
export function extraIncome(perks: readonly PerkId[]): number {
  return perkCount(perks, 'income');
}
