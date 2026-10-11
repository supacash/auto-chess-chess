import { isAffinityOffer, type Offer, QUEEN_OFFER_ROUND } from '../rules/economy';
import { type Affinity, AFFINITIES, type Piece } from '../rules/pieces';
import { seededRng, weightedPick } from '../rules/rng';

// The shared pawn pool: in a match, everyone's affinity pawns come from one limited supply. A pawn
// someone holds (on the board or the bench) is out of the pool; merging or selling it puts it back,
// and so does being knocked out. Fewer left means it shows up less often, and none left means sold
// out. Bots hold a couple too (worked out from the seed, so every client agrees).

export const POOL_SIZE: Record<Affinity, number> = { N: 12, B: 12, R: 9, Q: 6 };

/** Affinity pawns held, by affinity. */
export type Holdings = Partial<Record<Affinity, number>>;

/** How many affinity pawns of each kind `pieces` holds. */
export function holdingsOf(pieces: readonly Piece[]): Holdings {
  const out: Holdings = {};
  for (const p of pieces) if (p.affinity) out[p.affinity] = (out[p.affinity] ?? 0) + 1;
  return out;
}

export function sameHoldings(a: Holdings, b: Holdings): boolean {
  return AFFINITIES.every((x) => (a[x] ?? 0) === (b[x] ?? 0));
}

/** Pawns a bot holds in a round: BOT_HOLD of one kind it's collecting. */
export const BOT_HOLD = 2;

export function botHoldings(seed: number, round: number, botId: string): Holdings {
  let h = (seed ^ Math.imul(round + 3, 0x85ebca6b)) >>> 0;
  for (let i = 0; i < botId.length; i++) h = Math.imul(h ^ botId.charCodeAt(i), 0x01000193) >>> 0;
  const kinds: Affinity[] = round >= QUEEN_OFFER_ROUND ? ['N', 'B', 'R', 'Q'] : ['N', 'B', 'R'];
  const kind = weightedPick(kinds, (k) => POOL_SIZE[k], seededRng(h));
  return { [kind]: BOT_HOLD };
}

/** What's left in the pool once everyone's holdings are out (never below 0). */
export function poolLeft(holdings: readonly Holdings[]): Record<Affinity, number> {
  const left = { ...POOL_SIZE };
  for (const h of holdings) for (const x of AFFINITIES) left[x] = Math.max(0, left[x] - (h[x] ?? 0));
  return left;
}

/** How many of an offer are left, or null for offers outside the pool (finished and fairy pieces). */
export function offerLeft(left: Record<Affinity, number>, offer: Offer): number | null {
  return isAffinityOffer(offer) ? left[offer[1] as Affinity] : null;
}

/** Scales an offer's chance of showing up by how much of it is left. */
export function poolScale(left: Record<Affinity, number>): (offer: Offer) => number {
  return (offer) => {
    if (!isAffinityOffer(offer)) return 1;
    const kind = offer[1] as Affinity;
    return left[kind] / POOL_SIZE[kind];
  };
}
