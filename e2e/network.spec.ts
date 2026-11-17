import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, percentile, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * NOT RUN YET: written against the phase 6 contracts (graph:*, explore:*) while the main side was still being built;
 * it needs the merged main side to pass. Run it alone (heavy: a corpus of 600 documents, one launch for the whole file).
 *
 * Phase 6 criterion, renderer half: the model is built with progress; the map shows points and cluster labels; the same
 * seed gives the same clusters after a rebuild; the expandable network holds 500 nodes without jank (p95 frame time
 * measured with requestAnimationFrame while panning must stay <= 50 ms); a document added later gets a position (status
 * shows it pending, the map has the point) without a full rebuild; from a macro-topic to a paper in at most four zooms
 * and back with the breadcrumb and the selection kept; from an author node to its topics and back to the author.
 */
const CHANNELS = ['graph:status', 'graph:build', 'graph:map', 'graph:neighbors', 'explore:level', 'explore:documents', 'explore:related', 'taxonomy:apply', 'documents:tag', 'documents:update', 'documents:list'];
const DOCS = 600;
const FRAME_P95_MS = 50;

interface MapData {
  points: Array<{ docId: string; clusters: string[] }>;
  clusters: Array<{ id: string; level: number; size: number; topTerms: string[] }>;
  seed: number;
}

