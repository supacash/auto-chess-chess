/**
 * The `--player shop` stand-in: keeps one persistent Shop for the whole run and spends its gold
 * each round with a simple greedy plan, like a player who never rerolls.
 *
 * Per step: buy a pawn offer while pawns are below the style's pawn share of the army's total
 * value (army + gold); otherwise make an affordable upgrade, picked by the style's weights for the
 * target piece; otherwise buy the affordable offer the style likes best (pawns only if they fit).
 * Once the army fills the board, it fuses three pawns into a piece (freeing two squares) and, when
 * nothing else is left to do, sells its cheapest piece for a more valuable offer.
 * Gold that fits nothing carries over. Like a sensible player, it only buys pawns that fit the
 * current board's home rows. Every purchase goes through buyOffer/upgradePiece, so the army cap
 * applies exactly as in the real shop. The caller stocks `shop.offers` each round.
 */
import { type BoardSpec, pawnSquares } from '../../src/chess/boardSpec';
import { armyCap } from '../../src/rules/placement';
import type { AiStyle } from '../../src/rules/aiArmy';
import {
  buyOffer,
  fusePawns,
  pawnFusionResults,
  type Shop,
  sellPiece,
  sellValue,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from '../../src/rules/economy';
import { isPawnLike, type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import { type Rng, weightedPick } from '../../src/rules/rng';

export function armyValue(shop: Shop): number {
  return shop.pieces.reduce((s, p) => s + PIECE_VALUE[p.type], 0);
}

export function spendGold(start: Shop, style: AiStyle, rng: Rng, spec: BoardSpec, fairy = false): Shop {
  let shop = start;
  for (;;) {
    const offers = shop.offers ?? [];
    const pawnPieces = shop.pieces.filter((p) => isPawnLike(p.type));
    const pawns = pawnPieces.length;
    const full = shop.pieces.length >= armyCap(spec);

    // A full board: fuse three pawns into the piece the style likes best (same points, two squares freed).
    if (full && pawns >= 3) {
      const result = pawnFusionResults(fairy).reduce((a, b) =>
        (style.weights[b] ?? 0.1) > (style.weights[a] ?? 0.1) ? b : a,
      );
      const r = fusePawns(shop, pawnPieces[0].id, result, fairy);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }
    const pawnFits = shop.pieces.length < armyCap(spec) && pawns < pawnSquares(spec);
    const wantPawn = pawnFits && pawns * PIECE_VALUE.P < style.pawnShare * (armyValue(shop) + shop.gold);
    const pawnOffer = offers.findIndex((t) => isPawnLike(t) && PIECE_VALUE[t] <= shop.gold);
    if (wantPawn && pawnOffer >= 0) {
      const r = buyOffer(shop, pawnOffer);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // Every legal, affordable upgrade (only one per piece type and target: pieces of a type are interchangeable).
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

    // Otherwise the affordable offer it likes best (by style weight, pawns counted as 1).
    const fits = shop.pieces.length < armyCap(spec);
    const buyable = offers
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => PIECE_VALUE[t] <= shop.gold && fits && (!isPawnLike(t) || pawnFits));
    if (buyable.length > 0) {
      const like = (t: PieceType) => (isPawnLike(t) ? 1 : (style.weights[t] ?? 0.1));
      const best = buyable.reduce((a, b) => (like(b.t) > like(a.t) ? b : a));
      const r = buyOffer(shop, best.i);
      if (r.ok) {
        shop = r.shop;
        continue;
      }
    }

    // Still full with nothing to do: sell the cheapest piece for an offer worth more than it.
    if (full) {
      const cheapest = shop.pieces
        .filter((p) => p.type !== 'K')
        .reduce<(typeof shop.pieces)[number] | null>(
          (a, b) => (!a || PIECE_VALUE[b.type] < PIECE_VALUE[a.type] ? b : a),
          null,
        );
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
