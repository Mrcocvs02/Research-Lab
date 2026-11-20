import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, waitForScan } from './helpers/phase1';

/**
 * Editing the Map in blocks by hand (D-521..D-524, D-530..D-534, section 20.2.3, 20.3, 20.4) on a synthetic library: select a paper and drag it into
 * another block of a family of several values (the notice says it stays in the old one, "Also remove" and Shift at the release take it off, Undo puts
 * it back) and of one value; a press on a paper that is not selected moves the view and changes nothing; "Move to..." by the keyboard; rename with
 * the old name as an alias and merge from the menu of a block; a Ctrl+drag rectangle and "Copy BibTeX"; Shift+click starts the path; the
 * macro-areas dialog with the synthetic `test-pack`. Positions come from the e2e-only probe `window.__rlMapProbe` (RL_E2E=1).
 */
const DOCS = 30;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Probe {
  nodes: Array<{ id: string; x: number; y: number; block: string }>;
  view: { cx: number; cy: number; k: number; w: number; h: number };
  frame: { canvas: Box | null };
}
type Created = { created: Array<{ id: string }> };
interface Node {
  id: string;
  label: string;
  aliases: string[];
  status?: string;
  counts?: unknown;
  [k: string]: unknown;
}

const probe = (window: Page): Promise<Probe> => window.evaluate(() => (window as unknown as { __rlMapProbe: () => unknown }).__rlMapProbe()) as Promise<Probe>;

async function settled(window: Page): Promise<void> {
  let prevKey = '';
  await expect
    .poll(async () => {
      const q = await probe(window);
      const key = JSON.stringify([q.nodes.map((n) => [n.x.toFixed(1), n.y.toFixed(1)]), q.view.k.toFixed(3)]);
      const same = key === prevKey;
      prevKey = key;
      return same;
    }, { timeout: 15_000 })
    .toBe(true);
}

