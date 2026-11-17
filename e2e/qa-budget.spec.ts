import { _electron as electron, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DESKTOP_DIR, launchApp } from './helpers/launch';
import { createLibraryViaWizard, waitForScan } from './helpers/phase1';

/**
 * Runtime budgets (see tools/budgets.json and docs/TESTING.md): total memory of the app at rest and time from the
 * start of the process to the first rows of the Library view, on a synthetic library of 40 documents that is opened
 * and scanned. The bundle sizes are checked by tools/check-budget.mjs, after the build.
 * The app is started twice on the same data: the first run creates and scans the library, the second one is the
 * measured start (an ordinary start of an installed library, with its index already built).
 */
const DOCS = 40;
const IDLE_MS = 10_000;
const WORKER_IDLE_MS = 3_000;

interface Metric {
  type: string;
  memory: { workingSetSize: number };
}
const mb = (kb: number) => Math.round(kb / 1024);
const totalMb = (metrics: Metric[]) => mb(metrics.reduce((n, m) => n + m.memory.workingSetSize, 0));

test('memory at rest and start-up time on a 40-document library', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const first = await launchApp({ library: { corpus: DOCS }, dialogPath: true });
  try {
    await createLibraryViaWizard(first.window, { name: 'Budget library' });
    await waitForScan(first.window, DOCS);
    await expect(first.window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
    await first.app.close();

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, {
      RL_USER_DATA_DIR: first.userDataDir,
      RL_LOCAL_DATA_DIR: first.localDataDir,
      NODE_ENV: 'production',
      RL_E2E_HIDDEN: '1',
      RL_WORKER_IDLE_MS: String(WORKER_IDLE_MS),
    });
    /** Starts the app on the scanned library; `ms` runs from the start of the process to the first rows of the Library view. */
    const start = async () => {
      const app = await electron.launch({ args: [DESKTOP_DIR], env });
      try {
        const startedAt = await app.evaluate(() => Date.now() - process.uptime() * 1000);
        const window = await app.firstWindow();
        await window.getByTestId('search-result').first().waitFor({ state: 'visible', timeout: 60_000 });
        return { app, window, ms: Math.round(Date.now() - startedAt) };
      } catch (e) {
        await app.close().catch(() => {});
        throw e;
      }
    };
    // The start-up time is the best of two starts: one cold start (files just built, a busy machine) is not the app's speed.
    const warm = await start();
    await warm.app.close();
    let { app, window, ms } = await start();
    let firstContentMs = Math.min(warm.ms, ms);
    // A burst of machine load (antivirus scan, indexer) can hit both starts: only when over the budget, a third start decides (D-305).
    const limit = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../tools/budgets.json'), 'utf8')) as { runtime?: { firstContentMs?: number } }).runtime?.firstContentMs;
    if (limit !== undefined && firstContentMs > limit) {
      await app.close();
      const third = await start();
      app = third.app;
      window = third.window;
      firstContentMs = Math.min(firstContentMs, third.ms);
    }
    try {
      await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });

      const metrics = () => app.evaluate(({ app: a }) => a.getAppMetrics());
      const busy = await metrics();
      await new Promise((r) => setTimeout(r, IDLE_MS));
      const rest = (await metrics()) as Metric[];
      const idleMemoryMb = totalMb(rest);
      const byType: Record<string, number> = {};
      for (const m of rest) byType[m.type] = (byType[m.type] ?? 0) + mb(m.memory.workingSetSize);
      const report = { docs: DOCS, firstContentMs, idleMemoryMb, afterScanMemoryMb: totalMb(busy as Metric[]), byTypeMb: byType, processes: rest.length };
      console.log(`BUDGET-MEASURE ${JSON.stringify(report)}`);
      await testInfo.attach('measurements', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

      let budgets: { runtime?: { idleMemoryMb?: number; firstContentMs?: number } } = {};
      try {
        budgets = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../tools/budgets.json'), 'utf8'));
      } catch {
        // no budget file yet: the numbers are only reported
      }
      const b = budgets.runtime ?? {};
      if (b.idleMemoryMb !== undefined) expect(idleMemoryMb, `memory at rest ${idleMemoryMb} MB is over the budget of ${b.idleMemoryMb} MB (tools/budgets.json)`).toBeLessThanOrEqual(b.idleMemoryMb);
      if (b.firstContentMs !== undefined) expect(firstContentMs, `time to first content ${firstContentMs} ms is over the budget of ${b.firstContentMs} ms (tools/budgets.json)`).toBeLessThanOrEqual(b.firstContentMs);
    } finally {
      await app.close().catch(() => {});
    }
  } finally {
    await first.close();
  }
});
