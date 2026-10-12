import { defineConfig } from '@playwright/test';
import online from './playwright.online.config';

// The whole-match online test (e2e-online/fullmatch.spec.ts): tens of minutes, so it has its own
// command (npm run e2e:fullmatch) and the regular online run skips it.
process.env.FULL_MATCH = '1';

export default defineConfig({
  ...online,
  testMatch: 'fullmatch.spec.ts',
  timeout: 90 * 60_000,
  // Each run keeps its own traces (a later run mustn't overwrite a failure's).
  outputDir: `test-results/fullmatch-${Date.now()}`,
});
