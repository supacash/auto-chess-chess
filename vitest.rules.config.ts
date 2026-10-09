import { defineConfig } from 'vitest/config';

// Security rules tests run against the Firestore emulator: npm run test:rules (needs Java).
export default defineConfig({
  test: { include: ['rules-test/**/*.test.ts'], testTimeout: 20_000, fileParallelism: false },
});
