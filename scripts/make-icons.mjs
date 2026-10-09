// Generates the app icon (public/icon.svg): the Chessnut white knight (Apache 2.0, see
// src/assets/pieces/README.md) on the game's dark background with a green ring.
// The PNG sizes (public/icon-*.png, apple-touch-icon.png) are rasterized from it in a browser
// (draw the SVG on a canvas and save toDataURL) and committed alongside.
//
// Run: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const knightSvg = readFileSync(join(root, 'src', 'assets', 'pieces', 'wN.svg'), 'utf8');
const knight = knightSvg.slice(knightSvg.indexOf('>') + 1, knightSvg.lastIndexOf('</svg>'));

// 512×512, full-bleed background so it also works as a maskable icon (content in the middle 80%).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#343842"/><stop offset="1" stop-color="#1d1f24"/></radialGradient></defs>
<rect width="512" height="512" fill="url(#bg)"/>
<circle cx="256" cy="256" r="176" fill="none" stroke="#5fb36b" stroke-width="14"/>
<g transform="translate(116 106) scale(0.35)">${knight}</g>
</svg>
`;
writeFileSync(join(root, 'public', 'icon.svg'), svg);
console.log('Wrote public/icon.svg');
