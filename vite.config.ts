import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { syncFairyFiles } from './scripts/fairy-files.mjs';

/**
 * `vite --mode fairy` builds the old Fairy-Stockfish setup, kept so the game can go back to it
 * (src/engine/engineChoice.ts): the multithreaded engine needs a cross-origin-isolated page, so the
 * dev/preview server sends COOP/COEP headers and the page loads coi-serviceworker (for hosts like
 * GitHub Pages that can't send them). Other builds use the game's own engine and need none of it.
 */
function fairyStockfish(fairy: boolean): Plugin {
  return {
    name: 'fairy-stockfish',
    buildStart() {
      syncFairyFiles(fairy);
    },
    transformIndexHtml(html) {
      if (!fairy) return html;
      // Always COEP require-corp: the default "credentialless" for non-Chromium browsers isn't
      // supported by Safari, which then never becomes isolated. Everything here is same-origin.
      return html.replace(
        '</title>',
        '</title>\n    <script>window.coi = { coepCredentialless: () => false };</script>\n    <script src="coi-serviceworker.min.js"></script>',
      );
    },
  };
}

// Relative base so the build works both locally and under a GitHub Pages sub-path (/auto-chess-chess/).
export default defineConfig(({ mode }) => {
  const fairy = mode === 'fairy';
  const isolation = fairy
    ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
    : {};
  return {
    base: './',
    // Tests don't build the page, so they leave the files alone.
    plugins: mode === 'test' ? [] : [fairyStockfish(fairy)],
    server: { headers: isolation },
    preview: { headers: isolation },
    // The engine runs in a module worker (src/engine/engineWorker.ts) that imports its WASM bindings.
    worker: { format: 'es' },
    // e2e/ holds the Playwright browser tests (npm run e2e) and rules-test/ the emulator tests (npm run test:rules).
    test: { exclude: [...configDefaults.exclude, 'e2e/**', 'e2e-online/**', 'rules-test/**'] },
  };
});
