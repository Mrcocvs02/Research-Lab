import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, percentile, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * Run it alone (heavy: a corpus of 600 documents, one launch for the whole file).
 *
 * Phase 6 criterion, renderer half: the model is built with progress; the map shows points and cluster labels; the same
 * seed gives the same clusters after a rebuild; the expandable network holds 500 nodes without jank (p95 frame time
 * measured with requestAnimationFrame while panning and zooming, while expanding a node (with the simulation ticks that settle it) and while dragging a node: no long task, p95 within max(50 ms, twice the median frame)); a document added later gets a position (status
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
    await window.getByTestId('nav-map').click();
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
    // Keyboard selection on the map: ] goes to a point in view, Enter selects it and the detail opens.
    await window.keyboard.press(']');
    await expect(window.getByTestId('map-focus')).not.toHaveText('');
    await window.keyboard.press('Enter');
    await expect(window.getByTestId('net-detail')).toBeVisible();

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
    const frameWindow = window;
    /** Frames (requestAnimationFrame deltas) and long tasks while `action` runs. */
    const measure = async (label: string, action: () => Promise<void>) => {
      await frameWindow.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __run: boolean; __long: number[]; __obs?: PerformanceObserver };
        w.__frames = [];
        w.__long = [];
        w.__run = true;
        // Long tasks (> 50 ms of main-thread work) tell our own work apart from frames the machine was too busy to draw.
        try {
          w.__obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) w.__long.push(e.duration);
          });
          w.__obs.observe({ entryTypes: ['longtask'] });
        } catch {
          /* not supported */
        }
        let last = performance.now();
        const loop = (t: number) => {
          w.__frames.push(t - last);
          last = t;
          if (w.__run) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      await action();
      const r = await frameWindow.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __run: boolean; __long: number[]; __obs?: PerformanceObserver };
        w.__run = false;
        w.__obs?.disconnect();
        return { frames: w.__frames.slice(1), long: w.__long };
      });
      const p50 = percentile(r.frames, 50);
      const p95 = percentile(r.frames, 95);
      console.log(`NET-FRAMES ${label} ${JSON.stringify({ n: r.frames.length, p50, p90: percentile(r.frames, 90), p95, p99: percentile(r.frames, 99), max: Math.max(...r.frames), longTasks: r.long.length, longMax: r.long.length ? Math.max(...r.long) : 0 })}`);
      testInfo.annotations.push({ type: `p95-frame-ms (${label})`, description: `${p95.toFixed(1)} (median ${p50.toFixed(1)}) over ${r.frames.length} frames, ${r.long.length} long tasks (500+ nodes)` });
      // "Senza scatti": no main-thread task over 50 ms, and no frame hitches beyond the window's own pace (an off-screen
      // test window may draw at 30 Hz, so the bound is relative to the median frame).
      expect(r.long, `long tasks while ${label} with 500+ nodes`).toHaveLength(0);
      expect(p95, `p95 frame time ${p95.toFixed(1)} ms (median ${p50.toFixed(1)}) while ${label}`).toBeLessThanOrEqual(Math.max(FRAME_P95_MS, 2 * p50));
    };

    // 4a. Panning and zooming a settled network.
    await measure('panning and zooming', async () => {
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await window.mouse.down();
      for (let i = 0; i < 120; i++) await window.mouse.move(box.x + box.width / 2 + 150 * Math.sin(i / 10), box.y + box.height / 2 + 100 * Math.cos(i / 10));
      await window.mouse.up();
      for (let i = 0; i < 12; i++) await window.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
    });

    // 4b. Expanding a node (more nodes and edges arrive) and the simulation ticks that settle them.
    const sizeBefore = await count();
    await measure('expanding a node and settling', async () => {
      await net.focus();
      for (let k = 0; k < 9; k++) await window.keyboard.press(']');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(2500);
    });
    console.log(`NET-EXPAND nodes ${sizeBefore} -> ${await count()}`);

    // 4c. Dragging a node (the layout warms up around it). A node is found by hovering: its tooltip shows.
    await window.getByTestId('net-fit').click();
    await window.waitForTimeout(1500);
    let grab: { x: number; y: number } | null = null;
    for (let row = 1; row < 9 && !grab; row++) {
      for (let col = 1; col < 13 && !grab; col++) {
        const x = box.x + (box.width * col) / 13;
        const y = box.y + (box.height * row) / 9;
        await window.mouse.move(x, y);
        await window.waitForTimeout(25);
        if ((await window.getByTestId('net-tooltip').count()) > 0) grab = { x, y };
      }
    }
    expect(grab, 'a node under the pointer to drag').not.toBeNull();
    await measure('dragging a node', async () => {
      await window.mouse.move(grab!.x, grab!.y);
      await window.mouse.down();
      for (let i = 0; i < 90; i++) await window.mouse.move(grab!.x + 120 * Math.sin(i / 8), grab!.y + 80 * Math.cos(i / 8));
      await window.mouse.up();
      await window.waitForTimeout(1500);
    });
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
    // Authors start as co-author groups (a lone author sits in "Other authors"): open the group that holds the author.
    type Level = { nodes: Array<{ id: string; label: string; hasChildren: boolean }> };
    const top = await ipcData<Level>(window, 'explore:level', { dimension: 'author', parentId: null });
    if (!top.nodes.some((n) => n.label === 'Test Author A')) {
      let groupLabel: string | null = null;
      for (const g of top.nodes.filter((n) => n.hasChildren)) {
        const kids = await ipcData<Level>(window, 'explore:level', { dimension: 'author', parentId: g.id });
        if (kids.nodes.some((n) => n.label === 'Test Author A')) {
          groupLabel = g.label;
          break;
        }
      }
      expect(groupLabel, 'group holding the author').not.toBeNull();
      await window.getByTestId('explore-node').filter({ hasText: groupLabel! }).first().click();
      await window.getByTestId('explore-zoom').click();
    }
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
