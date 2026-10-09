import { defineConfig, devices } from '@playwright/test';

// Browser smoke tests: whole runs in a real browser against the production build. The Vite preview
// server sends the COOP/COEP headers the multithreaded engine needs (see vite.config.ts).
const PORT = 4321;

export default defineConfig({
  testDir: 'e2e',
  // Battles run a real chess engine, so give each test room.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Phone-sized, since the game is built for phones first.
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
