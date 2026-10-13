import {
  INTEREST_STEP,
  interest,
  MAX_INTEREST,
  type Offer,
  type OfferOdds,
  QUEEN_OFFER_ROUND,
  START_GOLD,
} from './economy';
import { MAX_HEIRS } from './placement';
import { type Rng, shuffle } from './rng';

// Prestige: after winning a run (FINAL_ROUND), the player can start over at round 1 one prestige
// level higher. Each level makes opponents tougher, and the player keeps one perk per level, picked
// from three. The climb from pawns to queens is the fun part, so prestige replays it with a twist
// instead of stretching out a late game where both boards are full of queens.
//
// Each perk is a play style (a fast start, a steady income, saving, rerolling, queens, more lives,
// scouting, Heirs, fusions) and is tuned to about the same strength: see SIMULATION.md for the numbers.

/** Extra AI points per round for each prestige level: about what one perk is worth, so each level is harder even with its new perk (SIMULATION.md §21; it was 0.25, and each level got easier). */
export const PRESTIGE_STEP = 1;

/** The AI's points per round at prestige `level`, from the difficulty's `perRound`. */
export function prestigePerRound(perRound: number, level: number): number {
  return perRound + PRESTIGE_STEP * level;
}

export type PerkId =
  | 'gold'
  | 'knight'
  | 'income'
  | 'interest'
  | 'freeReroll'
  | 'queenPawns'
  | 'life'
  | 'reveal'
  | 'dynasty'
  | 'bazaar';

export interface Perk {
  id: PerkId;
  name: string;
  description: string;
  /** Can be picked again at a later prestige (its effect adds up). */
  stackable: boolean;
  /** Only offered in runs with fairy pieces (it does nothing without them). */
  fairyOnly?: boolean;
  /** Not offered in runs that already show the opponent's placement (it would do nothing). */
  notWithReveal?: boolean;
}

/** War chest: starting gold. */
export const WAR_CHEST_GOLD = 10;
/** Squire: the pieces each run starts with. */
export const SQUIRE_PIECES: Offer[] = ['N', 'B'];
/** Royal favour: the queen-pawns each run starts with (a Queen outright made runs far too easy). */
export const FAVOUR_PIECES: Offer[] = ['PQ', 'PQ'];
/** Tithe: gold every round. */
export const TITHE_GOLD = 1;
/** Banker: interest is +1 per BANKER_STEP gold saved, up to BANKER_MAX (instead of 10 and 3). */
export const BANKER_STEP = 5;
export const BANKER_MAX = 5;
/** Haggler: free rerolls each round. */
export const HAGGLER_REROLLS = 3;
/** Second wind: extra lives. */
export const SECOND_WIND_LIVES = 2;
/** Royal favour: queens and queen-pawns from this round, this many times as often. */
export const FAVOUR_ROUND = 4;
export const FAVOUR_ODDS = 2;
/** Dynasty: gold back for each Heir crowned (an Heir costs three Queens, 27 points). */
export const DYNASTY_GOLD = 9;
/** Bazaar: fusion pieces the shop can offer, and how often (they cost what their parts do). */
export const BAZAAR_WEIGHTS: Partial<Record<Offer, number>> = {
  T: 0.25,
  A: 0.25,
  C: 0.25,
  Z: 0.25,
  D: 0.25,
  H: 0.25,
  U: 0.25,
  S: 0.25,
};

