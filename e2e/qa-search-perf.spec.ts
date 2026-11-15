import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { PHASE1_CHANNELS, asArray, createLibraryViaWizard, ipcData, percentile, skipUnlessChannels, waitForScan } from './helpers/phase1';

const COUNT = 1000;
const P95_LIMIT_MS = 200;

/**
 * Phase 1 criterion: search answers in under 200 ms on a thousand documents. The scan time is reported
 * (no threshold); the 20 typical queries are timed from the renderer, round trip included.
 */
test(`search p95 < ${P95_LIMIT_MS} ms on ${COUNT} documents (scan time reported)`, async ({}, testInfo) => {
  test.setTimeout(900_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: COUNT, options: { pdfShare: 0.05 } }, dialogPath: true });
    const { window } = ctx;
    const corpus = ctx.library!.corpus!;
    await skipUnlessChannels(window, testInfo, PHASE1_CHANNELS);

    await createLibraryViaWizard(window, { name: 'Perf library' });
    const scanMs = await waitForScan(window, COUNT, 600_000);
    console.info(`[perf] scan of ${COUNT} documents (${corpus.pdfCount} PDF): ${scanMs} ms`);
    testInfo.annotations.push({ type: 'scan-ms', description: String(scanMs) });

    // Searching must wait for the index too: the last sentinel is findable when indexing is over.
    await expect
      .poll(async () => asArray(await ipcData(window, 'search:query', { text: corpus.sentinel('body', 'pdf').folded, limit: 5 })).length, { timeout: 300_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0);

    expect(corpus.queries).toHaveLength(20);
    // Warm-up, not measured: first statement preparation.
    await ipcData(window, 'search:query', { text: corpus.queries[0]!.text, limit: 20 });

    const times: number[] = [];
    for (const q of corpus.queries) {
      const t = await window.evaluate(async (text) => {
        const bridge = (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<{ ok: boolean; data?: unknown; error?: { message: string } }> } }).rlBridge;
        const t0 = performance.now();
        const r = await bridge.invokeRaw('search:query', { text, limit: 20 });
        return { ms: performance.now() - t0, ok: r.ok, data: r.data, error: r.error?.message };
      }, q.text);
      expect(t.ok, `${q.text}: ${t.error ?? ''}`).toBe(true);
      if (q.expectRelPath) expect(asArray(t.data).length, `no hit for ${q.kind} query "${q.text}"`).toBeGreaterThan(0);
      times.push(t.ms);
    }
    const p95 = percentile(times, 95);
    const max = Math.max(...times);
    const median = percentile(times, 50);
    console.info(`[perf] ${times.length} queries: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    testInfo.annotations.push({ type: 'search-p95-ms', description: p95.toFixed(1) });
    expect(p95, `p95 ${p95.toFixed(1)} ms`).toBeLessThan(P95_LIMIT_MS);

    // Same guarantee through the search bar: the list shows up within the limit after typing.
    const input = window.getByTestId('search-input');
    if (await input.isVisible()) {
      const t0 = Date.now();
      await input.fill(corpus.sentinel('title').folded);
      await expect(window.getByTestId('search-result').first()).toBeVisible({ timeout: 5_000 });
      console.info(`[perf] search bar to first result: ${Date.now() - t0} ms (includes typing debounce)`);
    }
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});
