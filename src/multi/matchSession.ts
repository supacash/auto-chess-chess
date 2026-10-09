import type { PlacementSession } from '../app/placementSession';
import { BOARD_8, type BoardSpec } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import type { Winner } from '../rules/battle';
import { rerollOffers, rollOffers, type Shop, type ShopResult, startingShop } from '../rules/economy';
import { gameMode } from '../rules/mode';
import type { Piece } from '../rules/pieces';
import { armyErrors, canPlace, pieceAt } from '../rules/placement';
import { startPosition } from '../rules/position';
import type { Rng } from '../rules/rng';
import {
  alive,
  applyRound,
  botArmy,
  type MatchPlayer,
  type MatchSettings,
  matchIncome,
  matchOver,
  newPlayers,
  nextStreaks,
  type Pairing,
  type PairingResult,
  pairingOf,
  pairRound,
  roundDamage,
} from './match';

export type MatchPhase = 'shop' | 'battle' | 'over';

/** A battle ready to play: its pairing, start position and who moves first. */
export interface MatchBattle {
  pairing: Pairing;
  /** Null when both kings would start in check (the battle counts as a draw). */
  start: { fen: string; firstMover: Color } | null;
}

/**
 * One player's view of a 4-player match: their own shop and army, everyone's health, and the round
 * flow (shop → battle → next round). Bot armies and pairings come from the match seed, so this is
 * the same on every client. No DOM; the offline (vs bots) and online modes both drive it.
 */
export class MatchSession implements PlacementSession {
  /** Classic 8×8 with standard pieces while multiplayer is being tested. */
  readonly board: BoardSpec = BOARD_8;
  readonly lastReplay = null;
  players: MatchPlayer[];
  round = 1;
  phase: MatchPhase = 'shop';
  shop: Shop;
  pairings: Pairing[] = [];
  /** Health each player lost last round, for the round summary. */
  lastDamage = new Map<string, number>();
  /** Each player's win (+n) or loss (−n) streak. */
  streaks = new Map<string, number>();
  private locked = new Map<string, Piece[]>();

  constructor(
    readonly seed: number,
    readonly myId: string,
    entries: { id: string; name: string; bot: boolean }[],
    readonly settings: MatchSettings,
    private readonly rng: Rng,
  ) {
    this.players = newPlayers(entries);
    const shop = startingShop(gameMode('classic').startArmy);
    this.shop = { ...shop, offers: rollOffers(1, rng, false) };
  }

  get run() {
    return {
      shop: this.shop,
      round: this.round,
      color: 'w' as Color,
      settings: { fairy: false, reveal: false },
    };
  }

  get me(): MatchPlayer {
    return this.players.find((p) => p.id === this.myId)!;
  }

  player(id: string): MatchPlayer {
    return this.players.find((p) => p.id === id)!;
  }

  /** Opponents stay secret until the round's battles start. */
  opponent(): null {
    return null;
  }

  armyErrors(): string[] {
    return armyErrors(this.shop.pieces, this.board);
  }

  setPieces(pieces: Piece[]): void {
    this.shop = { ...this.shop, pieces };
  }

  setShop(shop: Shop): void {
    this.shop = shop;
  }

  rerollOffers(): ShopResult {
    return rerollOffers(this.shop, this.round, this.rng, false);
  }

  fitPiecesToBoard(): void {}

  /**
   * Ends the shop phase: places the king if the player forgot (so the timer can't leave them without
   * an army), freezes every army and pairs the players.
   */
  lockArmies(armies: Map<string, Piece[]> = new Map()): void {
    this.shop = { ...this.shop, pieces: withKingPlaced(this.shop.pieces, this.board) };
    this.locked = new Map();
    for (const p of alive(this.players)) {
      // Armies given (online: everyone's uploaded army, the player's own included) come first.
      const army =
        armies.get(p.id) ??
        (p.id === this.myId
          ? this.shop.pieces.filter((x) => x.square)
          : botArmy(this.seed, this.round, p.id, this.board));
      this.locked.set(p.id, army);
    }
    this.pairings = pairRound(this.players, this.seed, this.round);
    this.phase = 'battle';
  }

  /** A player's locked army for this round. */
  army(id: string): Piece[] {
    return this.locked.get(id) ?? [];
  }

  /** The battle the player is in this round (null if they're out). */
  myPairing(): Pairing | null {
    return pairingOf(this.pairings, this.myId);
  }

  battle(pairing: Pairing): MatchBattle {
    // White moves first, as in chess (a king that starts in check still moves first).
    const start = startPosition(this.army(pairing.white), this.army(pairing.black), true, this.board);
    return { pairing, start: start.ok ? { fen: start.fen, firstMover: start.firstMover } : null };
  }

  /** Applies the round's results: health, knockouts, the player's income, then the next round's shop. */
  finishRound(results: PairingResult[]): void {
    this.lastDamage = roundDamage(this.round, results);
    this.streaks = nextStreaks(this.streaks, results);
    this.players = applyRound(this.players, this.round, results);
    const mine = results.find((r) => r.pairing === this.myPairing());
    const myResult = mine ? fromSide(mine.winner, mine.pairing.white === this.myId ? 'w' : 'b') : 'draw';
    if (matchOver(this.players) || this.me.place !== null) {
      this.phase = 'over';
      return;
    }
    this.round++;
    this.shop = {
      ...this.shop,
      gold: this.shop.gold + matchIncome(myResult, this.streaks.get(this.myId) ?? 0),
      offers: rollOffers(this.round, this.rng, false),
    };
    this.pairings = [];
    this.phase = 'shop';
  }
}

/** A result as seen by the player on `side` ('w' = they won). */
function fromSide(winner: Winner, side: Color): Winner {
  if (winner === 'draw') return 'draw';
  return winner === side ? 'w' : 'b';
}

/** Puts the king on the first free legal back-row square if it's still on the bench. */
export function withKingPlaced(pieces: Piece[], spec: BoardSpec): Piece[] {
  const king = pieces.find((p) => p.type === 'K');
  if (!king || king.square) return pieces;
  for (let rank = 0; rank < spec.homeRows; rank++) {
    for (const file of centreOut(spec.files)) {
      const sq = { file, rank };
      if (canPlace('K', sq, spec) && !pieceAt(pieces, sq)) {
        return pieces.map((p) => (p === king ? { ...p, square: sq } : p));
      }
    }
  }
  return pieces;
}

function centreOut(files: number): number[] {
  return Array.from({ length: files }, (_, i) => i).sort(
    (a, b) => Math.abs(a - (files - 1) / 2) - Math.abs(b - (files - 1) / 2),
  );
}
