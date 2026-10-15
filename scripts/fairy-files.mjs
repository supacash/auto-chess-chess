// The Fairy-Stockfish setup, kept so the game can go back to it (src/engine/engineChoice.ts): for a
// `fairy` build (vite --mode fairy), copies the engine and coi-serviceworker from node_modules into
// public/ so Vite serves them; for every other build, removes the engine, so GPL files never ship by
// accident, and replaces coi-serviceworker with one that retires it from browsers that still have it.
// Called by the fairy-stockfish plugin in vite.config.ts.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const dest = join(root, 'public', 'fairy');
const coi = join(root, 'public', 'coi-serviceworker.min.js');

const RETIRE_COI = `// Retires coi-serviceworker: the game no longer needs cross-origin isolation.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url)))),
  );
});
`;

export function syncFairyFiles(fairy) {
  if (!fairy) {
    rmSync(dest, { recursive: true, force: true });
    // Browsers that visited before the game had its own engine still have coi-serviceworker installed.
    // When they next check it for updates they get this instead: it unregisters itself and reloads the
    // page, which then runs without cross-origin isolation (nothing needs it any more).
    writeFileSync(coi, RETIRE_COI);
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const file of ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']) {
    copyFileSync(join(nm, 'fairy-stockfish-nnue.wasm', file), join(dest, file));
  }
  // GPLv3: ship the license text alongside it.
  copyFileSync(join(nm, 'fairy-stockfish-nnue.wasm', 'Copying.txt'), join(dest, 'GPL-3.0.txt'));
  // Makes the page cross-origin isolated on hosts that can't send COOP/COEP headers (GitHub Pages).
  copyFileSync(join(nm, 'coi-serviceworker', 'coi-serviceworker.min.js'), coi);
}
