import { PIECES, type PieceType } from '../rules/pieces';
import { pieceUrl } from '../ui/boardDom';

/** How many pieces drift behind the main menu at once. */
const FLOATERS = 10;

/** Every piece with its own art: the classic set and the fairy pieces. */
const TYPES = (Object.keys(PIECES) as PieceType[]).filter((t) => pieceUrl(t, 'w'));

/**
 * Fills `layer` with pieces that drift slowly up the screen behind the menu. Each one becomes a
 * different piece every time it leaves the top, so the mix keeps changing. Purely
 * decorative: the CSS animation does the moving (with reduced motion they stay scattered instead).
 */
export function startMenuDrift(layer: HTMLElement, rng: () => number = Math.random): void {
  const pick = (): PieceType => TYPES[Math.floor(rng() * TYPES.length)];
  const dress = (img: HTMLImageElement, i: number): void => {
    // The white art: the black pieces vanish against the violet.
    img.src = pieceUrl(pick(), 'w');
    // Spread across the width in lanes, so pieces don't bunch up.
    const lane = (i + rng()) / FLOATERS;
    img.style.setProperty('--x', `${(lane * 100).toFixed(1)}%`);
    img.style.setProperty('--y', `${Math.round(rng() * 90)}%`);
    img.style.setProperty('--size', `${Math.round(56 + rng() * 64)}px`);
    img.style.setProperty('--dx', `${Math.round((rng() - 0.5) * 120)}px`);
    img.style.setProperty('--r0', `${Math.round((rng() - 0.5) * 60)}deg`);
    img.style.setProperty('--r1', `${Math.round((rng() - 0.5) * 120)}deg`);
  };
  const imgs = Array.from({ length: FLOATERS }, (_, i) => {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    dress(img, i);
    const duration = 22 + rng() * 18;
    img.style.animationDuration = `${duration.toFixed(1)}s`;
    // Already part-way up on load, so the screen isn't empty at first.
    img.style.animationDelay = `${(-rng() * duration).toFixed(1)}s`;
    img.addEventListener('animationiteration', () => dress(img, i));
    return img;
  });
  layer.replaceChildren(...imgs);
}