export const PERKS: Perk[] = [
  { id: 'gold', name: 'War chest', description: `Start each run with ${WAR_CHEST_GOLD} more gold.`, stackable: true },
  { id: 'knight', name: 'Squire', description: 'Start each run with a Knight and a Bishop.', stackable: true },
  { id: 'income', name: 'Tithe', description: `Earn ${TITHE_GOLD} more gold every round.`, stackable: false },
  {
    id: 'interest',
    name: 'Banker',
    description: `Interest is +1 gold per ${BANKER_STEP} you save, up to +${BANKER_MAX} a round.`,
    stackable: false,
  },
  {
    id: 'freeReroll',
    name: 'Haggler',
    description: `Your first ${HAGGLER_REROLLS} rerolls each round are free.`,
    stackable: false,
  },
  {
    id: 'queenPawns',
    name: 'Royal favour',
    description: `Start each run with two queen-pawns. Queens and queen-pawns show up from round ${FAVOUR_ROUND} instead of ${QUEEN_OFFER_ROUND}, and twice as often.`,
    stackable: false,
  },
  {
    id: 'life',
    name: 'Second wind',
    description: `Start each run with ${SECOND_WIND_LIVES} extra lives.`,
    stackable: false,
  },
  {
    id: 'reveal',
    name: 'Spyglass',
    description: "See where the opponent's pieces stand while you place yours.",
    stackable: false,
    notWithReveal: true,
  },
  {
    id: 'dynasty',
    name: 'Dynasty',
    description: `Your army may have two Heirs, and crowning one pays you ${DYNASTY_GOLD} gold.`,
    stackable: false,
    fairyOnly: true,
  },
  {
    id: 'bazaar',
    name: 'Bazaar',
    description: 'Fusion pieces show up in your shop, for what their parts cost.',
    stackable: false,
    fairyOnly: true,
  },
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

/**
 * Three perks to choose from at the next prestige: stackable ones, or ones the player doesn't have
 * yet (fairy-only perks only in fairy runs, Spyglass only without Reveal). The first prestige of a
 * fairy run always offers Dynasty, so the second Heir is within reach early; the rest are random.
 */
export function perkChoices(perks: readonly PerkId[], rng: Rng, count = 3, fairy = true, reveal = false): Perk[] {
  const open = PERKS.filter(
    (p) => (p.stackable || !perks.includes(p.id)) && (fairy || !p.fairyOnly) && !(reveal && p.notWithReveal),
  );
  const shuffled = shuffle(open, rng);
  if (!fairy || perks.length > 0) return shuffled.slice(0, count);
  const dynasty = shuffled.filter((p) => p.id === 'dynasty');
  return [...dynasty, ...shuffled.filter((p) => p.id !== 'dynasty')].slice(0, count);
}

export function startGold(perks: readonly PerkId[]): number {
  return START_GOLD + WAR_CHEST_GOLD * perkCount(perks, 'gold');
}

/** Pieces a run starts with on top of the mode's army (Squire, Royal favour), as the offers they'd be. */
export function startPieces(perks: readonly PerkId[]): Offer[] {
  const squires = Array.from({ length: perkCount(perks, 'knight') }, () => SQUIRE_PIECES).flat();
  return perks.includes('queenPawns') ? [...squires, ...FAVOUR_PIECES] : squires;
}

/** Extra lives on top of START_LIVES. */
export function extraLives(perks: readonly PerkId[]): number {
  return SECOND_WIND_LIVES * perkCount(perks, 'life');
}

/** Extra gold every round. */
export function extraIncome(perks: readonly PerkId[]): number {
  return TITHE_GOLD * perkCount(perks, 'income');
}

/** How interest is paid: +1 per `step` gold saved, up to `max`. */
export function interestTerms(perks: readonly PerkId[]): { step: number; max: number } {
  return perks.includes('interest')
    ? { step: BANKER_STEP, max: BANKER_MAX }
    : { step: INTEREST_STEP, max: MAX_INTEREST };
}

/** Interest on `gold` saved, with the run's perks. */
export function perkInterest(gold: number, perks: readonly PerkId[]): number {
  const { step, max } = interestTerms(perks);
  return interest(gold, step, max);
}

/** Free rerolls each round. */
export function freeRerolls(perks: readonly PerkId[]): number {
  return perks.includes('freeReroll') ? HAGGLER_REROLLS : 0;
}

/** The round queens and queen-pawns start showing up in the shop. */
export function queenOfferRound(perks: readonly PerkId[]): number {
  return perks.includes('queenPawns') ? FAVOUR_ROUND : QUEEN_OFFER_ROUND;
}

/** How the shop draws offers with these perks (Royal favour's queens, Bazaar's fusion pieces). */
export function offerOdds(perks: readonly PerkId[]): OfferOdds {
  const favour = perks.includes('queenPawns');
  return {
    queenRound: queenOfferRound(perks),
    ...(favour ? { scale: (o: Offer) => (o === 'Q' || o === 'PQ' ? FAVOUR_ODDS : 1) } : {}),
    ...(perks.includes('bazaar') ? { extra: BAZAAR_WEIGHTS } : {}),
  };
}

/** True when the opponent's placement is shown (Spyglass). */
export function revealsOpponent(perks: readonly PerkId[]): boolean {
  return perks.includes('reveal');
}

/** Gold paid for crowning an Heir (Dynasty). */
export function crownGold(perks: readonly PerkId[]): number {
  return perks.includes('dynasty') ? DYNASTY_GOLD : 0;
}

/** How many Heirs the army may have (Dynasty allows a second one). */
export function maxHeirs(perks: readonly PerkId[]): number {
  return MAX_HEIRS + perkCount(perks, 'dynasty');
}
