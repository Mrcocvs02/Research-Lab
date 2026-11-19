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

/**
 * Loads a URL through an `<img>` (the way the app uses `rl-thumb`: `img-src` allows the scheme, `connect-src` does not, so
 * `fetch` could not tell anything) and gives its `naturalWidth`, 0 when it does not load.
 */
const imgWidth = (window: Page, url: string) =>
  window.evaluate(
    (u) =>
      new Promise<number>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth);
        img.onerror = () => resolve(0);
        img.src = u;
      }),
    url,
  );

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

    await window.getByTestId('view-menu').click();
    await window.getByTestId('view-grid').click();
    await expect(rows(window).first()).toHaveAttribute('data-view', 'grid');
    await expect.poll(async () => (await widths(window)).filter((x) => x.w > 0).length, { timeout: 90_000, intervals: [250, 500, 1000] }).toBeGreaterThan(0);
    const shown = (await widths(window)).filter((x) => x.w > 0);
    for (const t of shown) expect(t.src).toMatch(/^rl-thumb:\/\/thumb\/[0-9a-f]{16}\?v=[0-9a-f]{8}$/);
    await expect(thumbs(window).first()).toBeVisible();
    // The card is vertical (D-500): a 4:3 view of the top of the first page over the full title, so the card is taller than wide.
    const thumb = (await window.locator('[data-testid="doc-thumb"]').first().boundingBox())!;
    expect(thumb.width / thumb.height, 'thumbnail 4:3').toBeCloseTo(4 / 3, 1);
    const card = (await window.getByTestId('search-result').first().boundingBox())!;
    expect(card.height, 'vertical card').toBeGreaterThan(card.width);
    const ids = shown.map((x) => /thumb\/([0-9a-f]{16})/.exec(x.src)![1]!);

    // Each shown document is now cached: main answers with the url and nothing left to draw.
    const listed = await ipcData<{ items: Array<{ docId: string; url: string | null; drawable: boolean }> }>(window, 'thumbs:list', { docIds: ids });
    expect(listed.items.every((i) => i.url !== null && !i.drawable)).toBe(true);

    // ---- restart on the same data: the thumbnails are there without being made again
    await ctx1.app.close();
    ctx2 = await launchApp({ offline: true, env: { RL_USER_DATA_DIR: ctx1.userDataDir, RL_LOCAL_DATA_DIR: ctx1.localDataDir } });
    const w2 = ctx2.window;
    await expect(rows(w2).first()).toBeVisible({ timeout: 60_000 });
    // The images of the first session are served again from the cache, through an <img>, with no drawing.
    for (const t of shown.slice(0, 3)) expect(await imgWidth(w2, t.src)).toBeGreaterThan(0);
    const again = await ipcData<{ items: Array<{ docId: string; url: string | null; drawable: boolean }> }>(w2, 'thumbs:list', { docIds: ids });
    expect(again.items.map((i) => [i.url !== null, i.drawable])).toEqual(ids.map(() => [true, false]));
    if ((await rows(w2).first().getAttribute('data-view')) !== 'grid') {
      await w2.getByTestId('view-menu').click();
      await w2.getByTestId('view-grid').click();
    }
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

test('rl-thumb serves only thumbnails: other names and versions do not load as images', async () => {
  test.setTimeout(180_000);
  const ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true });
  try {
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Thumbs scheme' });
    await waitForScan(window, ctx.library!.manifest!.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
    await window.getByTestId('view-menu').click();
    await window.getByTestId('view-grid').click();
    await expect.poll(async () => (await widths(window)).filter((x) => x.w > 0).length, { timeout: 90_000, intervals: [250, 500, 1000] }).toBeGreaterThan(0);
    const good = (await widths(window)).find((x) => x.w > 0)!.src;
    const m = /^rl-thumb:\/\/thumb\/([0-9a-f]{16})\?v=([0-9a-f]{8})$/.exec(good);
    expect(m).not.toBeNull();
    // A real thumbnail decodes as an image (this is the positive control: the checks below fail for the right reason).
    expect(await imgWidth(window, good)).toBeGreaterThan(0);
    const id = m![1]!;
    for (const u of [
      `rl-thumb://thumb/${id}?v=ffffffff`, // right document, content that has no thumbnail
      'rl-thumb://thumb/0000000000000000?v=00000000', // unknown document
      'rl-thumb://thumb/not-an-id?v=00000000',
      'rl-thumb://thumb/../../x?v=00000000',
      `rl-thumb://other/${id}?v=${m![2]}`, // another host of the scheme
    ]) {
      expect([u, await imgWidth(window, u)]).toEqual([u, 0]);
    }
  } finally {
    await ctx.close();
  }
});
