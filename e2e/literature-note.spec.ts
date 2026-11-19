import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipc, ipcData, pathOf, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * Wave 8, X3 (written, not run in the wave: D-443). Literature notes (2), note templates (35), LaTeX (37) and links by
 * identifier with incoming links (38), against the mock provider (`RL_AI_PROVIDER=mock`, no network).
 * - a paper in an enabled folder: the cost dialog, a draft "Draft ✦ to approve", the approval; the AI file stays apart
 *   from the user's note, and nothing is sent for a paper in a folder that is not enabled (a poor note from title and abstract);
 * - at most five papers per send;
 * - a note with `$...$`, a formula that is not understood shown as written, and a `[[` link that survives a rename.
 */
const CHANNELS = ['literature:get', 'literature:estimate', 'literature:run', 'literature:approve', 'literature:discard', 'templates:list', 'templates:save', 'templates:remove', 'templates:apply', 'links:incoming', 'links:titles', 'links:suggest'];
const MOCK = { RL_AI_PROVIDER: 'mock' };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function docIdsByPath(window: Page): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of asArray(await ipcData(window, 'documents:list', { limit: 200 }))) {
    const p = pathOf(it);
    const id = idOf(it);
    if (p && id) out.set(p, id);
  }
  return out;
}

async function open(testInfo: Parameters<typeof skipUnlessChannels>[1]): Promise<{ ctx: LaunchedApp; window: Page; ids: Map<string, string> }> {
  const ctx = await launchApp({ library: 'full', dialogPath: true, offline: true, env: MOCK });
  const { window } = ctx;
  await createLibraryViaWizard(window, { name: 'Literature library' });
  await skipUnlessChannels(window, testInfo, CHANNELS);
  await waitForScan(window, ctx.library!.manifest!.files.length);
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  return { ctx, window, ids: await docIdsByPath(window) };
}

test('a paper in an enabled folder: estimate, draft to approve, approval; originals and the user note untouched (2)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, ids } = o;
    const rel = 'papers/paper-01.pdf';
    const docId = ids.get(rel)!;
    test.skip(!docId, 'needs the papers folder');
    const before = sha(await readFile(path.join(ctx.library!.root, rel)));
    await ipcData(window, 'library:setConfig', { patch: { aiEnabledFolders: ['papers'] } });

    // The estimate always asks first (a literature note is above the threshold, D-416) and names what is sent.
    const est = await ipcData<{ needsDialog: boolean; sent: number; folderEnabled: boolean }>(window, 'literature:estimate', { docIds: [docId] });
    expect(est).toMatchObject({ needsDialog: true, sent: 1, folderEnabled: true });
    // Without confirmation nothing goes.
    expect((await ipc(window, 'literature:run', { docId })).error?.code).toBe('CONFLICT');
    expect((await ipcData<{ note: unknown }>(window, 'literature:get', { docId })).note).toBeNull();

    const run = await ipcData<{ note: { review: string; ai: boolean; body: string } }>(window, 'literature:run', { docId, confirmed: true });
    expect(run.note).toMatchObject({ review: 'proposed', ai: true });
    expect(run.note.body).toContain(`lab://doc/${docId}?page=1`);

    // It is a draft until approved; the AI text is its own file, and the note of the user is not created.
    expect((await ipcData<{ note: unknown }>(window, 'notes:get', { docId })).note).toBeNull();

    // Asked again, the same request is answered from the cache: nothing more is sent.
    const again = await ipcData<{ cached: boolean }>(window, 'literature:run', { docId, confirmed: true, regenerate: true });
    expect(again.cached).toBe(true);

    await ipcData(window, 'literature:approve', { docId });
    expect((await ipcData<{ note: { review: string } }>(window, 'literature:get', { docId })).note?.review).toBe('approved');
    expect(sha(await readFile(path.join(ctx.library!.root, rel)))).toBe(before);
  } finally {
    await ctx?.close();
  }
});

