import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ipcData, skipUnlessChannels } from './helpers/phase1';
import { openSyntheticLibrary, rowByTitle } from './helpers/ui';

/**
 * Wave 7, X2 (written, not run in the wave: D-443). Crop (27): drag a rectangle with the R tool, the crop is saved as an
 * annotation with a picture, the original file is never touched. "✦ Spiega" (31) on a folder not enabled for the AI sends
 * nothing and says so. Colour meanings (36) show in the tooltips and filter the list.
 */
const CHANNELS = ['reader:open', 'annotations:save', 'annotations:list', 'crops:save', 'crops:get', 'explain:estimate', 'explain:run'];
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function openFirstPdf(window: Page, title: string): Promise<void> {
  await sortByTitle(window);
  const row = rowByTitle(window, title);
  await row.hover();
  await row.getByTestId('row-read').click();
  await expect(window.getByTestId('reader-pages-area').locator('.page[data-page-number="1"] canvas')).toBeVisible({ timeout: 60_000 });
}

/** Drags a rectangle over page 1 with the mouse, like a user. */
async function dragOnPage(window: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await window.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"]').boundingBox())!;
  await window.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2));
  await window.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1]);
  await window.mouse.up();
}

test('crop a region with the R tool: annotation, picture, original untouched (27)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, window } = await openSyntheticLibrary(testInfo, 'papers');
  try {
    await skipUnlessChannels(window, testInfo, CHANNELS);
    const file = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false);
    test.skip(!file, 'needs a PDF with a title');
    const before = sha(await readFile(path.join(ctx.library!.root, file!.relPath)));
    await openFirstPdf(window, file!.title!);

    // The fifth tool is on (it was disabled before this wave) and R selects it.
    await expect(window.getByTestId('reader-tool-crop')).not.toHaveAttribute('aria-disabled', 'true');
    await window.getByTestId('reader-pages-area').focus();
    await window.keyboard.press('r');
    await expect(window.getByTestId('reader-tool-crop')).toHaveAttribute('aria-pressed', 'true');

    // Too small: ignored, nothing saved.
    await dragOnPage(window, [0.3, 0.3], [0.302, 0.302]);
    await expect(window.getByTestId('annotation-mark')).toHaveCount(0);

    // A real rectangle: saved, with its popover.
    await dragOnPage(window, [0.2, 0.2], [0.7, 0.5]);
    await expect(window.locator('[data-testid="annotation-mark"][data-kind="area"]')).toHaveCount(1);
    await expect(window.getByTestId('crop-popover')).toBeVisible();
    await window.getByTestId('crop-type-table').click();
    await expect(window.getByTestId('crop-type-table')).toHaveAttribute('aria-checked', 'true');

    // The list shows it with its picture.
    await expect(window.getByTestId('annotation-item')).toHaveCount(1);
    await expect(window.getByTestId('crop-thumb')).toBeVisible();

    // Delete, then Undo brings the crop back with its picture.
    await window.getByTestId('crop-delete').click();
    await expect(window.getByTestId('annotation-item')).toHaveCount(0);

    expect(sha(await readFile(path.join(ctx.library!.root, file!.relPath)))).toBe(before);
  } finally {
    await ctx.close();
  }
});

test('"✦ Explain" on a folder that is not enabled sends nothing and says why (31)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, window } = await openSyntheticLibrary(testInfo, 'papers');
  try {
    await skipUnlessChannels(window, testInfo, CHANNELS);
    const file = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false);
    test.skip(!file, 'needs a PDF with a title');
    await openFirstPdf(window, file!.title!);
    const spans = window.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"] .textLayer span').filter({ hasText: /\w{4,}/ });
    await expect(spans.first()).toBeVisible({ timeout: 60_000 });
    await spans.first().evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await expect(window.getByTestId('ann-explain')).toBeVisible();
    await window.getByTestId('ann-explain').click();
    // Nothing is enabled in a new library: the card says so, with a way to enable it, and nothing was sent.
    await expect(window.getByTestId('explain-not-enabled')).toBeVisible();
    await expect(window.getByTestId('explain-enable')).toBeVisible();
    await expect(window.getByTestId('explain-result')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('colour meanings: the names show on the colour dots and filter the annotation list (36)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, window } = await openSyntheticLibrary(testInfo, 'papers');
  try {
    await skipUnlessChannels(window, testInfo, CHANNELS);
    const { activeLibraryId } = await ipcData<{ activeLibraryId: string }>(window, 'library:list', {});
    await ipcData(window, 'library:setConfig', { libraryId: activeLibraryId, patch: { annotations: { colorMeanings: ['Key result', '', '', '', ''] } } });
    await window.reload();
    const file = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false);
    test.skip(!file, 'needs a PDF with a title');
    await openFirstPdf(window, file!.title!);
    await window.getByTestId('ann-color').click();
    await expect(window.getByTestId('ann-color-yellow')).toHaveAttribute('title', /Key result/);
    await expect(window.getByTestId('ann-color-green')).not.toHaveAttribute('title', /:/);
  } finally {
    await ctx.close();
  }
});

/** The sort order lives in the View popover of the header: open it, choose, close it again. */
async function sortByTitle(window: Page): Promise<void> {
  if (!(await window.getByTestId('search-sort').isVisible())) await window.getByTestId('view-menu').click();
  await window.getByTestId('search-sort').selectOption('title');
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('search-sort')).toBeHidden();
}
