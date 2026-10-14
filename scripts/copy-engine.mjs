// Copies the chess engine (Fairy-Stockfish) and coi-serviceworker into public/ so Vite serves them as
// static files. Runs before dev and build. (The rules are the game's own engine, built by build-engine.mjs.)
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const dest = join(root, 'public', 'fairy');
mkdirSync(dest, { recursive: true });
for (const file of ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']) {
  copyFileSync(join(nm, 'fairy-stockfish-nnue.wasm', file), join(dest, file));
}
// It is GPLv3: ship the license text alongside it.
copyFileSync(join(nm, 'fairy-stockfish-nnue.wasm', 'Copying.txt'), join(dest, 'GPL-3.0.txt'));
// Makes the page cross-origin isolated on hosts that can't send COOP/COEP headers (GitHub Pages).
copyFileSync(
  join(nm, 'coi-serviceworker', 'coi-serviceworker.min.js'),
  join(root, 'public', 'coi-serviceworker.min.js'),
);