test('edit the Map by hand: drag into a block, keyboard, rename, merge, rectangle, path, macro-areas', async () => {
  test.setTimeout(900_000);
  const packs = mkdtempSync(path.join(os.tmpdir(), 'rl-packs-'));
  mkdirSync(packs, { recursive: true });
  copyFileSync(path.join(__dirname, '..', 'packages', 'core', 'src', 'vocab', 'test-pack.json'), path.join(packs, 'test-pack.json'));
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: DOCS }, dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_PACKS_DIR: packs } });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Map edit library' });
    await waitForScan(window, DOCS);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 300_000 });
    const list = await ipcData<{ items: Array<{ docId: string }> }>(window, 'documents:list', { limit: 50 });
    const docIds = list.items.map((i) => i.docId);

    // Invented tags: Topic (several values) with three values (Alpha is on more than half of the 30 papers), Stage (one value) with two.
    const make = async (label: string, parents: string[], docs: number[], extra: object[] = []): Promise<string> => {
      const r = await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label, ...(parents.length ? { parents } : {}) }, ...extra] });
      const id = r.created[0]!.id;
      if (docs.length > 0) await ipcData(window, 'documents:tag', { docIds: docs.map((i) => docIds[i]!), add: [id] });
      return id;
    };
    const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
    const topic = await make('Topic', [], []);
    await ipcData(window, 'taxonomy:apply', { ops: [{ op: 'setFamily', id: topic, family: 'many' }] });
    const alpha = await make('Alpha', [topic], range(0, 16));
    const beta = await make('Beta', [topic], range(16, 22));
    const gamma = await make('Gamma', [topic], range(22, 26));
    const stage = await make('Stage', [], []);
    await ipcData(window, 'taxonomy:apply', { ops: [{ op: 'setFamily', id: stage, family: 'one' }] });
    const draft = await make('Draft', [stage], range(0, 14));
    const final = await make('Final', [stage], range(14, 26));
    const tagsOf = async (docId: string): Promise<string[]> => (await ipcData<{ tags: string[] }>(window, 'documents:get', { docId })).tags;
    const nodes = async (): Promise<Node[]> => (await ipcData<{ nodes: Node[] }>(window, 'taxonomy:get', {})).nodes;

    // The Map: build the model, then group by Topic.
    await window.getByTestId('nav-map').click();
    await window.getByTestId('graph-build-empty').click();
    await expect(window.getByTestId('graph-status')).toHaveAttribute('data-state', 'ready', { timeout: 600_000 });
    await expect(window.getByTestId('map-blocks')).toBeVisible({ timeout: 60_000 });
    const groupBy = async (id: string) => {
      const sel = window.getByTestId('map-group-by');
      if (!(await sel.isVisible())) await window.getByTestId('map-strip-controls').click();
      await window.getByTestId('map-group-by').selectOption(id);
      await window.keyboard.press('Escape');
      await expect(window.getByTestId('map-blocks')).toBeVisible({ timeout: 60_000 });
      await settled(window);
    };
    const fams = (await ipcData<{ families: Array<{ id: string; label: string }> }>(window, 'graph:family', {})).families;
    const topicFamily = fams.find((f) => f.id === `root:${topic}`)?.id ?? 'topic';
    await groupBy(topicFamily);

    const canvas = window.getByTestId('map-canvas');
    const at = async (id: string) => {
      const q = await probe(window);
      const n = q.nodes.find((x) => x.id === id)!;
      return { x: q.frame.canvas!.x + n.x, y: q.frame.canvas!.y + n.y };
    };
    const inBlock = async (block: string, skip = 0) => {
      const q = await probe(window);
      const c = q.frame.canvas!;
      const hits = q.nodes.filter((n) => n.block === block && n.x > 30 && n.y > 30 && n.x < c.w - 30 && n.y < c.h - 30);
      return hits[skip]!.id;
    };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, keys: string[] = []) => {
      await window.mouse.move(from.x, from.y);
      await window.mouse.down();
      await window.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
      await window.mouse.move(to.x, to.y, { steps: 6 });
      for (const k of keys) await window.keyboard.down(k);
      await window.mouse.up();
      for (const k of keys) await window.keyboard.up(k);
    };

    // 1. A family of several values: select a paper of Alpha, drag it to Beta. It keeps Alpha and gets Beta; the notice says so.
    const a1 = await inBlock(alpha);
    const betaDrop = await at(await inBlock(beta));
    await window.mouse.click((await at(a1)).x, (await at(a1)).y);
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', a1);
    await expect(window.getByTestId('map-move-hint')).toBeVisible();
    await drag(await at(a1), betaDrop);
    await expect(window.getByTestId('toast').filter({ hasText: /still also in|resta anche in/ })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => tagsOf(a1)).toEqual(expect.arrayContaining([alpha, beta]));
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', a1);

    // 2. "Also remove from ..." repeats the move taking the old value off: one change stays active.
    await window.getByTestId('toast-action').filter({ hasText: /Also remove|Togli anche/ }).click();
    await expect.poll(async () => (await tagsOf(a1)).includes(alpha), { timeout: 15_000 }).toBe(false);
    expect(await tagsOf(a1)).toContain(beta);

    // 3. Undo puts the paper back with its old tags.
    await window.getByTestId('toast-action').filter({ hasText: /^(Undo|Annulla)$/ }).last().click();
    await expect.poll(async () => (await tagsOf(a1)).includes(alpha), { timeout: 15_000 }).toBe(true);
    expect(await tagsOf(a1)).not.toContain(beta);
    await settled(window);

    // 4. Shift at the release takes the old value off at once.
    const a2 = await inBlock(alpha, 1);
    await window.mouse.click((await at(a2)).x, (await at(a2)).y);
    await drag(await at(a2), await at(await inBlock(beta)), ['Shift']);
    await expect.poll(async () => (await tagsOf(a2)).includes(beta), { timeout: 15_000 }).toBe(true);
    expect(await tagsOf(a2)).not.toContain(alpha);
    await window.getByTestId('toast-action').filter({ hasText: /^(Undo|Annulla)$/ }).last().click();
    await expect.poll(async () => (await tagsOf(a2)).includes(alpha), { timeout: 15_000 }).toBe(true);
    await settled(window);

    // 5. A press on a paper that is not selected moves the view and changes no tag.
    const a3 = await inBlock(gamma);
    const before = await probe(window);
    const tagsBefore = await tagsOf(a3);
    const p3 = await at(a3);
    await drag(p3, { x: p3.x + 60, y: p3.y + 40 });
    expect(await tagsOf(a3)).toEqual(tagsBefore);
    await expect.poll(async () => Math.abs((await probe(window)).view.cx - before.view.cx)).toBeGreaterThan(0.5);

    // 6. "Move to..." from the keyboard (M) in a family of one value; the box to take the old value off is only in the several-valued one.
    await groupBy(`root:${stage}`);
    const d1 = await inBlock(draft);
    await window.mouse.click((await at(d1)).x, (await at(d1)).y);
    await canvas.focus();
    await window.keyboard.press('m');
    await expect(window.getByTestId('map-move-menu')).toBeVisible();
    await expect(window.getByTestId('map-move-remove')).toHaveCount(0);
    await window.locator(`[data-testid="map-move-option"][data-block="${final}"]`).click();
    await expect.poll(async () => (await tagsOf(d1)).includes(final), { timeout: 15_000 }).toBe(true);
    expect(await tagsOf(d1)).not.toContain(draft);
    await window.getByTestId('toast-action').filter({ hasText: /^(Undo|Annulla)$/ }).last().click();
    await expect.poll(async () => (await tagsOf(d1)).includes(draft), { timeout: 15_000 }).toBe(true);
    await settled(window);

    // 7. Back to Topic: rename with F2 on the block of the list (the old name stays as an alias), merge from the menu of a block.
    await groupBy(topicFamily);
    const chip = (id: string) => window.locator(`[data-testid="map-block"][data-value="${id}"]`);
    await chip(gamma).focus();
    await window.keyboard.press('F2');
    await expect(window.getByTestId('map-block-rename-input')).toBeVisible();
    await window.getByTestId('map-block-rename-input').fill('Gamma flow');
    await window.keyboard.press('Enter');
    await expect.poll(async () => (await nodes()).find((n) => n.id === gamma)?.label, { timeout: 15_000 }).toBe('Gamma flow');
    expect((await nodes()).find((n) => n.id === gamma)?.aliases).toContain('Gamma');
    await settled(window);
    await chip(gamma).click({ button: 'right' });
    await window.getByTestId('map-block-merge').click();
    await window.locator(`[data-testid="map-block-merge-target"][data-block="${beta}"]`).click();
    await expect(window.getByTestId('map-block-merge-confirm')).toBeVisible();
    await window.getByTestId('map-block-merge-ok').click();
    await expect.poll(async () => (await tagsOf(docIds[22]!)).includes(beta), { timeout: 15_000 }).toBe(true);
    await window.getByTestId('toast-action').filter({ hasText: /^(Undo|Annulla)$/ }).last().click();
    await expect.poll(async () => (await tagsOf(docIds[22]!)).includes(gamma), { timeout: 15_000 }).toBe(true);
    await settled(window);

    // 8. A rectangle with Ctrl selects the papers in it; the bar shows the count, "Copy BibTeX" copies them, Esc empties the selection.
    await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1920, 1000));
    await expect(window.getByTestId('map-side')).toBeVisible({ timeout: 15_000 });
    await window.waitForTimeout(700);
    await settled(window);
    const q = await probe(window);
    const c = q.frame.canvas!;
    const shown = q.nodes.filter((n) => n.x > 20 && n.y > 20 && n.x < c.w - 20 && n.y < c.h - 20);
    const xs = shown.slice(0, 4).map((n) => n.x);
    const ys = shown.slice(0, 4).map((n) => n.y);
    await window.keyboard.down('Control');
    await window.mouse.move(c.x + Math.min(...xs) - 12, c.y + Math.min(...ys) - 12);
    await window.mouse.down();
    await window.mouse.move(c.x + Math.max(...xs) + 12, c.y + Math.max(...ys) + 12, { steps: 8 });
    await window.mouse.up();
    await window.keyboard.up('Control');
    await expect(window.getByTestId('map-selbar')).toBeVisible();
    expect(Number(await window.getByTestId('map-selbar').getAttribute('data-count'))).toBeGreaterThanOrEqual(2);
    await window.getByTestId('map-sel-bibtex').click();
    await expect(window.getByTestId('toast').filter({ hasText: /copied|copiat/ })).toBeVisible({ timeout: 15_000 });
    await canvas.focus();
    await window.keyboard.press('Escape');
    await expect(window.getByTestId('map-selbar')).toHaveCount(0);

    // 9. Shift+click on another paper: the path from the selected one, in the neighbourhood tab.
    const [s1, s2] = [shown[0]!, shown[shown.length - 1]!];
    await window.mouse.click(c.x + s1.x, c.y + s1.y);
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', s1.id);
    await window.keyboard.down('Shift');
    await window.mouse.click(c.x + s2.x, c.y + s2.y);
    await window.keyboard.up('Shift');
    await expect(window.getByTestId('net-tab-network')).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('path-strip')).toBeVisible();
    await window.getByTestId('path-close').click();
    await window.getByTestId('net-tab-map').click();

    // 10. Macro-areas with the synthetic test pack, always with a proposal: Alpha sits on 16 of 30 papers (generic) and gets four sub-values of four
    // papers each, so the cut splits it. The dialog opens from the menu of a block, says that the tags do not change, and applying then undoing
    // gives the taxonomy back (what changes is only where the values stand in the tree).
    const pv = await ipcData<{ families: Array<{ packFamily: string; root: string }>; matches: Array<{ nodeId: string; conceptId: string; confidence: string }>; place: Array<{ nodeId: string; parentId: string | null }> }>(window, 'vocabPack:preview', { packId: 'test-pack' });
    await ipcData(window, 'vocabPack:enable', {
      packId: 'test-pack',
      families: Object.fromEntries(pv.families.map((f) => [f.packFamily, f.root])),
      accept: { matches: pv.matches.filter((m) => m.confidence === 'sure').map((m) => ({ nodeId: m.nodeId, conceptId: m.conceptId })), place: [] },
      reject: [],
    });
    for (const [i, label] of ['Alpha one', 'Alpha two', 'Alpha three', 'Alpha four'].entries()) await make(label, [alpha], range(0, 16).filter((d) => d % 4 === i));
    const snapshot = async () => JSON.stringify((await nodes()).map(({ counts: _c, revision: _r, updatedAt: _u, ...n }) => n).sort((x, y) => x.id.localeCompare(y.id)));
    const taxBefore = await snapshot();
    await expect(chip(alpha)).toBeVisible({ timeout: 30_000 });
    await chip(alpha).click({ button: 'right' });
    await window.getByTestId('map-block-macro').click();
    await expect(window.getByTestId('macro-dialog')).toBeVisible();
    await expect(window.getByTestId('macro-note')).toBeVisible();
    await expect(window.getByTestId('macro-stats')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('macro-move').first()).toBeVisible();
    await expect(window.getByTestId('macro-tree').first()).toBeVisible();
    for (const box of await window.getByTestId('macro-name').all()) await expect(box).not.toHaveValue('');
    await window.getByTestId('macro-apply').click();
    await expect(window.getByTestId('macro-dialog')).toBeHidden({ timeout: 30_000 });
    expect(await snapshot()).not.toBe(taxBefore);
    await window.getByTestId('toast-action').filter({ hasText: /^(Undo|Annulla)$/ }).last().click();
    await expect.poll(snapshot, { timeout: 30_000 }).toBe(taxBefore);
    // The papers kept every tag they had.
    expect(await tagsOf(docIds[0]!)).toEqual(expect.arrayContaining([alpha, draft]));
  } finally {
    await ctx?.close();
    rmSync(packs, { recursive: true, force: true });
  }
});
