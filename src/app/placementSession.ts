import type { BoardSpec } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import type { BattleRecord } from '../game/record';
import type { Offer, Shop, ShopResult } from '../rules/economy';
import type { Piece } from '../rules/pieces';

/**
 * What the placement screen needs from whatever is being played: a single-player run (Session) or a
 * multiplayer match (MatchSession).
 */
export interface PlacementSession {
  readonly run: {
    shop: Shop;
    round: number;
    /** The player's colour on screen this round. */
    color: Color;
    settings: { fairy: boolean; reveal: boolean; manual?: boolean };
  };
  readonly board: BoardSpec;
  readonly lastReplay: BattleRecord | null;
  /** The opponent shown during placement, or null while it's still secret (multiplayer). */
  opponent(): { name: string; pieces: Piece[] } | null;
  /** Why the army can't fight yet (empty = ready). */
  armyErrors(): string[];
  /** How many Heirs the army may have (MAX_HEIRS unless a perk allows more). */
  maxHeirs?(): number;
  setPieces(pieces: Piece[]): void;
  setShop(shop: Shop): void;
  rerollOffers(): ShopResult;
  /** What the next reroll costs (REROLL_COST unless a perk makes it free). */
  rerollCost?(): number;
  /** How many of an offer are left in a shared pool (multiplayer), or null when it isn't pooled. */
  offerLeft?(offer: Offer): number | null;
  /** Repairs squares that don't fit the current board (older saves). */
  fitPiecesToBoard(): void;
}
