import { expect, test } from '@playwright/test';
import type { LaunchedApp } from './helpers/launch';
import { ipc } from './helpers/phase1';
import { backToList, clickRow, createTagInManager, openSyntheticLibrary, pickTag, rowByTitle, rows } from './helpers/ui';

/**
 * Phase 2 criterion, library half: what TagSpaces did, done in the app. Checklist points 1-8 on the synthetic
 * `papers` library. The documents are never opened with the system application here (it would start a program on
 * the machine running the test): the buttons are only checked to be available.
 */

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

test('folders with counts, list and grid, sorting, text search (points 1 and 2)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    const { window, total } = opened;
    const files = ctx.library!.manifest!.files;

    // Folder tree: "All documents" carries the total; a folder carries the number of documents below it.
    const tree = window.getByTestId('folder-tree');
    await expect(tree).toBeVisible();
    await expect(tree.locator('[data-key=""]').getByTestId('folder-count')).toHaveText(String(total));
    const folders = [...new Set(files.map((f) => f.relPath.split('/')[0]!).filter((_, i) => files[i]!.relPath.includes('/')))];
    if (folders.length > 0) {
      const folder = folders[0]!;
      const below = files.filter((f) => f.relPath.startsWith(`${folder}/`)).length;
      await expect(tree.locator(`[data-key="${folder}"]`).getByTestId('folder-count')).toHaveText(String(below));
      await tree.locator(`[data-key="${folder}"]`).click();
      await expect(window.getByTestId('search-summary')).toContainText(String(below));
      // "include sub-folders" off: only the documents lying directly in the folder
      const direct = files.filter((f) => dirOf(f.relPath) === folder).length;
      await window.getByTestId('include-subfolders').uncheck();
      await expect(window.getByTestId('search-summary')).toContainText(String(direct));
      await window.getByTestId('include-subfolders').check();
      await expect(window.getByTestId('search-summary')).toContainText(String(below));
      await window.getByTestId('search-clear-filters').click();
    }
    await expect(window.getByTestId('search-summary')).toContainText(String(total));

    // List and grid.
    await expect(rows(window).first()).toHaveAttribute('data-view', 'list');
    await window.getByTestId('view-grid').click();
    await expect(rows(window).first()).toHaveAttribute('data-view', 'grid');
    await expect(rows(window).first().locator('.type-icon')).toBeVisible();
    await window.getByTestId('view-list').click();

    // Sorting by title and by year.
    const titles = files.map((f) => f.title).filter((t): t is string => Boolean(t));
    const firstByTitle = [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))[0]!;
    await window.getByTestId('search-sort').selectOption('title');
    await expect(rows(window).first().getByTestId('result-title')).toHaveText(firstByTitle);
    await window.getByTestId('search-sort').selectOption('year-desc');
    await expect(window.getByTestId('search-summary')).toContainText(String(total));
    await window.getByTestId('search-sort').selectOption('added-desc');
    await window.getByTestId('search-sort').selectOption('author');
    await expect(rows(window).first()).toBeVisible();
    // By size: the order and the readable size of the first row are the index's.
    const bySize = (await ipc(window, 'documents:list', { sort: 'size-desc', limit: 3 })).data as { items: Array<{ size: number }> };
    await window.getByTestId('search-sort').selectOption('size-desc');
    await expect(rows(window).first().getByTestId('doc-size')).toHaveAttribute('title', `${bySize.items[0]!.size} bytes`);
    await expect(rows(window).first().getByTestId('doc-size')).toHaveText(/^\d+(\.\d)? (B|KB|MB|GB)$/);
    await window.getByTestId('search-sort').selectOption('size-asc');
    const asc = (await ipc(window, 'documents:list', { sort: 'size-asc', limit: 1 })).data as { items: Array<{ size: number }> };
    await expect(rows(window).first().getByTestId('doc-size')).toHaveAttribute('title', `${asc.items[0]!.size} bytes`);

    // Text search still works from the same view.
    const word = firstByTitle.split(/\s+/).sort((a, b) => b.length - a.length)[0]!.replace(/[^\p{L}\p{N}]/gu, '');
    await window.getByTestId('search-input').fill(word);
    await expect(window.getByTestId('results-pane')).toHaveAttribute('data-query', word);
    await expect(rowByTitle(window, firstByTitle)).toBeVisible();

    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});

