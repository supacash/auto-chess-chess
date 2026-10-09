import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import { aiBudget, draftAiArmy, pickStyle, placeAiArmy } from '../rules/aiArmy';
import type { Winner } from '../rules/battle';
import type { Piece } from '../rules/pieces';
import { randomInt, seededRng, shuffle } from '../rules/rng';

// A live, TFT-style match: four players shop and place at the same time, are paired off each round,
// and lose health when they lose a battle. The last one standing wins. Everything here is pure and
// deterministic from the match seed, so every client computes the same pairings and bot armies.

export const MATCH_SIZE = 4;
export const START_HP = 20;
/** Seconds to shop and place each round (Blitz rooms get BLITZ_SECONDS). Ends early when all are ready. */
export const SHOP_SECONDS = 45;
export const BLITZ_SECONDS = 15;

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
}

export function newPlayers(entries: { id: string; name: string; bot: boolean }[]): MatchPlayer[] {
  return entries.map((e) => ({ ...e, hp: START_HP, place: null }));
}

/** Players still in the match. */
export function alive(players: MatchPlayer[]): MatchPlayer[] {
  return players.filter((p) => p.place === null);
}

export function matchOver(players: MatchPlayer[]): boolean {
  return alive(players).length <= 1;
}

/**
 * One battle of a round. `white` and `black` are player ids; the battle is always computed with
 * white's army as white, so every client gets the same result (black's client shows it flipped).
 */
export interface Pairing {
  white: string;
  black: string;
  /** Black is fighting as a copy of its army (the odd player out): only white can take damage. */
  copy: boolean;
  whiteFirst: boolean;
  /** Seed for the battle's move picking. */
  seed: number;
}

/** Mixes the match seed with a round number (and a salt) into a new 32-bit seed. */
export function mixSeed(seed: number, round: number, salt = 0): number {
  let h = (seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Pairs the players still in for `round`, randomly but the same on every client. With an odd number
 * left, the last player fights a copy of a random other player's army.
 */
export function pairRound(players: MatchPlayer[], seed: number, round: number): Pairing[] {
  const rng = seededRng(mixSeed(seed, round));
  const order = shuffle(
    alive(players).map((p) => p.id),
    rng,
  );
  const out: Pairing[] = [];
  const pair = (white: string, black: string, copy: boolean) =>
    out.push({ white, black, copy, whiteFirst: rng() < 0.5, seed: mixSeed(seed, round, out.length + 1) });
  for (let i = 0; i + 1 < order.length; i += 2) pair(order[i], order[i + 1], false);
  if (order.length % 2 === 1 && order.length > 1) {
    const others = order.slice(0, -1);
    pair(order[order.length - 1], others[randomInt(rng, others.length)], true);
  }
  return out;
}

/** The pairing `playerId` fights in this round (as white, or as black unless it's only a copy). */
export function pairingOf(pairings: Pairing[], playerId: string): Pairing | null {
  return pairings.find((p) => p.white === playerId || (p.black === playerId && !p.copy)) ?? null;
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
    if (winner === 'w' && pairing.copy) continue; // the copy's owner isn't in this battle
    const loser = winner === 'w' ? pairing.black : pairing.white;
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
