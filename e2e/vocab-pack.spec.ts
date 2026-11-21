import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, waitForScan } from './helpers/phase1';

/**
 * The field vocabulary (D-516 .. D-519, section 20.1) with the synthetic `test-pack` only: the dialog with its three steps, the sure
 * matches ticked, one undoable change, "Turn off and undo the links" giving the taxonomy back as it was, and the concepts of the pack
 * showing up (as tags) only when a gesture of the user uses them. The pack file is handed to the app through RL_E2E_PACKS_DIR.
 *
 * The second test is the pack applying itself (D-565): a library with at least 8 tags the pack sure-matches gets the vocabulary on its own, as
 * ONE change, with the notice (Activity row and toast); Undo gives the taxonomy back and the pack never applies itself again.
 */

interface Node {
  id: string;
  pack?: string;
  parents: string[];
  counts?: unknown;
  [k: string]: unknown;
}
type Created = { created: Array<{ id: string }> };

async function snapshot(window: Page): Promise<string> {
  const { nodes } = await ipcData<{ nodes: Node[] }>(window, 'taxonomy:get', {});
  return JSON.stringify(nodes.map(({ counts: _c, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id)));
}

test('field vocabulary: sure matches linked and placed in one change, concepts latent until used, undo gives the taxonomy back', async () => {
  test.setTimeout(300_000);
  const packs = mkdtempSync(path.join(os.tmpdir(), 'rl-packs-'));
  mkdirSync(packs, { recursive: true });
  copyFileSync(path.join(import.meta.dirname, '..', 'packages', 'core', 'src', 'vocab', 'test-pack.json'), path.join(packs, 'test-pack.json'));
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: 8 }, dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_PACKS_DIR: packs } });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Field vocabulary library' });
    await waitForScan(window, 8);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const list = await ipcData<{ items: Array<{ docId: string }> }>(window, 'documents:list', { limit: 20 });
    const docIds = list.items.map((i) => i.docId);

    // Generic, invented tags: two that the pack knows, one it does not.
    const make = async (label: string, parents: string[], docs: number[], extra: object[] = []): Promise<string> => {
      const r = await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label, ...(parents.length ? { parents } : {}) }, ...extra] });
      const id = r.created[0]!.id;
      if (docs.length > 0) await ipcData(window, 'documents:tag', { docIds: docs.map((i) => docIds[i]!), add: [id] });
      return id;
    };
    const topic = (await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label: 'Topic' }] })).created[0]!.id;
    await ipcData(window, 'taxonomy:apply', { ops: [{ op: 'setFamily', id: topic, family: 'many' }] });
    const inbox = await make('To sort', [], []);
    const alpha = await make('Alpha theory', [inbox], [0, 1, 2]);
    const gamma = await make('Gamma flow', [inbox], [3]);
    await make('Something else', [inbox], [4]);
    const initial = await snapshot(window);

    // The dialog: the pack with its local preview, then the three steps.
    await window.getByTestId('library-more').click();
    await window.getByRole('menuitem', { name: /Manage tags|Gestisci tag/ }).click();
    await expect(window.getByTestId('taxonomy-manager')).toBeVisible();
    await window.getByTestId('tax-pack-open').click();
    await expect(window.getByTestId('pack-dialog')).toBeVisible();
    const item = window.getByTestId('pack-item');
    await expect(item).toHaveAttribute('data-pack', 'test-pack');
    await expect(window.getByTestId('pack-preview')).toContainText(/2/);
    await window.getByTestId('pack-enable').click();
    await expect(window.getByTestId('pack-step-1')).toHaveAttribute('aria-current', 'step');
    await window.getByTestId('pack-step-2').click();
    const rows = window.getByTestId('pack-match-row');
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) await expect(row).toHaveAttribute('data-confidence', 'sure');
    for (const row of await rows.all()) await expect(row).toHaveAttribute('data-checked', 'true');
    await window.getByTestId('pack-step-3').click();
    await expect(window.getByTestId('pack-place-row')).toHaveCount(2);
    await window.getByTestId('pack-apply').click();
    await expect(window.getByTestId('pack-dialog')).toBeHidden();

    // One change: the two tags are linked and placed; the latent concepts are not tags.
    const after = (await ipcData<{ nodes: Node[] }>(window, 'taxonomy:get', {})).nodes;
    expect(after.find((n) => n.id === alpha)).toMatchObject({ pack: 'test-pack/topic.alpha-theory', parents: [topic] });
    expect(after.find((n) => n.id === gamma)).toMatchObject({ pack: 'test-pack/topic.gamma-flow', parents: [alpha] });
    expect(after.some((n) => n.label === 'Epsilon maps')).toBe(false);
    expect((await ipcData<{ items: Array<{ summary?: string }> }>(window, 'history:list', { limit: 5 })).items.length).toBeGreaterThan(0);

    // A concept becomes a tag only by a gesture: here the tag picker's call, which puts it on a paper in one change.
    const found = await ipcData<{ items: Array<{ conceptId: string }> }>(window, 'vocabPack:search', { q: 'epsilon' });
    expect(found.items.map((i) => i.conceptId)).toEqual(['topic.epsilon-maps']);
    const made = await ipcData<{ nodeId: string }>(window, 'vocabPack:materialize', { conceptId: 'topic.epsilon-maps', docIds: [docIds[5]!] });
    const withEpsilon = (await ipcData<{ nodes: Node[] }>(window, 'taxonomy:get', {})).nodes;
    expect(withEpsilon.find((n) => n.id === made.nodeId)).toMatchObject({ pack: 'test-pack/topic.epsilon-maps', parents: [topic] });
    await ipcData(window, 'history:undo', {});

    // Turn off and undo the links: the taxonomy is what it was.
    await window.getByTestId('tax-pack-open').click();
    await window.getByTestId('pack-disable').click();
    await window.getByTestId('pack-disable-undo').click();
    await expect(window.getByTestId('pack-dialog')).toBeHidden();
    await expect.poll(() => snapshot(window), { timeout: 30_000 }).toBe(initial);
  } finally {
    await ctx?.close();
    rmSync(packs, { recursive: true, force: true });
  }
});