test('tags on one and many documents, filters, undo and history (points 3, 4 and 8)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    const { window, total } = opened;
    const titles = ctx.library!.manifest!.files.map((f) => f.title).filter((t): t is string => Boolean(t));
    test.skip(titles.length < 4, 'needs at least four titled documents');
    const [a, b, c] = [...titles].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));

    // A tag created on the fly while tagging one document; a second one with an alias from the manager.
    await window.getByTestId('search-sort').selectOption('title');
    await clickRow(window, a!);
    await window.getByTestId('selection-details').click();
    const panel = window.getByTestId('doc-panel');
    await expect(panel).toBeVisible();
    await pickTag(window, panel.getByTestId('tag-input'), 'Alpha topic', true);
    await expect(panel.getByTestId('doc-tag-list').getByTestId('tag-chip')).toContainText('Alpha topic');
    await expect(rowByTitle(window, a!).getByTestId('tag-chip')).toContainText('Alpha topic');

    await createTagInManager(window, 'Beta topic');
    await window.getByTestId('node-aliases').fill('bt\nsecond topic');
    await window.getByTestId('node-aliases').blur();
    await window.getByTestId('color-swatch').nth(5).click();
    await backToList(window);

    // Many documents at once, with the alias recognised by the completion, using Ctrl and Shift.
    await clickRow(window, a!);
    await clickRow(window, c!, ['Shift']);
    await expect(window.getByTestId('selection-count')).toHaveText(/3 selected/);
    await window.getByTestId('selection-details').click();
    const bulk = window.getByTestId('bulk-panel');
    await expect(bulk).toBeVisible();
    await bulk.getByTestId('bulk-tag-input').fill('second');
    await expect(window.getByTestId('tag-option').first()).toContainText('Beta topic');
    await expect(window.getByTestId('tag-option').first()).toContainText('alias');
    await bulk.getByTestId('bulk-tag-input').press('Enter');
    await expect(rowByTitle(window, b!).getByTestId('tag-chip')).toContainText('Beta topic');
    // the colour of the node is on the chip
    await expect(rowByTitle(window, b!).getByTestId('tag-chip')).toHaveCSS('--tag', /#/);

    // Filters: one tag, two tags (all / at least one), exclusion, combined with text.
    await window.getByTestId('selection-clear').click();
    const include = window.getByTestId('filter-include-input');
    await pickTag(window, include, 'Beta');
    await expect(window.getByTestId('search-summary')).toContainText('3 documents');
    await pickTag(window, include, 'Alpha');
    await expect(window.getByTestId('search-summary')).toContainText('1 document'); // all of them
    await window.getByTestId('tag-mode-any').check();
    await expect(window.getByTestId('search-summary')).toContainText('3 documents');
    await pickTag(window, window.getByTestId('filter-exclude-input'), 'Alpha');
    await expect(window.getByTestId('search-summary')).toContainText('2 documents'); // Beta only
    await window.getByTestId('search-input').fill(b!.split(/\s+/)[0]!);
    await expect(rowByTitle(window, b!)).toBeVisible();
    await window.getByTestId('search-clear-filters').click();
    await expect(window.getByTestId('search-summary')).toContainText(String(total));

    // Undo and redo with the keyboard and the buttons; the history lists the changes.
    await window.getByTestId('history-toggle').click();
    await expect(window.getByTestId('history-item').first()).toBeVisible();
    await window.getByTestId('history-toggle').click();
    await rows(window).first().click();
    await window.keyboard.press('Control+z');
    await expect(rowByTitle(window, b!).getByTestId('tag-chip')).toHaveCount(0);
    await window.keyboard.press('Control+y');
    await expect(rowByTitle(window, b!).getByTestId('tag-chip')).toContainText('Beta topic');
    await window.getByTestId('undo-button').click();
    await expect(rowByTitle(window, b!).getByTestId('tag-chip')).toHaveCount(0);
    await window.keyboard.press('Control+Shift+z');
    await expect(rowByTitle(window, b!).getByTestId('tag-chip')).toContainText('Beta topic');

    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});

