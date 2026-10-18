import type { Color } from '../chess/fen';
import { PIECE_NAME, type PieceType } from '../rules/pieces';
import type { BattleUpgrade } from '../rules/position';

/** A piece's name for more than one ("Men", "Ferzes", "Knights"). */
function plural(type: PieceType): string {
  const name = PIECE_NAME[type];
  // Man → Men, Stackman → Stackmen.
  if (/man$/i.test(name)) return `${name.slice(0, -2)}en`;
  return name === 'Ferz' ? 'Ferzes' : `${name}s`;
}

/** "Synergies! You: Knight → Centaur. Them: 2 Pawns → Knights." */
export function synergyNote(upgrades: readonly BattleUpgrade[], mine: Color): string {
  const side = (color: Color) => {
    const counts = new Map<string, { from: PieceType; to: PieceType; n: number }>();
    for (const u of upgrades) {
      if (u.side !== color) continue;
      const key = `${u.from}${u.to}`;
      const seen = counts.get(key);
      counts.set(key, { from: u.from, to: u.to, n: (seen?.n ?? 0) + 1 });
    }
    return [...counts.values()]
      .map(({ from, to, n }) =>
        n > 1 ? `${n} ${plural(from)} → ${plural(to)}` : `${PIECE_NAME[from]} → ${PIECE_NAME[to]}`,
      )
      .join(', ');
  };
  const you = side(mine);
  const them = side(mine === 'w' ? 'b' : 'w');
  return ['Synergies!', you && `You: ${you}.`, them && `Them: ${them}.`].filter(Boolean).join(' ');
}
