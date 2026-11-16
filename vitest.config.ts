import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/out/**', 'e2e/**'],
    testTimeout: 20_000,
    // The dev machine has limited RAM: cap parallel test files (override with VITEST_MAX_WORKERS).
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 3),
  },
});
