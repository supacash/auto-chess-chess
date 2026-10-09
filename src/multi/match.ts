import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import { aiBudget, draftAiArmy, pickStyle, placeAiArmy } from '../rules/aiArmy';
import type { Winner } from '../rules/battle';
import type { Piece } from '../rules/pieces';
import { BASE_INCOME, DRAW_BONUS } from '../rules/economy';
import { type Rng, seededRng, shuffle } from '../rules/rng';

// A live, TFT-style match: four players shop and place at the same time, are paired off each round,
// and lose health when they lose a battle. The last one standing wins. Everything here is pure and
// deterministic from the match seed, so every client computes the same pairings and bot armies.

export const MATCH_SIZE = 4;
export const START_HP = 20;
/** Seconds to shop and place each round (Blitz rooms get BLITZ_SECONDS). Ends early when all are ready. */
export const SHOP_SECONDS = 45;
export const BLITZ_SECONDS = 20;

export interface MatchSettings {
  blitz: boolean;
}

export function shopSeconds(settings: MatchSettings): number {
  return settings.blitz ? BLITZ_SECONDS : SHOP_SECONDS;
}

export interface MatchPlayer {
  id: string;
  name: string;
  bot: boolean;
  hp: number;
  /** Final place (1 = winner), set when knocked out or when the match is won; null while still in. */
  place: number | null;
  /**
   * Who they fought last round (for the odd player out: whose copy), so the next round can pair
   * them with someone else. Null before the first round (and missing in rooms from older versions).
   */
  lastOpponent?: string | null;
}

export function newPlayers(entries: { id: string; name: string; bot: boolean }[]): MatchPlayer[] {
  return entries.map((e) => ({ ...e, hp: START_HP, place: null, lastOpponent: null }));
}

/** Players still in the match. */
export function alive(players: MatchPlayer[]): MatchPlayer[] {
  return players.filter((p) => p.place === null);
}

export function matchOver(players: MatchPlayer[]): boolean {
  return alive(players).length <= 1;
}

/**
 * One battle of a round. `white` and `black` are player ids, assigned at random; white moves
 * first. Every client computes the battle the same way (black's client shows the board flipped).
 */
export interface Pairing {
  white: string;
  black: string;
  /**
   * The side playing as a copy of someone's army (the odd player out's opponent), or null. The
   * copy's owner isn't in this battle: only the other side can take damage or extend a streak.
   */
  copy: Color | null;
  /** Seed for the battle's move picking. */
  seed: number;
}

/** True when `playerId` is really in this battle (not just lending a copy of their army). */
export function inPairing(p: Pairing, playerId: string): boolean {
  return (p.white === playerId && p.copy !== 'w') || (p.black === playerId && p.copy !== 'b');
}