test('a paper in a folder that is not enabled sends nothing: a poor note from title and abstract, with the warning (2)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, ids } = o;
    const docId = ids.get('papers/paper-01.pdf')!;
    test.skip(!docId, 'needs the papers folder');

    const est = await ipcData<{ sent: number; abstractOnly: number; folderEnabled: boolean }>(window, 'literature:estimate', { docIds: [docId] });
    expect(est).toMatchObject({ sent: 0, abstractOnly: 1, folderEnabled: false });
    const run = await ipcData<{ note: { abstractOnly: boolean; ai: boolean; review: string } }>(window, 'literature:run', { docId });
    expect(run.note).toMatchObject({ abstractOnly: true, ai: false, review: 'approved' });

    // The card says so, in the Notes section.
    await window.getByTestId('search-sort').selectOption('title');
    await window.getByTestId('search-result').first().click();
    await expect(window.getByTestId('lit-poor')).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx?.close();
  }
});

test('at most five papers per send (2)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, ids } = o;
    const six = [...ids.values()].slice(0, 6);
    test.skip(six.length < 6, 'needs six documents');
    expect((await ipc(window, 'literature:estimate', { docIds: six })).error?.code).toBe('INVALID_REQUEST');
    await window.getByTestId('search-sort').selectOption('title');
    await window.getByTestId('search-result').first().click();
    for (let i = 1; i < 6; i++) await window.getByTestId('search-result').nth(i).click({ modifiers: ['Control'] });
    await window.getByTestId('bulk-claude').click();
    await window.getByTestId('selection-literature').click();
    await expect(window.getByTestId('lit-dialog')).toBeVisible();
    await expect(window.getByTestId('lit-dialog')).toContainText('5');
  } finally {
    await ctx?.close();
  }
});

test('a note with a formula, a formula that is not understood, and a link that survives a rename (35, 37, 38)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, ids } = o;
    const [a, b] = [...ids.values()];
    test.skip(!a || !b, 'needs two documents');

    // Templates: the built-in literature template is there; a second one makes the menu of a new note appear.
    const first = await ipcData<{ items: Array<{ id: string; builtin: boolean }> }>(window, 'templates:list', {});
    expect(first.items.map((t) => t.id)).toContain('letteratura');
    const saved = await ipcData<{ item: { id: string } }>(window, 'templates:save', { name: 'Reading log', body: '# {{titolo}}\n{{autori}}\n' });
    const applied = await ipcData<{ text: string }>(window, 'templates:apply', { id: saved.item.id, docId: a! });
    expect(applied.text.startsWith('# ')).toBe(true);

    // A link is saved by identifier; the formula is saved as written.
    const titleBefore = ((await ipcData<{ docs: Record<string, string> }>(window, 'links:titles', { docIds: [b!], projectIds: [] })).docs[b!])!;
    const body = `Energy $E=mc^2$ and $\\unknowncommand{x}$ see [[${titleBefore}|lab://doc/${b}]]`;
    await ipcData(window, 'notes:save', { docId: a, body, expectedUpdatedAt: null });
    expect((await ipcData<{ items: Array<{ docId: string }> }>(window, 'links:incoming', { docId: b })).items.map((i) => i.docId)).toEqual([a]);

    // Rename the target: the link still resolves, to the new title.
    await ipcData(window, 'documents:update', { docId: b, patch: { title: 'A new title after the rename' } });
    expect((await ipcData<{ docs: Record<string, string> }>(window, 'links:titles', { docIds: [b!], projectIds: [] })).docs[b!]).toBe('A new title after the rename');
    expect((await ipcData<{ items: unknown[] }>(window, 'links:incoming', { docId: b })).items).toHaveLength(1);

    // In the card: the preview shows the formula as MathML, the other one as written with a mark, and the link with the new title.
    const titleA = ((await ipcData<{ docs: Record<string, string> }>(window, 'links:titles', { docIds: [a!], projectIds: [] })).docs[a!])!;
    await window.getByTestId('search-sort').selectOption('title');
    await window.getByTestId('search-result').filter({ hasText: titleA }).first().click();
    await window.getByTestId('search-result').first().click();
    await window.getByTestId('card-note-layout-preview').click();
    await expect(window.getByTestId('math').first()).toBeVisible();
    await expect(window.locator('[data-testid="math"] math')).toHaveCount(1);
    await expect(window.getByTestId('math-raw')).toHaveCount(1);
    await expect(window.getByTestId('note-link').first()).toHaveText(/A new title after the rename/);
  } finally {
    await ctx?.close();
  }
});
