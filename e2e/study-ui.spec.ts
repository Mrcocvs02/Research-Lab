import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DESKTOP_DIR, type LaunchedApp } from './helpers/launch';
import { skipUnlessChannels } from './helpers/phase1';
import { openSyntheticLibrary, rowByTitle } from './helpers/ui';

/**
 * Phase 3 criterion: "si evidenzia, si chiude, si riapre e si ritrova". A PDF is opened in the in-app reader, a text is
 * selected and highlighted, a note is written for the page; the app is closed and started again on the same data; the
 * highlight and the page note are still there and the note is found by the search.
 */
const READER_CHANNELS = ['reader:open', 'notes:save', 'notes:get', 'notes:list', 'annotations:save', 'annotations:list'];
const NOTE_WORD = 'quasarmarker';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Opens a document in the reader from its row: the row buttons show on hover, as for a user. */
async function openInReader(window: Page, title: string): Promise<void> {
  const row = rowByTitle(window, title);
  await row.hover();
  await row.getByTestId('row-read').click();
}

/** Selects the text of the first line of the first page, as a user dragging over it would. */
async function selectFirstText(window: Page): Promise<void> {
  const span = window.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"] .textLayer span').filter({ hasText: /\w{4,}/ }).first();
  await expect(span).toBeVisible({ timeout: 60_000 });
  await span.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test('highlight a PDF in the reader, write a page note, restart, find both again (phase 3)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  let second: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    let window = opened.window;
    await skipUnlessChannels(window, testInfo, READER_CHANNELS);
    const file = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false);
    test.skip(!file, 'needs a PDF with text and a title');
    const title = file!.title!;
    // The original is never written: its SHA-256 is taken now and compared at the end (acceptance criterion of phase 3).
    const pdfPath = path.join(ctx.library!.root, file!.relPath);
    const shaBefore = sha(await readFile(pdfPath));
    expect(shaBefore).toBe(file!.sha256);

    // Open it in the reader from the list.
    await window.getByTestId('search-sort').selectOption('title');
    await openInReader(window, title);
    await expect(window.getByTestId('reader')).toBeVisible();
    await expect(window.getByTestId('reader-error')).toHaveCount(0);
    await expect(window.getByTestId('reader-pages')).toContainText(/\d/, { timeout: 60_000 });
    // The files pdf.js fetches for some PDFs (D-193) are served next to the page, under the same CSP.
    const resources = await window.evaluate(async () => {
      const urls = ['pdfjs/standard_fonts/FoxitSerif.pfb', 'pdfjs/cmaps/UniJIS-UTF16-H.bcmap', 'pdfjs/wasm/openjpeg_nowasm_fallback.js'];
      return Promise.all(urls.map(async (u) => (await fetch(new URL(u, document.baseURI))).status));
    });
    expect(resources).toEqual([200, 200, 200]);

    // Select text and highlight it in green with a comment.
    await selectFirstText(window);
    await expect(window.getByTestId('annotation-bar')).toBeVisible({ timeout: 10_000 });
    // A word of the highlighted text that is not in the title: a search for it can only be answered by the highlight.
    const highlighted = (await window.getByTestId('ann-text').textContent()) ?? '';
    const word = highlighted.split(/[^A-Za-z]+/).find((w) => w.length >= 6 && !title.toLowerCase().includes(w.toLowerCase()) && !NOTE_WORD.includes(w.toLowerCase()));
    test.skip(!word, 'the first line of text has no word that is outside the title');
    await window.getByTestId('ann-color-green').check({ force: true });
    await window.getByTestId('ann-comment').fill('worth a second look');
    await window.getByTestId('ann-highlight').click();
    await expect(window.getByTestId('annotation-item')).toHaveCount(1);
    await expect(window.getByTestId('annotation-mark').first()).toBeVisible();
    await expect(window.getByTestId('reader-underlined')).toBeChecked();

    // A note on the current page, and the study state.
    await window.getByTestId('reader-tab-pageNote').click();
    await window.getByTestId('note-page-input').fill(`${NOTE_WORD} on the first page`);
    await window.getByTestId('note-page-save').click();
    await expect(window.getByTestId('note-page-state')).toHaveText('Saved');
    await window.getByTestId('reader-study-reading').check({ force: true });
    await expect(window.getByTestId('reader-study-reading')).toBeChecked();

    // Close the app, start it again on the same data.
    await ctx.app.close();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, { RL_USER_DATA_DIR: ctx.userDataDir, RL_LOCAL_DATA_DIR: ctx.localDataDir, NODE_ENV: 'production', RL_E2E_HIDDEN: '1' });
    second = await electron.launch({ args: [DESKTOP_DIR], env });
    window = await second.firstWindow();
    await window.getByTestId('search-result').first().waitFor({ state: 'visible', timeout: 60_000 });

    // The highlight and the note are still there.
    await openInReader(window, title);
    await expect(window.getByTestId('annotation-item')).toHaveCount(1, { timeout: 60_000 });
    await expect(window.getByTestId('annotation-mark').first()).toBeVisible({ timeout: 60_000 });
    await expect(window.getByTestId('reader-study-reading')).toBeChecked();
    await window.getByTestId('reader-tab-pageNote').click();
    await expect(window.getByTestId('note-page-input')).toHaveValue(`${NOTE_WORD} on the first page`);
    await window.getByTestId('reader-tab-notes').click();
    await expect(window.getByTestId('notes-list-item')).toHaveCount(1);

    // Back to the library with the list intact; the search finds the note and says where.
    await window.getByTestId('reader-close').click();
    await expect(window.getByTestId('reader')).toHaveCount(0);
    await window.getByTestId('search-input').fill(NOTE_WORD);
    const label = window.getByTestId('hit-field').first();
    await expect(label).toBeVisible({ timeout: 60_000 });
    await expect(label).toHaveAttribute('data-field', 'note');
    await expect(label).toHaveText('in your notes');

    // A word that is only in the highlighted text finds the document, labelled as a highlight.
    await window.getByTestId('search-input').fill(word!);
    const found = rowByTitle(window, title).getByTestId('hit-field');
    await expect(found).toBeVisible({ timeout: 60_000 });
    await expect(found).toHaveAttribute('data-field', 'annotation');
    await window.getByTestId('search-input').fill(NOTE_WORD);
    await expect(window.getByTestId('hit-field').first()).toHaveAttribute('data-field', 'note', { timeout: 60_000 });

    // And the hit opens the reader on the list of the notes, one click away from the page note.
    await label.click();
    await expect(window.getByTestId('reader')).toBeVisible();
    await window.getByTestId('notes-list-item').first().click();
    await expect(window.getByTestId('note-page-input')).toHaveValue(`${NOTE_WORD} on the first page`);

    // The PDF on disk is byte-identical after the whole flow (highlight, note, restart, search).
    expect(sha(await readFile(pdfPath))).toBe(shaBefore);
    await ctx.verifyLibraryUntouched();
  } finally {
    await second?.close().catch(() => {});
    await ctx?.close();
  }
});
