import { reduceMotion } from './settings';

/** The confetti's colours: the game's coral, teal, yellow, pink and lilac. */
const COLORS = ['#ff7a59', '#33c3b0', '#ffc93c', '#ff5e8a', '#e9e0fc'];

/**
 * Throws `count` bits of confetti up and out from `layer` (a won round, more for a won run), to fall
 * away again. Purely decorative: the CSS animation does the moving, and with reduced motion there's none.
 */
export function throwConfetti(layer: HTMLElement, count: number, rng: () => number = Math.random): void {
  if (reduceMotion()) return;
  const bits = Array.from({ length: count }, () => {
    const bit = document.createElement('i');
    // A fan pointing up: straight up ±70°, at different speeds.
    const angle = ((-90 + (rng() - 0.5) * 140) * Math.PI) / 180;
    const reach = 80 + rng() * 150;
    bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
    bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach)}px`);
    bit.style.setProperty('--r', `${Math.round((rng() - 0.5) * 900)}deg`);
    bit.style.setProperty('--d', `${(rng() * 0.15).toFixed(2)}s`);
    bit.style.setProperty('--c', COLORS[Math.floor(rng() * COLORS.length)]);
    if (rng() < 0.4) bit.style.borderRadius = '50%';
    return bit;
  });
  layer.replaceChildren(...bits);
}