test('keyboard: arrows, Shift, Ctrl+A, Enter opens the card, Delete deletes nothing (point 4)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    const { window, total } = opened;
    await window.getByTestId('search-sort').selectOption('title');
    const list = window.getByTestId('search-results');
    await rows(window).first().click();
    await list.press('ArrowDown');
    await list.press('Shift+ArrowDown');
    await expect(window.getByTestId('selection-count')).toHaveText(/2 selected/);
    await list.press('Control+a');
    await expect(window.getByTestId('selection-count')).toHaveText(new RegExp(`${total} selected`));
    await list.press('Delete');
    await list.press('Backspace');
    await expect(window.getByTestId('search-summary')).toContainText(String(total));
    await window.getByTestId('selection-clear').click();
    await rows(window).first().click();
    await list.press('Enter');
    await expect(window.getByTestId('doc-panel')).toBeVisible();
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});

test('document card: editable fields, study state, extracted values apart, AI area apart (points 6 and 7)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    const { window } = opened;
    await window.getByTestId('search-sort').selectOption('title');
    await rows(window).first().click();
    await window.getByTestId('selection-details').click();
    const panel = window.getByTestId('doc-panel');
    await expect(panel).toBeVisible();

    // Opening and showing the file are offered (not clicked: they start programs on this machine).
    await expect(panel.getByTestId('open-file')).toBeEnabled();
    await expect(panel.getByTestId('reveal-file')).toBeEnabled();

    // Values the scan took from the file are marked; once the user edits one, the mark goes away.
    const marks = panel.getByTestId('extracted-mark');
    const before = await marks.count();
    const title = panel.getByTestId('field-title');
    await title.fill('A title chosen by the user');
    await title.blur();
    await expect(rows(window).filter({ hasText: 'A title chosen by the user' })).toHaveCount(1);
    expect(await marks.count()).toBeLessThanOrEqual(before);

    await panel.getByTestId('field-authors').fill('First Author\nSecond Author');
    await panel.getByTestId('field-authors').blur();
    await panel.getByTestId('field-year').fill('1999');
    await panel.getByTestId('field-year').blur();
    await panel.getByTestId('field-venue').fill('Journal of Tests');
    await panel.getByTestId('field-venue').blur();
    await panel.getByTestId('field-doi').fill('10.1234/example');
    await panel.getByTestId('field-doi').blur();
    await panel.getByTestId('field-arxiv').fill('2101.00001');
    await panel.getByTestId('field-arxiv').blur();
    await panel.getByTestId('field-description').fill('My own short description.');
    await panel.getByTestId('field-description').blur();
    await panel.getByTestId('study-reading').click();
    await expect(panel.getByTestId('study-reading')).toBeChecked();
    await panel.getByTestId('field-underlined').click();
    await expect(panel.getByTestId('field-underlined')).toBeChecked();
    await expect(rows(window).first().getByTestId('study-badge')).toHaveAttribute('data-state', 'reading');

    // The AI area is its own, labelled block and has no inputs.
    const ai = panel.getByTestId('ai-area');
    await expect(ai).toBeVisible();
    await expect(ai).toContainText(/AI-generated/);
    await expect(ai.locator('input, textarea, select')).toHaveCount(0);

    // Reload the card from the main process: the values were stored.
    await window.getByTestId('selection-clear').click();
    await rows(window).filter({ hasText: 'A title chosen by the user' }).click();
    await window.getByTestId('selection-details').click();
    await expect(window.getByTestId('field-year')).toHaveValue('1999');
    await expect(window.getByTestId('field-doi')).toHaveValue('10.1234/example');
    await expect(window.getByTestId('field-authors')).toHaveValue('First Author\nSecond Author');
    await expect(window.getByTestId('study-reading')).toBeChecked();
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});

