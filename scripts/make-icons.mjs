// Generates the app icon (public/icon.svg) and logo (public/logo.svg): the crowned Centaur (the Chessnut white knight, Apache 2.0,
// see src/assets/pieces/README.md, with a crown) on a coral tile over a teal one, on the game's violet.
// The PNG sizes (public/icon-*.png, apple-touch-icon.png) are rasterized from it in a browser
// (draw the SVG on a canvas and save toDataURL) and committed alongside.
//
// Run: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const centaurSvg = readFileSync(join(root, 'src', 'assets', 'pieces', 'wT.svg'), 'utf8');
const centaur = centaurSvg.slice(centaurSvg.indexOf('>') + 1, centaurSvg.lastIndexOf('</svg>'));

// 512×512, full-bleed background so it also works as a maskable icon (content in the middle 80%).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#1a1035"/>
<g transform="rotate(8 256 256)"><rect x="106" y="122" width="300" height="300" rx="78" fill="#1f8c7e"/><rect x="106" y="106" width="300" height="300" rx="78" fill="#33c3b0"/></g>
<g transform="rotate(-5 256 256)"><rect x="106" y="122" width="300" height="300" rx="78" fill="#c9502f"/><rect x="106" y="106" width="300" height="300" rx="78" fill="#ff7a59"/></g>
<g transform="translate(112 100) scale(0.36)">${centaur}</g>
</svg>
`;
writeFileSync(join(root, 'public', 'icon.svg'), svg);
// The same tiles without the background, for the menu and header.
writeFileSync(join(root, 'public', 'logo.svg'), svg.replace(/<rect [^>]*\/>\n/, ''));
console.log('Wrote public/icon.svg and public/logo.svg');
