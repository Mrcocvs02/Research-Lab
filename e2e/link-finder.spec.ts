import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipcData, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { clickRow, pickSort } from './helpers/ui';

/**
 * Link finder (§18.2, D-479, D-480): opened from the selection bar, local only; a search adds links with their weight, each can
 * be removed and the whole search undone; links show on the document card; the bridge search lives in the dialog (`lf-bridge`)
 * and needs exactly two documents.
 */
const CHANNELS = ['doclinks:find', 'doclinks:add', 'doclinks:list', 'doclinks:remove'];

test('selection bar opens the finder: run, results, undo; bridge needs exactly two documents', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true });
    const { window } = ctx;
    const papers = ctx.library!.manifest!.files.filter((f) => f.format === 'pdf' && f.title);
    test.skip(papers.length < 3, 'needs three titled PDFs');
    await createLibraryViaWizard(window, { name: 'Links library' });
    await skipUnlessChannels(window, testInfo, CHANNELS);
    await waitForScan(window, ctx.library!.manifest!.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    await window.getByTestId('nav-library').click();
    await pickSort(window, 'title');

    // Two documents: the bridge is on; a search runs and answers (links or an honest "none").
    await clickRow(window, papers[0]!.title!);
    await clickRow(window, papers[1]!.title!, ['Control']);
    await window.getByTestId('selection-more').click();
    await window.getByTestId('selection-links').click();
    await expect(window.getByTestId('linkfinder')).toBeVisible();
    await expect(window.getByTestId('lf-bridge')).toBeEnabled();
    await window.getByTestId('lf-wide').click();
    await window.getByTestId('lf-run').click();
    await expect(window.getByTestId('lf-results')).toBeVisible({ timeout: 60_000 });
    const added = await window.getByTestId('lf-result').count();
    if (added > 0) {
      await window.getByTestId('lf-remove').first().click();
      await expect(window.getByTestId('lf-result')).toHaveCount(added - 1);
      if (added > 1) {
        await window.getByTestId('lf-undo-all').click();
        await expect(window.getByTestId('lf-result')).toHaveCount(0);
      }
    } else {
      await expect(window.getByTestId('lf-none').or(window.getByTestId('lf-below'))).toBeVisible();
    }
    await window.getByTestId('linkfinder').getByRole('button', { name: /close/i }).click();
    await expect(window.getByTestId('linkfinder')).toHaveCount(0);

    // Three documents: the bridge is off.
    await clickRow(window, papers[2]!.title!, ['Control']);
    await window.getByTestId('selection-more').click();
    await window.getByTestId('selection-links').click();
    await expect(window.getByTestId('lf-bridge')).toBeDisabled();
    await window.keyboard.press('Escape');
  } finally {
    await ctx?.close();
  }
});

test('a link added by hand shows on the document card, can be removed there, and a removed pair is remembered', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true });
    const { window } = ctx;
    const papers = ctx.library!.manifest!.files.filter((f) => f.format === 'pdf' && f.title);
    test.skip(papers.length < 2, 'needs two titled PDFs');
    await createLibraryViaWizard(window, { name: 'Links library' });
    await skipUnlessChannels(window, testInfo, CHANNELS);
    await waitForScan(window, ctx.library!.manifest!.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const list = asArray(await ipcData(window, 'documents:list', { limit: 50 }));
    const byTitle = (title: string) => idOf(list.find((d) => JSON.stringify(d).includes(JSON.stringify(title).slice(1, -1))))!;
    const a = byTitle(papers[0]!.title!);
    const b = byTitle(papers[1]!.title!);
    const made = await ipcData<{ id: string; created: boolean }>(window, 'doclinks:add', { a, b, weight: 0.6, reasons: { terms: ['x'] } });
    expect(made.created).toBe(true);
    expect((await ipcData<{ items: unknown[] }>(window, 'doclinks:list', { docId: b })).items).toHaveLength(1);

    await window.getByTestId('nav-library').click();
    await pickSort(window, 'title');
    await clickRow(window, papers[0]!.title!);
    if (!(await window.getByTestId('detail-pane').isVisible())) await window.getByTestId('detail-toggle').click();
    await expect(window.getByTestId('doc-link')).toHaveCount(1, { timeout: 30_000 });
    await expect(window.getByTestId('doc-link')).toHaveAttribute('data-doc-id', b);
    await window.getByTestId('doc-link-remove').click();
    await expect(window.getByTestId('doc-link')).toHaveCount(0);
    expect((await ipcData<{ items: unknown[] }>(window, 'doclinks:list', { docId: b })).items).toHaveLength(0);

    // A search over the pair does not bring the removed link back.
    const found = await ipcData<{ added: Array<{ docId: string }>; skipped: { dismissed: number } }>(window, 'doclinks:find', { sourceId: a, targets: { docIds: [b] }, strictness: 'wide' });
    expect(found.added.some((x) => x.docId === b)).toBe(false);
    expect(found.skipped.dismissed).toBe(1);
  } finally {
    await ctx?.close();
  }
});
