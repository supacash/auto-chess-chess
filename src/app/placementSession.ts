import type { BoardSpec } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import type { BattleRecord } from '../game/record';
import type { Shop, ShopResult } from '../rules/economy';
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
    settings: { fairy: boolean; reveal: boolean };
  };
  readonly board: BoardSpec;
  readonly lastReplay: BattleRecord | null;
  /** The opponent shown during placement, or null while it's still secret (multiplayer). */
  opponent(): { name: string; pieces: Piece[] } | null;
  /** Why the army can't fight yet (empty = ready). */
  armyErrors(): string[];
  setPieces(pieces: Piece[]): void;
  setShop(shop: Shop): void;
  rerollOffers(): ShopResult;
  /** Repairs squares that don't fit the current board (older saves). */
  fitPiecesToBoard(): void;
}