/** Mixes the match seed with a round number (and a salt) into a new 32-bit seed. */
export function mixSeed(seed: number, round: number, salt = 0): number {
  let h = (seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Pairs the players still in for `round`, randomly (sides too) but the same on every client. With an
 * odd number left, the last player fights a copy of a random other player's army. Nobody meets last
 * round's opponent again when another pairing avoids it (with two left, it can't be avoided).
 */
export function pairRound(players: MatchPlayer[], seed: number, round: number): Pairing[] {
  const rng = seededRng(mixSeed(seed, round));
  const ids = alive(players).map((p) => p.id);
  const last = new Map(players.map((p) => [p.id, p.lastOpponent ?? null]));
  let best: Pairing[] = [];
  let bestRepeats = Number.POSITIVE_INFINITY;
  // Every order of the (at most MATCH_SIZE) players, shuffled: the first with the fewest repeats wins.
  for (const order of shuffle(permutations(ids), rng)) {
    if (bestRepeats === 0) break;
    const pairings = pairOrder(order, seed, round, rng);
    // Only a side really in the battle counts: a copy's owner isn't meeting anyone.
    const repeats = pairings.filter(
      (p) => (p.copy !== 'w' && last.get(p.white) === p.black) || (p.copy !== 'b' && last.get(p.black) === p.white),
    ).length;
    if (repeats < bestRepeats) {
      best = pairings;
      bestRepeats = repeats;
    }
  }
  return best;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** Pairs players in `order` two by two (the first of each pair is white); an odd last one fights a copy. */
function pairOrder(order: string[], seed: number, round: number, rng: Rng): Pairing[] {
  const out: Pairing[] = [];
  const pair = (white: string, black: string, copy: Color | null) =>
    out.push({ white, black, copy, seed: mixSeed(seed, round, out.length + 1) });
  // The shuffle already makes the order (and so the sides) random.
  for (let i = 0; i + 1 < order.length; i += 2) pair(order[i], order[i + 1], null);
  if (order.length % 2 === 1 && order.length > 1) {
    const odd = order[order.length - 1];
    const others = order.slice(0, -1);
    // Whose army is copied comes from the order too, so every choice is one of the orders tried.
    const copied = others[0];
    if (rng() < 0.5) pair(odd, copied, 'b');
    else pair(copied, odd, 'w');
  }
  return out;
}

/** The pairing `playerId` fights in this round (not counting battles where they're only a copy). */
export function pairingOf(pairings: Pairing[], playerId: string): Pairing | null {
  return pairings.find((p) => inPairing(p, playerId)) ?? null;
}

/** Health lost for losing in `round` to a winner with `winnerMaterial` points left on the board. */
export function lossDamage(round: number, winnerMaterial: number): number {
  return round + Math.floor(winnerMaterial / 5);
}

export interface PairingResult {
  pairing: Pairing;
  winner: Winner;
  material: Record<Color, number>;
}

/** Health lost by each player in a round's results. */
export function roundDamage(round: number, results: PairingResult[]): Map<string, number> {
  const damage = new Map<string, number>();
  for (const { pairing, winner, material } of results) {
    if (winner === 'draw') continue;
    const loserSide: Color = winner === 'w' ? 'b' : 'w';
    if (pairing.copy === loserSide) continue; // the copy's owner isn't in this battle
    const loser = loserSide === 'w' ? pairing.white : pairing.black;
    damage.set(loser, (damage.get(loser) ?? 0) + lossDamage(round, material[winner]));
  }
  return damage;
}

/**
 * Applies a round's results: losers lose health, players at 0 or below are out (lower health =
 * worse place), and the last one standing wins.
 */
export function applyRound(players: MatchPlayer[], round: number, results: PairingResult[]): MatchPlayer[] {
  const damage = roundDamage(round, results);
  const inBefore = alive(players).length;
  const next = players.map((p) => (p.place === null ? { ...p, hp: p.hp - (damage.get(p.id) ?? 0) } : { ...p }));
  const knockedOut = next.filter((p) => p.place === null && p.hp <= 0).sort((a, b) => a.hp - b.hp);
  let place = inBefore;
  for (const p of knockedOut) p.place = place--;
  const left = alive(next);
  if (left.length === 1) left[0].place = 1;
  for (const { pairing } of results) {
    const white = next.find((p) => p.id === pairing.white);
    const black = next.find((p) => p.id === pairing.black);
    if (white && pairing.copy !== 'w') white.lastOpponent = pairing.black;
    if (black && pairing.copy !== 'b') black.lastOpponent = pairing.white;
  }
  return next;
}

// ---- income and streaks ----

/** Win bonus in matches: smaller than single player's +2, since streaks pay extra on top. */
export const MATCH_WIN_BONUS = 1;

/**
 * A player's streak: +n after winning their last n battles, −n after losing their last n. A draw
 * leaves it as it is.
 */
export function nextStreak(streak: number, outcome: Winner): number {
  if (outcome === 'draw') return streak;
  if (outcome === 'w') return streak > 0 ? streak + 1 : 1;
  return streak < 0 ? streak - 1 : -1;
}

/** Extra gold for a win or loss streak (TFT-style, capped): 2 → +1, 3 → +2, 4 or more → +3. */
export function streakBonus(streak: number): number {
  const length = Math.abs(streak);
  return length >= 4 ? 3 : length >= 2 ? length - 1 : 0;
}

/**
 * Gold after a battle in a match: base income, +1 for a win (+1 for a draw, as in single player), and
 * the streak bonus for a win or loss (a draw pays no streak bonus).
 */
export function matchIncome(outcome: Winner, streakAfter: number): number {
  if (outcome === 'draw') return BASE_INCOME + DRAW_BONUS;
  return BASE_INCOME + (outcome === 'w' ? MATCH_WIN_BONUS : 0) + streakBonus(streakAfter);
}

/** Each player's streak after a round's results (the owner of a copied army isn't affected). */
export function nextStreaks(streaks: Map<string, number>, results: PairingResult[]): Map<string, number> {
  const next = new Map(streaks);
  for (const { pairing, winner } of results) {
    const flipped: Winner = winner === 'draw' ? 'draw' : winner === 'w' ? 'b' : 'w';
    if (pairing.copy !== 'w') next.set(pairing.white, nextStreak(next.get(pairing.white) ?? 0, winner));
    if (pairing.copy !== 'b') next.set(pairing.black, nextStreak(next.get(pairing.black) ?? 0, flipped));
  }
  return next;
}

/** A bot's army for a round: an AI-drafted army at the single-player Normal budget, the same on every client. */
export function botArmy(seed: number, round: number, botId: string, spec: BoardSpec = BOARD_8): Piece[] {
  const rng = seededRng(mixSeed(seed, round, hashId(botId)));
  const style = pickStyle(rng);
  const budget = aiBudget(round, rng);
  return placeAiArmy(draftAiArmy(budget, style, rng, spec), style, rng, spec);
}

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
