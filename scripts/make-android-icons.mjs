// Generates the Android app's launcher icons and splash screens from public/icon.svg (see
// make-icons.mjs), replacing Capacitor's defaults. Rasterized in Chromium through Playwright.
//
// Run: node scripts/make-android-icons.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const icon = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');
// The adaptive icon's foreground: the ring and Centaur without the background, shrunk into the
// launcher mask's safe zone (the background colour is ic_launcher_background).
const foreground = icon
  .replace(/<rect [^>]*\/>/, '')
  .replace(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45 -45 602 602">',
  );
const BACKGROUND = '#1d1f24';

const browser = await chromium.launch();
const page = await browser.newPage();

/** Draws `svg` on a `w`×`h` canvas: filling it, or (`fit`) centred at that share of the short side on BACKGROUND. */
async function png(svg, w, h, fit = 0) {
  const data = await page.evaluate(
    async ({ svg, w, h, fit, background }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (fit) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
        const s = Math.min(w, h) * fit;
        ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s);
      } else ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/png').split(',')[1];
    },
    { svg, w, h, fit, background: BACKGROUND },
  );
  return Buffer.from(data, 'base64');
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${density}`);
  const size = Math.round(48 * scale);
  writeFileSync(join(dir, 'ic_launcher.png'), await png(icon, size, size));
  writeFileSync(join(dir, 'ic_launcher_round.png'), await png(icon, size, size));
  const fg = Math.round(108 * scale);
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), await png(foreground, fg, fg));
}
writeFileSync(
  join(res, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND.toUpperCase()}</color>\n</resources>\n`,
);

// Splash screens: the icon in the middle of the dark background, at each existing size.
for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const file = join(res, dir, 'splash.png');
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue;
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  writeFileSync(file, await png(foreground, w, h, 0.4));
}
await browser.close();
console.log('Wrote the Android launcher icons and splash screens');
