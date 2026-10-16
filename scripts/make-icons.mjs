// Generates the app icon (public/icon.svg) and logo (public/logo.svg): the crowned Knight (the
// game's own piece art, scripts/pieces/, with the Heir's crown) on a coral tile over a teal one, on
// the game's violet; and the PNG sizes (public/icon-192.png, icon-512.png, apple-touch-icon.png),
// rasterized in Chromium through Playwright. `node scripts/make-android-icons.mjs` then makes the
// Android ones from icon.svg.
//
// Run: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DRAWINGS } from './make-pieces.mjs';
import { part, render } from './pieces/draw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Knight wearing the Heir's crown, white with dark lines. The crown sits between his ear and his
// mane, behind the ear: drawn in a layer of its own (with the mane) under the head, so the ear's
// outline and lines stay in front. Its band is left out (the head would hide it).
const PAINT = { fill: '#fff', line: '#111', detail: '#111' };
const knight = part(DRAWINGS.N, 0.86, 9, 12);
const CROWN = { cx: 62, base: 28, s: 0.36 };
const crown = part(
  { shapes: DRAWINGS.J.shapes.slice(0, 2), details: DRAWINGS.J.details.slice(0, 2) },
  CROWN.s,
  CROWN.cx - 50 * CROWN.s,
  CROWN.base - 74 * CROWN.s,
);
const art =
  render({ shapes: [knight.shapes[0], ...crown.shapes], details: crown.details }, PAINT) +
  render({ shapes: knight.shapes.slice(1), details: knight.details }, PAINT);

// 512×512, full-bleed background so it also works as a maskable icon (content in the middle 80%).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#1a1035"/>
<g transform="rotate(8 256 256)"><rect x="106" y="122" width="300" height="300" rx="78" fill="#1f8c7e"/><rect x="106" y="106" width="300" height="300" rx="78" fill="#33c3b0"/></g>
<g transform="rotate(-5 256 256)"><rect x="106" y="122" width="300" height="300" rx="78" fill="#c9502f"/><rect x="106" y="106" width="300" height="300" rx="78" fill="#ff7a59"/></g>
<g transform="translate(112 100) scale(2.88)">${art}</g>
</svg>
`;
writeFileSync(join(root, 'public', 'icon.svg'), svg);
// The same tiles without the background, for the menu and header.
writeFileSync(join(root, 'public', 'logo.svg'), svg.replace(/<rect [^>]*\/>\n/, ''));

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const data = await page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png').split(',')[1];
    },
    { svg, size },
  );
  writeFileSync(join(root, 'public', file), Buffer.from(data, 'base64'));
}
await browser.close();
console.log('Wrote public/icon.svg, logo.svg, icon-192.png, icon-512.png and apple-touch-icon.png');
