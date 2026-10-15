/**
 * The `--player shop` stand-in: keeps one persistent Shop for the whole run and spends its gold
 * each round with a simple greedy plan built around affinity pawns.
 *
 * Per step:
 * 1. Merge any finished set: three affinity pawns with the same affinity into that piece, or two
 *    rook-pawns and a Bishop, Knight or Man into a Rook (benched pieces first); once the board is full,
 *    two rooks into a queen, and three knights or three bishops into a queen.
 * 2. Buy an affinity pawn that adds to a set it's collecting (closest to done first), or starts one (at
 *    most MAX_SETS at a time, the affinity its style likes best, rook- and queen-pawns weighted by the
 *    style's rook and queen weights). Plain pawns (Berolina) fill pawn slots while pawns are below the
 *    style's pawn share; finished pieces are bought when the style likes them and they fit.
 * 3. Upgrade a plain pawn into a minor piece with gold (3 gold) when there's room for nothing else.
 * 4. Sell its cheapest piece for a more valuable offer when the army is full.
 * 5. Reroll (up to MAX_REROLLS a round, keeping REROLL_RESERVE gold) while it has gold to spend.
 * Gold that fits nothing carries over. Every action goes through the real shop functions, so the
 * caps (bench, pawns) apply exactly as in the game. The caller stocks `shop.offers` each round.
 */
