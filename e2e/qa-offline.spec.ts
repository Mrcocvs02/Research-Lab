import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { PHASE1_CHANNELS, createLibraryViaWizard, getDocument, idOf, pageOf, searchHits, searchViaUi, skipUnlessChannels, titleOf, waitForScan } from './helpers/phase1';

/**
 * Phase 1 criterion, offline proof (PLAN sections 4 and 7): with the network cut, a new library is scanned and
 * searched; no request leaves the app and no original file changes.
 */
test('scan and search work offline, with no network attempt and no file changed outside .lab', async ({}, testInfo) => {
  test.setTimeout(240_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: 40, options: { pdfShare: 0.2, sentinelPage: 3 } }, dialogPath: true, offline: true });
    const { window } = ctx;
    const corpus = ctx.library!.corpus!;
    await skipUnlessChannels(window, testInfo, PHASE1_CHANNELS);

    await createLibraryViaWizard(window, { name: 'Offline library' });
    const scanMs = await waitForScan(window, corpus.count);
    testInfo.annotations.push({ type: 'scan-ms', description: String(scanMs) });
    await expect(window.getByTestId('scan-status')).toBeVisible();

    // Title sentinel (a Markdown document): found, and it is the right document.
    const title = corpus.sentinel('title');
    const titleRows = await searchViaUi(window, title.folded);
    expect(titleRows[0]!.toLowerCase()).toContain(title.folded);
    const titleHits = await searchHits(window, title.folded);
    expect(titleHits.length).toBeGreaterThan(0);
    const first = await getDocument(window, idOf(titleHits[0])!);
    expect(titleOf(first)).toBe(title.title);

    // Body sentinel (page N of a PDF): right document, right page.
    const body = corpus.sentinel('body', 'pdf');
    const bodyRows = await searchViaUi(window, body.folded);
    expect(bodyRows.length).toBeGreaterThan(0);
    const bodyHits = await searchHits(window, body.folded);
    expect(bodyHits.length).toBeGreaterThan(0);
    const doc = await getDocument(window, idOf(bodyHits[0])!);
    expect(titleOf(doc)).toBe(body.title);
    expect(pageOf(bodyHits[0])).toBe(body.page);
    expect(bodyRows[0]!.toLowerCase()).toContain(body.title.slice(0, 20).toLowerCase());

    // Nothing tried to reach the network, nothing outside .lab changed.
    expect(await ctx.blockedRequests()).toEqual([]);
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});
