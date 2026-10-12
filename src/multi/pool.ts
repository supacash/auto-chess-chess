import { isAffinityOffer, type Offer, QUEEN_OFFER_ROUND } from '../rules/economy';
import { type Affinity, type Piece, PIECE_NAME } from '../rules/pieces';
import { seededRng, weightedPick } from '../rules/rng';

// The shared pool: in a match, everyone's affinity pawns, Ferzes and Wazirs come from one limited
// supply. One held (on the board or the bench) is out of the pool; merging or fusing it, or selling
// it, puts it back, and so does being knocked out. Fewer left means it shows up less often, and none
// left means sold out. Bots hold a couple of pawns too (worked out from the seed, so every client
// agrees).

/** What the pool keeps count of: each affinity pawn (by its affinity), and the Ferz and the Wazir. */
export type PoolKind = Affinity | 'F' | 'W';
export const POOL_KINDS: PoolKind[] = ['N', 'B', 'R', 'Q', 'F', 'W'];

export const POOL_SIZE: Record<PoolKind, number> = { N: 12, B: 12, R: 9, Q: 6, F: 10, W: 10 };

/** Pool pieces held, by kind. */
export type Holdings = Partial<Record<PoolKind, number>>;

export function isPoolKind(v: unknown): v is PoolKind {
  return (POOL_KINDS as unknown[]).includes(v);
}

/** The pool kind a piece counts as, or null for pieces outside the pool. */
function kindOf(piece: Pick<Piece, 'type' | 'affinity'>): PoolKind | null {
  if (piece.affinity) return piece.affinity;
  return piece.type === 'F' || piece.type === 'W' ? piece.type : null;
}

/** How many pool pieces of each kind `pieces` holds. */
export function holdingsOf(pieces: readonly Piece[]): Holdings {
  const out: Holdings = {};
  for (const p of pieces) {
    const kind = kindOf(p);
    if (kind) out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}

export function sameHoldings(a: Holdings, b: Holdings): boolean {
  return POOL_KINDS.every((x) => (a[x] ?? 0) === (b[x] ?? 0));
}

/** "Rook-pawn", "Ferz". */
export function poolKindName(kind: PoolKind): string {
  return kind === 'F' || kind === 'W' ? PIECE_NAME[kind] : `${PIECE_NAME[kind]}-pawn`;
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
export function poolLeft(holdings: readonly Holdings[]): Record<PoolKind, number> {
  const left = { ...POOL_SIZE };
  for (const h of holdings) for (const x of POOL_KINDS) left[x] = Math.max(0, left[x] - (h[x] ?? 0));
  return left;
}

/** The pool kind an offer buys, or null for offers outside the pool (finished and other fairy pieces). */
function offerKind(offer: Offer): PoolKind | null {
  if (isAffinityOffer(offer)) return offer[1] as Affinity;
  return offer === 'F' || offer === 'W' ? offer : null;
}

/** How many of an offer are left, or null for offers outside the pool. */
export function offerLeft(left: Record<PoolKind, number>, offer: Offer): number | null {
  const kind = offerKind(offer);
  return kind ? left[kind] : null;
}

/** Scales an offer's chance of showing up by how much of it is left. */
export function poolScale(left: Record<PoolKind, number>): (offer: Offer) => number {
  return (offer) => {
    const kind = offerKind(offer);
    return kind ? left[kind] / POOL_SIZE[kind] : 1;
  };
}
