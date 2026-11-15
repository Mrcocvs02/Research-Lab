import { expect, test } from '@playwright/test';
import { appendFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { PHASE1_CHANNELS, createLibraryViaWizard, getDocument, idOf, searchHits, skipUnlessChannels, titleOf, waitForScan } from './helpers/phase1';

/**
 * Watcher: with the app open, a file added to the library root shows up in search; renamed, it is still the
 * same document (same id). The library is a throw-away temporary folder, so adding files to its root is fine:
 * the originals present at launch must still be unchanged at the end.
 */
test('a new file appears in search, and a rename keeps the document id', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: 20, options: { pdfShare: 0.1 } }, dialogPath: true });
    const { window } = ctx;
    const root = ctx.library!.root;
    const corpus = ctx.library!.corpus!;
    await skipUnlessChannels(window, testInfo, PHASE1_CHANNELS);
    await createLibraryViaWizard(window, { name: 'Watched library' });
    await waitForScan(window, corpus.count);

    // Add a Markdown file at the root of the library (outside .lab).
    const word = 'watchersentinelqx';
    const before = (await readdir(root)).length;
    const file = path.join(root, 'added-while-open.md');
    await writeFile(file, `# Added while the app is open\n\nA note about ${word} written after the first scan.\n`);
    expect((await readdir(root)).length).toBeGreaterThan(before);

    await expect
      .poll(async () => (await searchHits(window, word)).length, { message: 'new file not searchable', timeout: 90_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0);
    const hit = (await searchHits(window, word))[0];
    const id = idOf(hit);
    expect(id).toBeTruthy();
    const doc0 = await getDocument(window, id!);
    expect(titleOf(doc0)).toBeTruthy();

    // Rename it (content unchanged): same id, new path.
    const renamed = path.join(root, 'renamed-while-open.md');
    await rename(file, renamed);
    await expect
      .poll(async () => JSON.stringify(await getDocument(window, id!)).includes('renamed-while-open'), { message: 'rename not picked up', timeout: 90_000, intervals: [500, 1000, 2000] })
      .toBe(true);
    const hitsAfter = await searchHits(window, word);
    expect(hitsAfter.map(idOf)).toContain(id);
    expect(new Set(hitsAfter.map(idOf)).size, 'a rename must not create a second document').toBe(hitsAfter.length);

    // A content change keeps the id too.
    await appendFile(renamed, `\nAnd a later line about ${word}x.\n`);
    await expect.poll(async () => (await searchHits(window, `${word}x`)).length, { timeout: 90_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0);
    expect(idOf((await searchHits(window, `${word}x`))[0])).toBe(id);

    // The files that were there at launch are still as they were (the two additions are ours).
    const diff = await ctx.library!.diff();
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.added).toEqual(['renamed-while-open.md']);
    await mkdir(path.join(root, '.lab'), { recursive: true });
  } finally {
    await ctx?.close();
  }
});
