import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  // Heavy specs (1000-document corpus, hostile files) are tagged @heavy and run only with RL_HEAVY_TESTS=1 (CI).
  grepInvert: process.env.RL_HEAVY_TESTS === '1' ? undefined : /@heavy/,
  use: { trace: 'retain-on-failure' },
});
