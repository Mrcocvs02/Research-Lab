import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, waitForScan } from './helpers/phase1';
import { rows } from './helpers/ui';

/**
 * Grid thumbnails (D-194..D-196): the first page of each present PDF appears in the grid, from the system when it has
 * one and drawn with pdf.js otherwise (the test machine may or may not have a PDF thumbnail handler, so either source
 * is accepted). After a restart the cached image is shown without being made again. The PDFs stay byte-identical.
 */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const thumbs = (window: Page) => window.locator('[data-testid="doc-thumb"] img');

/** `naturalWidth` of every thumbnail currently in the grid. */
const widths = (window: Page) => thumbs(window).evaluateAll((els) => els.map((e) => ({ src: (e as HTMLImageElement).src, w: (e as HTMLImageElement).naturalWidth })));

test('PDFs show their first page in the grid, cached across a restart', async () => {
  test.setTimeout(300_000);
  let ctx1: LaunchedApp | undefined;
  let ctx2: LaunchedApp | undefined;
  try {
    ctx1 = await launchApp({ library: 'papers', dialogPath: true, offline: true });
    const { window } = ctx1;
    const manifest = ctx1.library!.manifest!;
    const root = ctx1.library!.root;
    const pdfs = manifest.files.filter((f) => f.format === 'pdf');
    expect(pdfs.length).toBeGreaterThan(0);
    const before = await Promise.all(pdfs.map(async (f) => sha(await readFile(path.join(root, f.relPath)))));

    await createLibraryViaWizard(window, { name: 'Thumbs library' });
    await waitForScan(window, manifest.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    // The list view never loads anything for thumbnails.
    await expect(rows(window).first()).toBeVisible();
    await expect(window.locator('[data-testid="doc-thumb"]')).toHaveCount(0);

    await window.getByTestId('view-grid').click();
    await expect(rows(window).first()).toHaveAttribute('data-view', 'grid');
    await expect.poll(async () => (await widths(window)).filter((x) => x.w > 0).length, { timeout: 90_000, intervals: [250, 500, 1000] }).toBeGreaterThan(0);
    const shown = (await widths(window)).filter((x) => x.w > 0);
    for (const t of shown) expect(t.src).toMatch(/^rl-thumb:\/\/thumb\/[0-9a-f]{16}\?v=[0-9a-f]{8}$/);
    await expect(thumbs(window).first()).toBeVisible();
    const ids = shown.map((x) => /thumb\/([0-9a-f]{16})/.exec(x.src)![1]!);

    // Each shown document is now cached: main answers with the url and nothing left to draw.
    const listed = await ipcData<{ items: Array<{ docId: string; url: string | null; drawable: boolean }> }>(window, 'thumbs:list', { docIds: ids });
    expect(listed.items.every((i) => i.url !== null && !i.drawable)).toBe(true);

    // ---- restart on the same data: the thumbnails are there without being made again
    await ctx1.app.close();
    ctx2 = await launchApp({ offline: true, env: { RL_USER_DATA_DIR: ctx1.userDataDir, RL_LOCAL_DATA_DIR: ctx1.localDataDir } });
    const w2 = ctx2.window;
    await expect(rows(w2).first()).toBeVisible({ timeout: 60_000 });
    const again = await ipcData<{ items: Array<{ docId: string; url: string | null; drawable: boolean }> }>(w2, 'thumbs:list', { docIds: ids });
    expect(again.items.map((i) => [i.url !== null, i.drawable])).toEqual(ids.map(() => [true, false]));
    if ((await w2.getByTestId('view-grid').getAttribute('aria-pressed')) !== 'true') await w2.getByTestId('view-grid').click();
    await expect.poll(async () => (await widths(w2)).filter((x) => x.w > 0).length, { timeout: 60_000, intervals: [250, 500, 1000] }).toBeGreaterThan(0);

    const after = await Promise.all(pdfs.map(async (f) => sha(await readFile(path.join(root, f.relPath)))));
    expect(after).toEqual(before);
    expect(before).toEqual(pdfs.map((f) => f.sha256));
    await ctx1.verifyLibraryUntouched();
  } finally {
    await ctx2?.close();
    await ctx1?.close();
  }
});

test('rl-thumb serves only thumbnails: other names and other origins get nothing', async () => {
  test.setTimeout(120_000);
  const ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true });
  try {
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Thumbs scheme' });
    await waitForScan(window, ctx.library!.manifest!.files.length);
    const get = (url: string) => window.evaluate(async (u) => (await fetch(u).then((r) => r.status, () => -1)), url);
    for (const u of ['rl-thumb://thumb/0000000000000000?v=00000000', 'rl-thumb://thumb/not-an-id?v=00000000', 'rl-thumb://thumb/../../x?v=00000000', 'rl-thumb://other/0000000000000000?v=00000000']) {
      const status = await get(u);
      expect([u, status === 404 || status === -1]).toEqual([u, true]);
    }
  } finally {
    await ctx.close();
  }
});
