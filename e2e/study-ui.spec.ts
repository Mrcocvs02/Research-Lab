import { _electron as electron, expect, test, type Page } from '@playwright/test';
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

    // Open it in the reader from the list.
    await window.getByTestId('search-sort').selectOption('title');
    await openInReader(window, title);
    await expect(window.getByTestId('reader')).toBeVisible();
    await expect(window.getByTestId('reader-error')).toHaveCount(0);
    await expect(window.getByTestId('reader-pages')).toContainText(/\d/, { timeout: 60_000 });

    // Select text and highlight it in green with a comment.
    await selectFirstText(window);
    await expect(window.getByTestId('annotation-bar')).toBeVisible({ timeout: 10_000 });
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

    // And the hit opens the reader on the list of the notes, one click away from the page note.
    await label.click();
    await expect(window.getByTestId('reader')).toBeVisible();
    await window.getByTestId('notes-list-item').first().click();
    await expect(window.getByTestId('note-page-input')).toHaveValue(`${NOTE_WORD} on the first page`);
  } finally {
    await second?.close().catch(() => {});
    await ctx?.close();
  }
});
