import { configDefaults, defineConfig } from 'vitest/config';

// The multithreaded chess engine needs a cross-origin-isolated page. The dev/preview server sends
// the headers; in production coi-serviceworker (index.html) adds them.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Relative base so the build works both locally and under a GitHub Pages sub-path (/auto-chess-chess/).
export default defineConfig({
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
  // e2e/ holds the Playwright browser tests (npm run e2e), not Vitest unit tests.
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
});