const assignment = (m: MapData) => JSON.stringify(m.points.map((p) => [p.docId, p.clusters]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

test('network, map, clusters, expandable graph and zoomable exploration (phase 6)', async ({}, testInfo) => {
  test.setTimeout(1_200_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: DOCS }, dialogPath: true, offline: true });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Network library' });
    await skipUnlessChannels(window, testInfo, CHANNELS);
    await waitForScan(window, DOCS);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 300_000 });

    // 1. Empty state, build with progress.
    await window.getByTestId('nav-network').click();
    await expect(window.getByTestId('graph-empty')).toBeVisible();
    await window.getByTestId('graph-seed').fill('42');
    await window.getByTestId('graph-build-empty').click();
    const phases = new Set<string>();
    await expect
      .poll(
        async () => {
          const p = window.getByTestId('graph-progress');
          if ((await p.count()) > 0) {
            const phase = await p.getAttribute('data-phase');
            if (phase) phases.add(phase);
          }
          return window.getByTestId('graph-status').getAttribute('data-state');
        },
        { timeout: 600_000, intervals: [100, 200, 500] },
      )
      .toBe('ready');
    expect(phases.size, 'progress phases seen while building').toBeGreaterThan(0);

    // 2. The map: points and cluster labels.
    const canvas = window.getByTestId('map-canvas');
    await expect(canvas).toHaveAttribute('data-points', String(DOCS));
    await expect.poll(async () => Number(await canvas.getAttribute('data-drawn')), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => Number((await canvas.getAttribute('data-labels')) ?? 0)).toBeGreaterThan(0);
    expect(await window.getByTestId('cluster-item').count()).toBeGreaterThan(0);
    await canvas.focus();
    await window.keyboard.press('+');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('0');

    // 3. Same seed, same clusters after a rebuild.
    const first = await ipcData<MapData>(window, 'graph:map', {});
    expect(first.seed).toBe(42);
    await window.getByTestId('graph-seed').fill('42');
    await window.getByTestId('graph-build').click();
    await expect(window.getByTestId('graph-progress')).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
    await expect(window.getByTestId('graph-status')).toHaveAttribute('data-state', 'ready', { timeout: 600_000 });
    await expect(window.getByTestId('graph-progress')).toHaveCount(0);
    const second = await ipcData<MapData>(window, 'graph:map', {});
    expect(second.clusters.map((c) => [c.id, c.size, c.topTerms])).toEqual(first.clusters.map((c) => [c.id, c.size, c.topTerms]));
    expect(assignment(second)).toBe(assignment(first));

    // 4. Expandable network with ~500 nodes: smooth while panning.
    await window.getByTestId('net-tab-network').click();
    await window.getByTestId('net-limit').selectOption('300');
    await window.getByTestId('net-start-folder').selectOption('');
    const net = window.getByTestId('net-canvas');
    const count = async () => Number((await window.getByTestId('net-count').getAttribute('data-count')) ?? 0);
    await expect.poll(count, { timeout: 60_000 }).toBeGreaterThan(10);
    await net.focus();
    for (let i = 0; i < 80 && (await count()) < 500; i++) {
      for (let k = 0; k < 7 + (i % 5); k++) await window.keyboard.press(']');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(250);
    }
    expect(await count(), 'network size').toBeGreaterThanOrEqual(500);
    await window.getByTestId('net-fit').click();
    await window.waitForTimeout(1500); // let the layout settle
    const box = (await net.boundingBox())!;
    await window.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__frames = [];
      w.__run = true;
      let last = performance.now();
      const loop = (t: number) => {
        w.__frames.push(t - last);
        last = t;
        if (w.__run) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.down();
    for (let i = 0; i < 120; i++) await window.mouse.move(box.x + box.width / 2 + 150 * Math.sin(i / 10), box.y + box.height / 2 + 100 * Math.cos(i / 10));
    await window.mouse.up();
    for (let i = 0; i < 12; i++) await window.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
    const frames = await window.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__run = false;
      return w.__frames.slice(1);
    });
    const p95 = percentile(frames, 95);
    testInfo.annotations.push({ type: 'p95-frame-ms', description: `${p95.toFixed(1)} over ${frames.length} frames (500+ nodes, panning and zooming)` });
    expect(p95, `p95 frame time ${p95.toFixed(1)} ms`).toBeLessThanOrEqual(FRAME_P95_MS);
    await window.getByTestId('net-reset').click();
    await expect(window.getByTestId('net-count')).toHaveAttribute('data-count', '0');

    // 5. A new document gets a position after `pending`, without a full rebuild.
    const before = await ipcData<MapData>(window, 'graph:map', {});
    await writeFile(path.join(ctx.library!.root, 'added-after-build.md'), '# Added after the build\n\nA short note about spectral graph clustering written after the model was built.\n');
    await window.getByTestId('net-tab-map').click();
    await expect
      .poll(async () => Number(await window.getByTestId('graph-status').getAttribute('data-pending')), { timeout: 120_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0);
    await expect(window.getByTestId('graph-status')).toHaveAttribute('data-state', 'stale');
    await expect(window.getByTestId('map-canvas')).toHaveAttribute('data-points', String(before.points.length + 1), { timeout: 60_000 });
    const after = await ipcData<MapData>(window, 'graph:map', {});
    expect(after.points.length).toBe(before.points.length + 1);
    expect(after.seed).toBe(before.seed);

    // 6. Exploration: macro-topic to a paper in at most four zooms, and back with the context kept.
    const created = await ipcData<{ created: Array<{ id: string }> }>(window, 'taxonomy:apply', { ops: [{ op: 'create', label: 'Macro' }] });
    const macro = created.created[0]!.id;
    const meso = (await ipcData<{ created: Array<{ id: string }> }>(window, 'taxonomy:apply', { ops: [{ op: 'create', label: 'Meso', parents: [macro] }] })).created[0]!.id;
    const micro = (await ipcData<{ created: Array<{ id: string }> }>(window, 'taxonomy:apply', { ops: [{ op: 'create', label: 'Micro', parents: [meso] }] })).created[0]!.id;
    const list = await ipcData<{ items: Array<{ docId: string }> }>(window, 'documents:list', { limit: 3 });
    const target = list.items[0]!.docId;
    await ipcData(window, 'documents:tag', { docIds: [target], add: [micro] });
    await ipcData(window, 'documents:update', { docId: target, patch: { authors: ['Test Author A'] } });

    await window.getByTestId('net-tab-explore').click();
    const panel = window.getByTestId('explore-panel');
    await expect(panel).toHaveAttribute('data-dim', 'topic');
    const macroNode = window.getByTestId('explore-node').filter({ hasText: 'Macro' });
    await macroNode.click();
    let zooms = 0;
    for (; zooms < 6; ) {
      const sel = panel.locator('[data-testid="explore-node"][aria-pressed="true"]');
      if ((await sel.getAttribute('data-has-children')) !== 'true') break;
      await window.getByTestId('explore-zoom').click();
      zooms++;
      await expect(panel).toHaveAttribute('data-depth', String(zooms));
      await window.getByTestId('explore-node').first().click();
    }
    expect(zooms).toBeGreaterThan(0);
    expect(zooms, 'zooms from a macro-topic to the paper').toBeLessThanOrEqual(4);
    await expect(window.getByTestId('crumb-current')).toBeVisible();
    const paper = window.getByTestId('explore-doc').first();
    await expect(paper).toBeVisible();
    await paper.getByTestId('sim-open').click();
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', target);
    // Back: breadcrumb and selection are as they were.
    for (let i = 0; i < zooms; i++) await window.getByTestId('explore-back').click();
    await expect(panel).toHaveAttribute('data-depth', '0');
    await expect(macroNode).toHaveAttribute('aria-pressed', 'true');

    // 7. From an author to their topics, and back to the author.
    await window.getByTestId('explore-dim-author').click();
    await expect(panel).toHaveAttribute('data-dim', 'author');
    const author = window.getByTestId('explore-node').filter({ hasText: 'Test Author A' });
    await author.click();
    await window.getByTestId('explore-related-topic').click();
    await expect(window.getByTestId('explore-related')).toHaveAttribute('data-to', 'topic');
    await expect(window.getByTestId('related-node').first()).toBeVisible();
    await window.getByTestId('related-node').first().click();
    await expect(panel).toHaveAttribute('data-dim', 'topic');
    await window.getByTestId('explore-back').click();
    await expect(panel).toHaveAttribute('data-dim', 'author');
    await expect(author).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await ctx?.close();
  }
});
