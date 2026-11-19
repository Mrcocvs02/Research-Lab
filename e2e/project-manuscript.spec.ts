import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipcData, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * Manuscript of a project (§18.1, Z1b): sections written in the app, gaps, assigning papers from the list and from the matrix,
 * "Gaps only", unlinking. Synthetic library only; the file readers are covered by unit tests.
 */
const CHANNELS = ['project:manuscript', 'project:setManuscript', 'project:assign'];

type State = { manuscript: { sections: Array<{ id: string; title: string }>; assignments: unknown[] } | null };

async function open(testInfo: Parameters<typeof skipUnlessChannels>[1]): Promise<{ ctx: LaunchedApp; window: Page; projectId: string }> {
  const ctx = await launchApp({ library: 'full', dialogPath: true, offline: true });
  const { window } = ctx;
  await createLibraryViaWizard(window, { name: 'Manuscript library' });
  await skipUnlessChannels(window, testInfo, CHANNELS);
  await waitForScan(window, ctx.library!.manifest!.files.length);
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  const ids = asArray(await ipcData(window, 'documents:list', { limit: 5 })).map((d) => idOf(d)!);
  const created = await ipcData<{ project: { id: string } }>(window, 'projects:create', { name: 'Paper', docIds: ids.slice(0, 2) });
  return { ctx, window, projectId: created.project.id };
}

test('write sections in the app, see the gaps, assign from the list and from the matrix, unlink', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, projectId } = o;
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-open').first().click();
    await window.getByTestId('project-tab-notes').click();
    await window.getByTestId('notes-link-manuscript').click();
    await expect(window.getByTestId('ms-empty')).toBeVisible();
    await window.getByTestId('ms-start-app').click();
    await window.getByTestId('ms-editor-text').fill('# Introduction\n## Motivation\n# Methods');
    await window.getByTestId('ms-editor-save').click();

    // Three sections, all gaps.
    await expect(window.getByTestId('ms-section')).toHaveCount(3);
    await expect(window.getByTestId('ms-gap')).toHaveCount(3);
    await expect(window.getByTestId('ms-summary')).toBeVisible();

    // Assign a paper to the first section from the list.
    await window.getByTestId('ms-section-add').first().click();
    await expect(window.getByTestId('ms-assign-dialog')).toBeVisible();
    await window.getByTestId('ms-assign-item').first().check();
    await window.getByTestId('ms-assign-ok').click();
    await expect(window.getByTestId('ms-gap')).toHaveCount(2);
    await expect(window.getByTestId('ms-unassign')).toHaveCount(1);
    expect((await ipcData<State>(window, 'project:manuscript', { projectId })).manuscript?.assignments).toHaveLength(1);

    // "Gaps only" hides the section that has a source.
    await window.getByTestId('ms-gaps-only').check();
    await expect(window.getByTestId('ms-section')).toHaveCount(2);
    await window.getByTestId('ms-gaps-only').uncheck();
    await expect(window.getByTestId('ms-section')).toHaveCount(3);

    // The matrix: one cell is direct; clicking an empty cell of another row assigns it.
    await window.getByTestId('ms-view-matrix').click();
    await expect(window.getByTestId('ms-matrix')).toBeVisible();
    await expect(window.locator('[data-testid="ms-cell"][data-state="direct"]')).toHaveCount(1);
    await window.locator('[data-testid="ms-cell"][data-r="2"][data-c="0"]').click();
    await expect.poll(async () => (await ipcData<State>(window, 'project:manuscript', { projectId })).manuscript?.assignments.length).toBe(2);
    await expect(window.locator('[data-testid="ms-cell"][data-state="direct"]')).toHaveCount(2);

    // Back to the list: removing the source of the first section makes it a gap again.
    await window.getByTestId('ms-view-list').click();
    await window.getByTestId('ms-unassign').first().click();
    await expect(window.getByTestId('ms-gap')).toHaveCount(2);

    // Unlink asks first.
    await window.getByTestId('ms-more').click();
    await window.getByTestId('ms-unlink').click();
    await window.getByTestId('ms-confirm-ok').click();
    await expect(window.getByTestId('ms-empty')).toBeVisible();
    expect((await ipcData<State>(window, 'project:manuscript', { projectId })).manuscript).toBeNull();
  } finally {
    await ctx?.close();
  }
});

test('a renamed section (same id) keeps its assignments and the tab shows the realigned list', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, projectId } = o;
    const first = await ipcData<State>(window, 'project:setManuscript', { projectId, source: { kind: 'app', sections: [{ title: 'Background', level: 1 }, { title: 'Results', level: 1 }] } });
    const sec = first.manuscript!.sections[0]!;
    const docId = idOf(asArray(await ipcData(window, 'documents:list', { limit: 1 }))[0])!;
    await ipcData(window, 'project:assign', { projectId, sectionId: sec.id, refs: [{ kind: 'doc', docId }], on: true });
    const next = await ipcData<State>(window, 'project:setManuscript', { projectId, source: { kind: 'app', sections: [{ id: sec.id, title: 'Related work', level: 1 }, { title: 'Results', level: 1 }] } });
    expect(next.manuscript!.assignments).toHaveLength(1);
    expect(next.manuscript!.sections.find((s) => s.id === sec.id)?.title).toBe('Related work');
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-open').first().click();
    await window.getByTestId('project-tab-schema').click();
    await expect(window.getByTestId('ms-view')).toBeVisible();
    await expect(window.getByTestId('ms-section')).toHaveCount(2);
    await expect(window.getByTestId('ms-gap')).toHaveCount(1);
  } finally {
    await ctx?.close();
  }
});
