/**
 * The `--player shop` stand-in: keeps one persistent Shop for the whole run and spends its gold
 * each round with a simple greedy plan, like a player who never sells or rerolls.
 *
 * Per step: buy a pawn offer while pawns are below the style's pawn share of the army's total
 * value (army + gold); otherwise make an affordable upgrade, picked by the style's weights for the
 * target piece; otherwise buy the affordable offer the style likes best (pawns only if they fit).
 * Gold that fits nothing carries over. Like a sensible player, it only buys pawns that fit the
 * current board's home rows. Every purchase goes through buyOffer/upgradePiece, so the army cap
 * applies exactly as in the real shop. The caller stocks `shop.offers` each round.
 */
import { type BoardSpec, homeSquares, pawnSquares } from '../../src/chess/boardSpec';
import type { AiStyle } from '../../src/rules/aiArmy';
import { buyOffer, type Shop, UPGRADES, upgradeCost, upgradePiece } from '../../src/rules/economy';
import { isPawnLike, type PieceType, PIECE_VALUE } from '../../src/rules/pieces';
import { type Rng, weightedPick } from '../../src/rules/rng';

export function armyValue(shop: Shop): number {
  return shop.pieces.reduce((s, p) => s + PIECE_VALUE[p.type], 0);
}

export function spendGold(start: Shop, style: AiStyle, rng: Rng, spec: BoardSpec): Shop {
  let shop = start;
  for (;;) {
    const offers = shop.offers ?? [];
    const pawns = shop.pieces.filter((p) => isPawnLike(p.type)).length;
    const pawnFits = shop.pieces.length < homeSquares(spec) && pawns < pawnSquares(spec);
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
    const fits = shop.pieces.length < homeSquares(spec);
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
    return shop;
  }
}
