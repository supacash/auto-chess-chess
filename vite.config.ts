import { defineConfig } from 'vite';

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
});
