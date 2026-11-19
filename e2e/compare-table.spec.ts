import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipc, ipcData, pathOf, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * Wave 10, X8 (written, not run in the wave: D-443). Comparison table (16) and group overview (12), against the mock provider
 * (`RL_AI_PROVIDER=mock`, no network):
 * - the preview counts CELLS (papers x columns), not papers; a folder that is not enabled gets "not enabled" and sends nothing;
 * - the cells of a literature note are reused with no send (nothing is logged for them);
 * - the table is saved in the project as Markdown and read back; the group overview is saved even without Claude.
 */
const CHANNELS = ['compare:estimate', 'compare:run', 'compare:save', 'compare:get', 'compare:list', 'groups:get', 'groups:run', 'projects:create'];
const MOCK = { RL_AI_PROVIDER: 'mock' };
const COLUMNS = [
  { id: 'problem', name: 'Problem', key: 'problem' },
  { id: 'method', name: 'Method', key: 'method' },
];

async function open(testInfo: Parameters<typeof skipUnlessChannels>[1]): Promise<{ ctx: LaunchedApp; window: Page; ids: string[] }> {
  const ctx = await launchApp({ library: 'full', dialogPath: true, offline: true, env: MOCK });
  const { window } = ctx;
  await createLibraryViaWizard(window, { name: 'Compare library' });
  await skipUnlessChannels(window, testInfo, CHANNELS);
  await waitForScan(window, ctx.library!.manifest!.files.length);
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  const ids = asArray(await ipcData(window, 'documents:list', { limit: 200 }))
    .filter((it) => pathOf(it)?.startsWith('papers/'))
    .map((it) => idOf(it))
    .filter((x): x is string => !!x);
  return { ctx, window, ids };
}

test('the preview counts cells, a folder that is not enabled sends nothing, and the table is saved in the project (16)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, ids } = o;
    const two = ids.slice(0, 2);
    test.skip(two.length < 2, 'needs two papers');

    // Folder not enabled: every cell is "not enabled", nothing would be sent.
    const off = await ipcData<{ cells: { total: number; notEnabled: number; toWrite: number }; requests: number }>(window, 'compare:estimate', { docIds: two, columns: COLUMNS });
    expect(off.cells).toMatchObject({ total: 4, notEnabled: 4, toWrite: 0 });
    expect(off.requests).toBe(0);

    // Enabled: the cells are counted (2 papers x 2 columns), in one request per column.
    await ipcData(window, 'library:setConfig', { patch: { aiEnabledFolders: ['papers'] } });
    const on = await ipcData<{ cells: { total: number; toWrite: number }; requests: number; needsDialog: boolean }>(window, 'compare:estimate', { docIds: two, columns: COLUMNS });
    expect(on.cells).toMatchObject({ total: 4, toWrite: 4 });
    expect(on.requests).toBe(2);
    // Without the confirmation nothing goes.
    expect((await ipc(window, 'compare:run', { token: 't1', docIds: two, columns: COLUMNS })).error?.code).toBe(on.needsDialog ? 'CONFLICT' : undefined);

    const run = await ipcData<{ rows: Array<{ docId: string; cells: Record<string, { source: string; ai: boolean }> }>; written: number }>(window, 'compare:run', { token: 't2', docIds: two, columns: COLUMNS, confirmed: true });
    expect(run.rows).toHaveLength(2);
    for (const r of run.rows) for (const c of Object.values(r.cells)) if (c.source === 'claude') expect(c.ai).toBe(true);

    // The cells in the table are kept: a second estimate counts them as ready.
    const again = await ipcData<{ cells: { ready: number; toWrite: number } }>(window, 'compare:estimate', { docIds: two, columns: COLUMNS, existing: run.rows });
    expect(again.cells.ready).toBe(4);
    expect(again.cells.toWrite).toBe(0);

    // Saved in a project as Markdown, read back, listed.
    const project = await ipcData<{ project: { id: string } }>(window, 'projects:create', { name: 'Review' });
    const saved = await ipcData<{ table: { id: string } }>(window, 'compare:save', { projectId: project.project.id, title: 'Methods compared', columns: COLUMNS, rows: run.rows });
    const got = await ipcData<{ table: { title: string; rows: unknown[] } }>(window, 'compare:get', { projectId: project.project.id, id: saved.table.id });
    expect(got.table).toMatchObject({ title: 'Methods compared' });
    expect(got.table.rows).toHaveLength(2);
    expect((await ipcData<{ items: unknown[] }>(window, 'compare:list', { projectId: project.project.id })).items).toHaveLength(1);
  } finally {
    await ctx?.close();
  }
});

test('the group overview is saved without Claude, with the data and the warning (12)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, ids } = o;
    const docIds = ids.slice(0, 3);
    test.skip(docIds.length < 1, 'needs a paper');
    expect((await ipcData<{ overview: unknown }>(window, 'groups:get', { docIds })).overview).toBeNull();
    const run = await ipcData<{ overview: { synthesis: string; markdown: string; docs: number } }>(window, 'groups:run', { token: 'g1', docIds, withClaude: false });
    expect(run.overview).toMatchObject({ synthesis: 'not-written', docs: docIds.length });
    expect(run.overview.markdown).toContain('lab://doc/');
    expect((await ipcData<{ overview: { synthesis: string } | null }>(window, 'groups:get', { docIds })).overview?.synthesis).toBe('not-written');
  } finally {
    await ctx?.close();
  }
});