import { type BoardSpec, pawnSquares } from '../../src/chess/boardSpec';
import type { AiStyle } from '../../src/rules/aiArmy';
import {
  buyOffer,
  fusePieces,
  fuseSet,
  isAffinityOffer,
  makeRook,
  type Offer,
  type OfferOdds,
  offerPrice,
  REROLL_COST,
  ROOK_PAWNS,
  rerollOffers,
  rookOptions,
  type Shop,
  sellPiece,
  sellValue,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from '../../src/rules/economy';
import { type Affinity, isPawnLike, type Piece, type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import { armyCap } from '../../src/rules/placement';
import { type Rng, weightedPick } from '../../src/rules/rng';

export function armyValue(shop: Shop): number {
  return shop.pieces.reduce((s, p) => s + PIECE_VALUE[p.type], 0);
}

/** Sets collected at once: more spreads gold thin and fills the bench with pawns. */
const MAX_SETS = 2;
/** Rerolls a round at most. */
const MAX_REROLLS = 6;
/** Gold kept back when rerolling: enough to buy an affinity pawn or two from the new offers. */
const REROLL_RESERVE = 2;

const ids = (pieces: Piece[]) => pieces.map((p) => p.id);
const affinityOf = (offer: Offer): Affinity | null => (isAffinityOffer(offer) ? (offer[1] as Affinity) : null);
/** Affinity pawns in a finished set: two for a Rook (with a Bishop, Knight or Man), three for the rest. */
const setSize = (a: Affinity) => (a === 'R' ? ROOK_PAWNS : 3);

/** One merge, best first, or null. Affinity sets always; the rest only to free squares. */
function bestMerge(shop: Shop, full: boolean, fairy: boolean): Shop | null {
  const byAffinity = new Map<Affinity, Piece[]>();
  for (const p of shop.pieces) if (p.affinity) byAffinity.set(p.affinity, [...(byAffinity.get(p.affinity) ?? []), p]);
  for (const [affinity, set] of byAffinity) {
    if (affinity !== 'R' && set.length >= 3) {
      const r = fuseSet(shop, ids(set.slice(0, 3)), affinity);
      if (r.ok) return r.shop;
    }
  }
  // A Rook: two rook-pawns and the first Bishop, Knight or Man on offer (benched first).
  const rookPawn = byAffinity.get('R')?.[0];
  const [rook] = rookPawn ? rookOptions(shop, rookPawn.id) : [];
  if (rook) {
    const r = makeRook(shop, rook.keepId, rook.usedIds);
    if (r.ok) return r.shop;
  }
  if (!full) return null;
  const plain = (t: PieceType) => shop.pieces.filter((p) => p.type === t && !p.affinity);
  const rooks = plain('R');
  if (rooks.length >= 2) {
    const r = fusePieces(shop, rooks[0].id, rooks[1].id, 'Q', fairy);
    if (r.ok) return r.shop;
  }
  for (const t of ['N', 'B'] as const) {
    const set = plain(t);
    if (set.length >= 3) {
      const r = fuseSet(shop, ids(set.slice(0, 3)), 'Q');
      if (r.ok) return r.shop;
    }
  }
  // Three plain pawns (the starting ones) into a minor piece.
  const pawns = plain('P');
  if (pawns.length >= 3) {
    const r = fuseSet(shop, ids(pawns.slice(0, 3)), 'N');
    if (r.ok) return r.shop;
  }
  return null;
}

/** How a prestige run changes the stand-in's shopping: its perks' offer odds and free rerolls, and gold it saves. */
export interface SpendOptions {
  odds?: OfferOdds;
  freeRerolls?: number;
  /** Gold kept unspent (for interest). */
  reserve?: number;
}

export function spendGold(
  start: Shop,
  style: AiStyle,
  rng: Rng,
  spec: BoardSpec,
  fairy = false,
  round = 1,
  { odds = {}, freeRerolls = 0, reserve = 0 }: SpendOptions = {},
): Shop {
  let shop = start;
  let rerolls = 0;
  /** Gold it's willing to spend. */
  const spendable = () => shop.gold - reserve;
  const like = (t: PieceType) => style.weights[t] ?? 0.1;
  for (;;) {
    const offers = shop.offers ?? [];
    const full = shop.pieces.length >= armyCap(spec);
    const pawns = shop.pieces.filter((p) => isPawnLike(p.type)).length;
    const pawnRoom = pawns < pawnSquares(spec);

    const merged = bestMerge(shop, full, fairy);
    if (merged) {
      shop = merged;
      continue;
    }

    // Affinity pawns: add to the fullest set, or start one the style likes.
    const count = (a: Affinity) => shop.pieces.filter((p) => p.affinity === a).length;
    const sets = new Set(shop.pieces.flatMap((p) => (p.affinity ? [p.affinity] : [])));
    const candidates = offers
      .map((o, i) => ({ o, i, a: affinityOf(o) }))
      .filter((c): c is { o: Offer; i: number; a: Affinity } => c.a !== null && offerPrice(c.o) <= spendable())
      .filter((c) => sets.has(c.a) || sets.size < MAX_SETS)
      // A Rook needs only two rook-pawns; more wait on the bench for a Bishop, Knight or Man.
      .filter((c) => count(c.a) < setSize(c.a));
    if (candidates.length > 0) {
      const left = (a: Affinity) => setSize(a) - count(a);
      const best = candidates.reduce((x, y) =>
        left(y.a) < left(x.a) || (left(y.a) === left(x.a) && like(y.a) > like(x.a)) ? y : x,
      );
      const r = buyOffer(shop, best.i);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // Finished pieces the style likes (and plain pawns while short of the style's pawn share).
    const wantPawn = pawnRoom && pawns * PIECE_VALUE.P < style.pawnShare * (armyValue(shop) + shop.gold);
    const pieces = offers
      .map((o, i) => ({ o, i }))
      .filter(
        ({ o }) =>
          !isAffinityOffer(o) && offerPrice(o) <= spendable() && !full && (!isPawnLike(o as PieceType) || wantPawn),
      );
    if (pieces.length > 0) {
      const score = (o: Offer) => (isPawnLike(o as PieceType) ? 1 : like(o as PieceType));
      const best = pieces.reduce((x, y) => (score(y.o) > score(x.o) ? y : x));
      const r = buyOffer(shop, best.i);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // Gold upgrades: a plain pawn into the minor piece the style likes.
    const plainPawn = shop.pieces.find((p) => p.type === 'P' && !p.affinity);
    if (plainPawn && rerolls >= MAX_REROLLS) {
      const options = UPGRADES.P.filter((to) => upgradeCost('P', to) <= spendable());
      if (options.length > 0) {
        const to = weightedPick(options, like, rng);
        const r = upgradePiece(shop, plainPawn.id, to);
        if (r.ok) {
          shop = r.shop;
          continue;
        }
      }
    }

    // Full with nothing to do: sell the cheapest piece for a finished piece worth more than it.
    if (full) {
      const cheapest = shop.pieces
        .filter((p) => p.type !== 'K' && !p.affinity)
        .reduce<Piece | null>((a, b) => (!a || PIECE_VALUE[b.type] < PIECE_VALUE[a.type] ? b : a), null);
      if (cheapest) {
        const budget = spendable() + sellValue(cheapest);
        const better = offers
          .map((o, i) => ({ o, i }))
          .filter(
            ({ o }) =>
              !isAffinityOffer(o) &&
              !isPawnLike(o as PieceType) &&
              PIECE_VALUE[o as PieceType] > PIECE_VALUE[cheapest.type] &&
              offerPrice(o) <= budget,
          )
          .sort((a, b) => offerPrice(b.o) - offerPrice(a.o))[0];
        if (better) {
          const sold = sellPiece(shop, cheapest.id);
          const bought = sold.ok ? buyOffer(sold.shop, better.i) : null;
          if (bought?.ok) {
            shop = bought.shop;
            continue;
          }
        }
      }
    }

    // Spare gold: reroll for new offers (Haggler's first ones are free).
    const cost = rerolls < freeRerolls ? 0 : REROLL_COST;
    if (rerolls < MAX_REROLLS && spendable() >= cost + REROLL_RESERVE) {
      const r = rerollOffers(shop, round, rng, fairy, cost, odds);
      if (r.ok) {
        rerolls++;
        shop = r.shop;
        continue;
      }
    }
    return shop;
  }
}