test('taxonomy: free levels, rename, move, aliases, implications, colour, merge, deprecate, delete (point 5)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    const { window } = opened;
    const tree = window.getByTestId('tax-tree');
    const item = (id: string) => tree.locator(`[data-key="${id}"]`);

    await createTagInManager(window, 'Macro');
    await createTagInManager(window, 'Micro', { parent: 'macro' });
    await expect(window.getByTestId('node-parents')).toContainText('Macro');
    // third level
    await window.getByTestId('add-child').click();
    await window.getByTestId('new-node-label').fill('Sub topic');
    await window.getByTestId('new-node-create').click();
    await expect(window.getByTestId('node-title')).toHaveText('Sub topic');
    await expect(window.getByTestId('node-editor').locator('.hint').first()).toContainText('Macro › Micro');

    // rename and move (parents editor), a second parent, back to the top level
    await window.getByTestId('node-label').fill('Sub-topic renamed');
    await window.getByTestId('node-label').blur();
    await expect(window.getByTestId('node-title')).toHaveText('Sub-topic renamed');
    await window.getByTestId('parent-input').fill('Macro');
    await window.getByTestId('parent-input').press('Enter');
    await expect(window.getByTestId('node-parents')).toContainText('Macro');
    await window.getByTestId('make-top-level').click();
    await expect(window.getByTestId('node-parents')).toContainText('Top level');

    // move by dragging onto another node (the parent is opened first so both rows are visible)
    await item('macro').click();
    await item('macro').press('ArrowRight');
    await item('sub-topic').dragTo(item('micro'));
    await expect(item('sub-topic')).toBeVisible();
    await item('sub-topic').click();
    await expect(window.getByTestId('node-parents').getByTestId('tag-chip')).toContainText('Micro');

    // implications and colour
    await window.getByTestId('implies-input').fill('Macro');
    await window.getByTestId('implies-input').press('Enter');
    await expect(window.getByTestId('node-implies')).toContainText('Macro');
    await window.getByTestId('color-swatch').nth(2).click();
    await expect(window.getByTestId('color-swatch').nth(2)).toHaveAttribute('aria-pressed', 'true');

    // use a tag on a document, then it cannot be deleted; deprecate and restore; merge it into another
    await window.getByTestId('new-top-level').click();
    await window.getByTestId('new-node-label').fill('Extra');
    await window.getByTestId('new-node-create').click();
    await backToList(window);
    await rows(window).first().click();
    await window.getByTestId('selection-details').click();
    await pickTag(window, window.getByTestId('tag-input'), 'Extra');
    await expect(window.getByTestId('doc-tag-list')).toContainText('Extra');
    await window.getByTestId('open-taxonomy').click();
    await item('extra').click();
    await expect(window.getByTestId('node-counts')).toContainText(/1 direct/);
    await expect(window.getByTestId('delete-node')).toBeDisabled();
    await window.getByTestId('deprecate-node').click();
    await expect(window.getByTestId('restore-node')).toBeVisible();
    await window.getByTestId('restore-node').click();
    await window.getByTestId('merge-input').fill('Micro');
    await window.getByTestId('merge-input').press('Enter');
    await window.getByTestId('merge-confirm').click();
    await expect(item('extra')).toHaveCount(0);
    // an unused tag is deleted after a confirmation
    await window.getByTestId('new-top-level').click();
    await window.getByTestId('new-node-label').fill('Throwaway');
    await window.getByTestId('new-node-create').click();
    await window.getByTestId('delete-node').click();
    await window.getByTestId('delete-confirm').click();
    await expect(item('throwaway')).toHaveCount(0);

    // everything above is one undo away
    await window.getByTestId('undo-button').click();
    await expect(item('throwaway')).toHaveCount(1);
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});
