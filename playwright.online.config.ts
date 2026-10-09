import { defineConfig, devices } from '@playwright/test';

// Online multiplayer tests: two (or more) browsers in one room, against the local Firebase emulators.
// Run with: npm run e2e:online (starts the emulators, builds the app pointed at them, runs the tests).
const PORT = 4322;

export default defineConfig({
  testDir: 'e2e-online',
  timeout: 240_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  webServer: {
    // Built into its own folder: dist/ is what gets deployed, and must never point at the emulators.
    command: `npm run build -- --mode emulator --outDir dist-emulator && npx vite preview --outDir dist-emulator --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
