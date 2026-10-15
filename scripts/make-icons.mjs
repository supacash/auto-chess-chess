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
import { join as joinParts, part, render } from './pieces/draw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Knight wearing the Heir's crown, white with dark lines.
const crowned = joinParts(part(DRAWINGS.N, 0.86, 9, 12), part(DRAWINGS.J, 0.36, 26, 7));
const knight = render(crowned, { fill: '#fff', line: '#111', detail: '#111' });

// 512×512, full-bleed background so it also works as a maskable icon (content in the middle 80%).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#1a1035"/>
<g transform="rotate(8 256 256)"><rect x="106" y="122" width="300" height="300" rx="78" fill="#1f8c7e"/><rect x="106" y="106" width="300" height="300" rx="78" fill="#33c3b0"/></g>
<g transform="rotate(-5 256 256)"><rect x="106" y="122" width="300" height="300" rx="78" fill="#c9502f"/><rect x="106" y="106" width="300" height="300" rx="78" fill="#ff7a59"/></g>
<g transform="translate(112 100) scale(2.88)">${knight}</g>
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
