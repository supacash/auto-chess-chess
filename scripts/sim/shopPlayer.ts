/**
 * The `--player shop` stand-in: keeps one persistent Shop for the whole run and spends its gold
 * each round with a simple greedy plan, like a player who never rerolls.
 *
 * Per step: buy a pawn offer while pawns are below the style's pawn share of the army's total
 * value (army + gold); otherwise buy the affordable offer the style likes best (pawns only if they
 * fit). Once the army fills the board, it merges to free squares: three pawns into a minor piece, a
 * minor piece and two pawns into a rook (both points-neutral), then two rooks into a queen and two
 * minor pieces into a rook (each loses a point). Gold upgrades (which cost more than they add) come
 * after that, and when nothing else is left it sells its cheapest piece for a more valuable offer.
 * Gold that fits nothing carries over. Like a sensible player, it only buys pawns that fit the
 * current board's home rows. Every action goes through the real shop functions, so the caps apply
 * exactly as in the game. The caller stocks `shop.offers` each round.
 */
import { type BoardSpec, pawnSquares } from '../../src/chess/boardSpec';
import type { AiStyle } from '../../src/rules/aiArmy';
import {
  buyOffer,
  fusePieces,
  fuseSet,
  pawnFusionResults,
  type Shop,
  sellPiece,
  sellValue,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from '../../src/rules/economy';
import { isPawnLike, type Piece, type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import { armyCap } from '../../src/rules/placement';
import { type Rng, weightedPick } from '../../src/rules/rng';

export function armyValue(shop: Shop): number {
  return shop.pieces.reduce((s, p) => s + PIECE_VALUE[p.type], 0);
}

const isMinor = (t: PieceType) => t === 'N' || t === 'B';

/** One merge that frees squares, best first (points-neutral before lossy), or null. */
function bestMerge(shop: Shop, style: AiStyle, fairy: boolean): Shop | null {
  const pawns = shop.pieces.filter((p) => isPawnLike(p.type));
  const minors = shop.pieces.filter((p) => isMinor(p.type));
  const rooks = shop.pieces.filter((p) => p.type === 'R');
  const like = (t: PieceType) => style.weights[t] ?? 0.1;
  const tries: (() => ReturnType<typeof fuseSet>)[] = [];
  if (pawns.length >= 3) {
    const to = pawnFusionResults(fairy).reduce((a, b) => (like(b) > like(a) ? b : a));
    tries.push(() => fuseSet(shop, ids(pawns.slice(0, 3)), to, fairy));
  }
  if (minors.length >= 1 && pawns.length >= 2)
    tries.push(() => fuseSet(shop, ids([minors[0], ...pawns.slice(0, 2)]), 'R', fairy));
  if (rooks.length >= 2) tries.push(() => fusePieces(shop, rooks[0].id, rooks[1].id, 'Q', fairy));
  if (minors.length >= 2) tries.push(() => fusePieces(shop, minors[0].id, minors[1].id, 'R', fairy));
  for (const attempt of tries) {
    const r = attempt();
    if (r.ok) return r.shop;
  }
  return null;
}

const ids = (pieces: Piece[]) => pieces.map((p) => p.id);

export function spendGold(start: Shop, style: AiStyle, rng: Rng, spec: BoardSpec, fairy = false): Shop {
  let shop = start;
  for (;;) {
    const offers = shop.offers ?? [];
    const pawns = shop.pieces.filter((p) => isPawnLike(p.type)).length;
    const full = shop.pieces.length >= armyCap(spec);

    const pawnFits = !full && pawns < pawnSquares(spec);
    const wantPawn = pawnFits && pawns * PIECE_VALUE.P < style.pawnShare * (armyValue(shop) + shop.gold);
    const pawnOffer = offers.findIndex((t) => isPawnLike(t) && PIECE_VALUE[t] <= shop.gold);
    if (wantPawn && pawnOffer >= 0) {
      const r = buyOffer(shop, pawnOffer);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // The affordable offer it likes best (by style weight, pawns counted as 1): offers cost exactly
    // their value, so they beat gold upgrades.
    const buyable = offers
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => PIECE_VALUE[t] <= shop.gold && !full && (!isPawnLike(t) || pawnFits));
    if (buyable.length > 0) {
      const like = (t: PieceType) => (isPawnLike(t) ? 1 : (style.weights[t] ?? 0.1));
      const best = buyable.reduce((a, b) => (like(b.t) > like(a.t) ? b : a));
      const r = buyOffer(shop, best.i);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // A full board: merge to free squares for more pieces.
    if (full) {
      const merged = bestMerge(shop, style, fairy);
      if (merged) {
        shop = merged;
        continue;
      }
    }

    // Gold upgrades: the fallback (one per piece type and target: pieces of a type are interchangeable).
    const options: { id: string; to: PieceType }[] = [];
    const seen = new Set<string>();
    for (const p of shop.pieces) {
      for (const to of UPGRADES[p.type]) {
        const key = `${p.type}>${to}`;
        if (seen.has(key) || upgradeCost(p.type, to) > shop.gold) continue;
        seen.add(key);
        if (upgradePiece(shop, p.id, to).ok) options.push({ id: p.id, to });
      }
    }
    if (options.length > 0) {
      const pick = weightedPick(options, (o) => style.weights[o.to] ?? 0.1, rng);
      const r = upgradePiece(shop, pick.id, pick.to);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // Still full with nothing to do: sell the cheapest piece for an offer worth more than it.
    if (full) {
      const cheapest = shop.pieces
        .filter((p) => p.type !== 'K')
        .reduce<Piece | null>((a, b) => (!a || PIECE_VALUE[b.type] < PIECE_VALUE[a.type] ? b : a), null);
      if (cheapest) {
        const budget = shop.gold + sellValue(cheapest.type);
        const better = offers
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => PIECE_VALUE[t] > PIECE_VALUE[cheapest.type] && PIECE_VALUE[t] <= budget && !isPawnLike(t))
          .sort((a, b) => PIECE_VALUE[b.t] - PIECE_VALUE[a.t])[0];
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
    return shop;
  }
}
