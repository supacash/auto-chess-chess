import { rookOptions, setMergePartners, type Shop } from '../rules/economy';

// First-run tips: one short hint at a time on the shop screen, each shown until the player dismisses
// it (once per device). Which tip shows is a pure function of the shop, so it's tested here; the
// screen keeps the list of dismissed tips.

export type TipId = 'start' | 'merge' | 'tap' | 'affinity' | 'interest' | 'opponent';

export const TIPS: Record<TipId, string> = {
  start: 'Drag your king and pieces onto the lit squares, then press Auto fight.',
  merge: 'You have a set! Tap one of the matching pieces, then Merge.',
  tap: 'Tap one of your pieces to see how it moves, and to merge, upgrade or sell it.',
  affinity:
    'Pawns with a badge are affinity pawns: collect three with the same badge and merge them into that piece (a Rook takes two rook-pawns and a Bishop, Knight or Man).',
  interest: 'Saved gold earns interest: +1 per 10 gold, up to +3. 🔒 keeps the offers for next round.',
  opponent: 'Tap a piece in the opponent’s list to see how it moves.',
};

/** The same tips worded for a multiplayer match, where they differ: Ready, and health instead of lives. */
export const MATCH_TIPS: Partial<Record<TipId, string>> = {
  start: 'Drag your king and pieces onto the lit squares and press Ready before time runs out. Last one standing wins.',
};

/** How to play first; after that, a set ready to merge beats everything else. */
const ORDER: TipId[] = ['start', 'merge', 'tap', 'affinity', 'interest', 'opponent'];

/** The tip to show for this shop and round, or null (all relevant ones dismissed). */
export function nextTip(shop: Shop, round: number, seen: ReadonlySet<TipId>): TipId | null {
  const applies: Record<TipId, boolean> = {
    merge: shop.pieces.some((p) => setMergePartners(shop, p.id) !== null || rookOptions(shop, p.id).length > 0),
    start: round === 1,
    tap: shop.pieces.some((p) => p.type !== 'K'),
    affinity: shop.pieces.some((p) => p.affinity) || (shop.offers ?? []).some((o) => o.length === 2 && o[0] === 'P'),
    interest: shop.gold >= 8,
    opponent: round >= 2,
  };
  return ORDER.find((id) => applies[id] && !seen.has(id)) ?? null;
}