test('field vocabulary applied by itself: notice with Undo and Review, one change, Undo gives the taxonomy back and it never comes back', async () => {
  test.setTimeout(300_000);
  const packs = mkdtempSync(path.join(os.tmpdir(), 'rl-packs-'));
  mkdirSync(packs, { recursive: true });
  copyFileSync(path.join(import.meta.dirname, '..', 'packages', 'core', 'src', 'vocab', 'test-pack.json'), path.join(packs, 'test-pack.json'));
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: 8 }, dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_PACKS_DIR: packs } });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Field vocabulary auto library' });
    await waitForScan(window, 8);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const list = await ipcData<{ items: Array<{ docId: string }> }>(window, 'documents:list', { limit: 20 });
    const docIds = list.items.map((i) => i.docId);

    // Nine invented tags the pack knows (sure), under a loose parent; the last change is what the pause of the app waits for.
    const topic = (await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label: 'Topic' }] })).created[0]!.id;
    await ipcData(window, 'taxonomy:apply', { ops: [{ op: 'setFamily', id: topic, family: 'many' }] });
    const inbox = (await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label: 'To sort' }] })).created[0]!.id;
    const ids: string[] = [];
    const labels = ['Alpha theory', 'Gamma flow', 'Delta systems', 'Delta chains', 'Epsilon maps', 'Eta model', 'Beta states', 'Sampling methods', 'Fast sampling'];
    for (const [i, label] of labels.entries()) {
      const id = (await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label, parents: [inbox] }] })).created[0]!.id;
      await ipcData(window, 'documents:tag', { docIds: [docIds[i % docIds.length]!], add: [id] });
      ids.push(id);
    }
    const initial = await snapshot(window);

    // The pack applies itself a few seconds after the library settles: the toast and the Activity row say so.
    const toast = window.getByTestId('toast').filter({ hasText: /(Field vocabulary applied|Vocabolario del campo applicato): \d+/ });
    await expect(toast).toBeVisible({ timeout: 60_000 });
    const after = (await ipcData<{ nodes: Node[] }>(window, 'taxonomy:get', {})).nodes;
    expect(after.find((n) => n.id === ids[0])).toMatchObject({ pack: 'test-pack/topic.alpha-theory', parents: [topic] });
    expect(after.find((n) => n.id === ids[1])).toMatchObject({ pack: 'test-pack/topic.gamma-flow', parents: [ids[0]] });
    await window.getByTestId('scan-status').click();
    await expect(window.getByTestId('activity-row').filter({ hasText: /(Field vocabulary applied|Vocabolario del campo applicato)/ })).toBeVisible();
    await window.keyboard.press('Escape');

    // Undo from the toast: the taxonomy is what it was and the pack stays off for good.
    await toast.getByTestId('toast-action').filter({ hasText: /Undo|Annulla/ }).click();
    await expect.poll(() => snapshot(window), { timeout: 30_000 }).toBe(initial);
    const state = await ipcData<{ active: unknown; suggest: string | null }>(window, 'vocabPack:list', {});
    expect(state.active).toBeNull();
    await window.waitForTimeout(9_000);
    expect(await snapshot(window)).toBe(initial);
  } finally {
    await ctx?.close();
    rmSync(packs, { recursive: true, force: true });
  }
});
