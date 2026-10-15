import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The browser smoke tests against a `fairy` build: Fairy-Stockfish plays the battles, as before the game
// had its own engine (src/engine/engineChoice.ts). Keeps the way back working. Its preview server sends
// the COOP/COEP headers that engine needs (vite.config.ts).
const PORT = 4322;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${PORT}/` },
  webServer: {
    // Its own folder: CI deploys dist/, which must stay the normal build.
    command: `npm run build-engine && npx vite build --mode fairy --outDir dist-fairy && npx vite preview --mode fairy --outDir dist-fairy --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
