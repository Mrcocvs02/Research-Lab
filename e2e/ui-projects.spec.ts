import { expect, test } from '@playwright/test';
import type { LaunchedApp } from './helpers/launch';
import { clickRow, openSyntheticLibrary, rows } from './helpers/ui';

/**
 * Phase 2 criterion, projects half (checklist point 9): a project gathers documents from different folders and
 * shows their study state; notes in Markdown with a safe preview; an ordered reading plan; archive and restore.
 */
test('project from the library selection, members, notes, reading plan, archive (point 9)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const opened = await openSyntheticLibrary(testInfo, 'full');
    ctx = opened.ctx;
    const { window } = opened;
    const files = ctx.library!.manifest!.files;
    // two documents that sit in different folders (or at least two different documents)
    const titled = files.filter((f) => f.title);
    const first = titled[0]!;
    const other = titled.find((f) => f.relPath.split('/').slice(0, -1).join('/') !== first.relPath.split('/').slice(0, -1).join('/')) ?? titled[1]!;
    test.skip(!other, 'needs two titled documents');
    const third = titled.find((f) => f !== first && f !== other)!;

    // Select two documents in the library and create a project from them.
    await window.getByTestId('search-sort').selectOption('title');
    await clickRow(window, first.title!);
    await clickRow(window, other.title!, ['Control']);
    await expect(window.getByTestId('selection-count')).toHaveText(/2 selected/);
    await window.getByTestId('add-to-project-button').click();
    await window.getByTestId('new-project-name').fill('Literature review');
    await window.getByTestId('create-project-with-selection').click();
    await expect(window.getByTestId('toasts')).toContainText('Literature review');

    // A second project exists; the first document is added to it from the library too.
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-new').click();
    await window.getByTestId('project-create-name').fill('Side project');
    await window.getByTestId('project-kind-collection').click();
    await expect(window.getByTestId('project-kind-hint')).toContainText('just a set of documents');
    await window.getByTestId('project-create').click();
    await expect(window.getByTestId('project-detail')).toBeVisible();
    await expect(window.getByTestId('members-empty')).toBeVisible();
    // The empty project has one way forward, and the crumb "Projects" goes back to the list.
    await expect(window.getByTestId('members-empty-add')).toBeVisible();
    await expect(window.getByTestId('crumbs')).toContainText('Side project');
    await window.getByTestId('crumbs').getByRole('button', { name: 'Projects' }).click();
    await expect(window.getByTestId('project-row')).toHaveCount(2);
    await window.getByTestId('nav-library').click();
    await clickRow(window, third.title!);
    await window.getByTestId('add-to-project-button').click();
    await window.getByTestId('pick-project').filter({ hasText: 'Side project' }).click();

    // The list shows state and a reading summary.
    await window.getByTestId('nav-projects').click();
    const row = window.getByTestId('project-row').filter({ hasText: 'Literature review' });
    await expect(row.getByTestId('project-summary')).toContainText('2 documents: 2 to read, 0 reading, 0 read');

    // Detail: members from different folders and their study state, which can be changed here.
    await row.getByTestId('project-open').click();
    await expect(window.getByTestId('member-row')).toHaveCount(2);
    // "Add documents…" shows the library search; the documents already in the project cannot be picked twice.
    await window.getByTestId('project-add-docs').click();
    await window.getByTestId('adddocs-search').fill(first.title!);
    await expect(window.getByTestId('adddocs-row').filter({ hasText: first.title! }).getByRole('checkbox')).toBeDisabled();
    await window.keyboard.press('Escape');
    await expect(window.getByTestId('add-documents')).toHaveCount(0);
    await window.getByTestId('member-state').first().selectOption('read');
    await expect(window.getByTestId('project-counts')).toContainText('1 read');

    // Notes in Markdown: raw HTML is shown as text, never interpreted.
    await window.getByTestId('project-tab-notes').click();
    await window.getByTestId('notes-input').fill('# Plan\n\nRead **first** then <img src=x onerror="document.title=1"> second.\n\n- one\n- two');
    await expect(window.getByTestId('notes-preview').locator('strong')).toHaveText('first');
    await expect(window.getByTestId('notes-preview').locator('img')).toHaveCount(0);
    await expect(window.getByTestId('notes-preview').locator('li')).toHaveCount(2);
    await window.getByTestId('notes-save').click();
    await expect(window.getByTestId('notes-state')).toHaveText('Saved');

    // Reading plan: add, reorder with the buttons and the keyboard, state per item.
    await window.getByTestId('project-tab-plan').click();
    await window.getByTestId('plan-add-all').click();
    const items = window.getByTestId('plan-item');
    await expect(items).toHaveCount(2);
    const firstDoc = await items.first().getAttribute('data-plan-doc');
    await items.first().getByTestId('plan-down').click();
    await expect(items.last()).toHaveAttribute('data-plan-doc', firstDoc!);
    await items.last().focus();
    await window.keyboard.press('Alt+ArrowUp');
    await expect(items.first()).toHaveAttribute('data-plan-doc', firstDoc!);
    await items.first().getByTestId('plan-status').selectOption('reading');
    await expect(items.first()).toHaveAttribute('data-status', 'reading');

    // Everything is stored: leave and come back.
    await window.getByTestId('nav-library').click();
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-row').filter({ hasText: 'Literature review' }).getByTestId('project-open').click();
    await window.getByTestId('project-tab-notes').click();
    await expect(window.getByTestId('notes-input')).toHaveValue(/Read \*\*first\*\*/);
    await window.getByTestId('project-tab-plan').click();
    await expect(window.getByTestId('plan-item').first()).toHaveAttribute('data-plan-doc', firstDoc!);
    await expect(window.getByTestId('plan-item').first()).toHaveAttribute('data-status', 'reading');

    // Rename, archive, restore.
    await window.getByTestId('project-more').click();
    await window.getByTestId('project-rename').click();
    await window.getByTestId('project-name').fill('Literature review (renamed)');
    await window.getByTestId('project-rename-save').click();
    await expect(window.getByTestId('project-title')).toHaveText('Literature review (renamed)');
    await window.getByTestId('crumbs').getByRole('button', { name: 'Projects' }).click();
    await window.getByTestId('project-row').filter({ hasText: 'renamed' }).getByTestId('project-row-more').click();
    await window.getByTestId('project-archive').click();
    await expect(window.getByTestId('project-row').filter({ hasText: 'renamed' })).toHaveCount(0);
    await window.getByTestId('show-archived').getByRole('button').click();
    const archived = window.getByTestId('project-row').filter({ hasText: 'renamed' });
    await expect(archived).toHaveAttribute('data-status', 'archived');
    await archived.getByTestId('project-row-more').click();
    await window.getByTestId('project-restore').click();
    await expect(window.getByTestId('project-row').filter({ hasText: 'renamed' })).toHaveAttribute('data-status', 'active');

    // Undo from the history: the archive/restore pair is reversible.
    await window.getByTestId('undo-button').click();
    await expect(window.getByTestId('project-row').filter({ hasText: 'renamed' })).toHaveAttribute('data-status', 'archived');

    expect(await rows(window).count()).toBe(0); // the library list is not on this page
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});
