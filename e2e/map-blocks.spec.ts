import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, waitForScan } from './helpers/phase1';

/**
 * The Map of the works in blocks (D-498, D-499, section 19.2) on a synthetic library: Group by, one block per value, titles with
 * zero collisions (measured with the e2e-only probe `window.__rlMapProbe`, on at RL_E2E=1), the legend and the frame outside the canvas
 * (the strip under 1440 px, the side column from 1440 px), evidence edges only for the selected paper, Back, the neighbourhood of a
 * paper (double click) and the path between two papers.
 */
const DOCS = 40;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Probe {
  nodes: Array<{ id: string; x: number; y: number; block: string }>;
  labels: Array<Box & { id: string }>;
  names: Box[];
  edges: Array<{ a: string; b: string; e: number; kinds: string[] }>;
  frame: { canvas: Box | null; side: Box | null; strip: Box | null };
}

const probe = (window: Page): Promise<Probe> => window.evaluate(() => (window as unknown as { __rlMapProbe: () => unknown }).__rlMapProbe()) as Promise<Probe>;
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Pairs of drawn labels and block names that overlap (the same box twice does not count). */
function collisions(p: Probe): number {
  const all: Box[] = [...p.labels, ...p.names];
  let n = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i]!, all[j]!)) n++;
  return n;
}

/** The controls (Group by...) sit in the strip popover under 1440 px and in the side column above. */
async function control(window: Page, testId: string) {
  const c = window.getByTestId(testId);
  if (!(await c.isVisible())) await window.getByTestId('map-strip-controls').click();
  return c;
}

async function resize(ctx: LaunchedApp, width: number, height: number): Promise<void> {
  await ctx.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height]);
}

test('Map in blocks: group by, blocks, no label collisions, legend outside the canvas, Back, neighbourhood, path', async () => {
  test.setTimeout(600_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: DOCS }, dialogPath: true, offline: true, env: { RL_E2E: '1' } });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Map blocks library' });
    await waitForScan(window, DOCS);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 300_000 });

    // Build the model, then the Map opens in blocks.
    await window.getByTestId('nav-map').click();
    await window.getByTestId('graph-build-empty').click();
    await expect(window.getByTestId('graph-status')).toHaveAttribute('data-state', 'ready', { timeout: 600_000 });
    const blocks = window.getByTestId('map-blocks');
    await expect(blocks).toBeVisible({ timeout: 60_000 });
    await expect(window.getByTestId('map-canvas')).toHaveAttribute('data-points', String(DOCS));

    // 1. Group by: Automatic gives blocks, None the free layout, and back.
    const groupBy = await control(window, 'map-group-by');
    await groupBy.selectOption('none');
    await expect(blocks).toHaveCount(0);
    await expect(window.getByTestId('map-canvas')).toBeVisible();
    await (await control(window, 'map-group-by')).selectOption('auto');
    await expect(blocks).toBeVisible({ timeout: 60_000 });
    const nBlocks = Number(await blocks.getAttribute('data-blocks'));
    expect(nBlocks, 'blocks of the automatic grouping').toBeGreaterThanOrEqual(1);
    await window.keyboard.press('Escape');

    // 2. Titles of all the works, zero collisions, no edge until a paper is selected, the strip above the canvas at 1280 px.
    await expect.poll(async () => (await probe(window)).labels.length, { timeout: 30_000 }).toBeGreaterThan(0);
    let p = await probe(window);
    expect(p.nodes, 'one node per work').toHaveLength(DOCS);
    expect(collisions(p), 'colliding labels at 1280 px').toBe(0);
    expect(p.edges, 'no edge before a selection').toHaveLength(0);
    const cv = p.frame.canvas!;
    expect(cv.w).toBeGreaterThan(300);
    expect(p.frame.side, 'no side column under 1440 px').toBeNull();
    const strip = p.frame.strip!;
    expect(strip, 'the strip').not.toBeNull();
    expect(overlap(strip, cv), 'the strip does not cover the canvas').toBe(false);
    expect(strip.y + strip.h, 'the strip is above the canvas').toBeLessThanOrEqual(cv.y + 1);
    expect(await window.getByTestId('map-block').count(), 'a chip per block in the strip').toBe(nBlocks);

    // 3. Wide window: the side column beside the canvas, still zero collisions.
    await resize(ctx, 1920, 1000);
    await expect(window.getByTestId('map-side')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await probe(window)).frame.canvas!.w, { timeout: 15_000 }).toBeGreaterThan(1000);
    await window.waitForTimeout(600); // the blocks are laid out again 300 ms after the last resize
    p = await probe(window);
    expect(p.frame.side).not.toBeNull();
    expect(overlap(p.frame.side!, p.frame.canvas!), 'the side column does not cover the canvas').toBe(false);
    expect(p.frame.side!.x, 'the side column is beside the canvas').toBeGreaterThanOrEqual(p.frame.canvas!.x + p.frame.canvas!.w - 1);
    expect(p.frame.strip, 'no strip from 1440 px').toBeNull();
    expect(collisions(p), 'colliding labels at 1920 px').toBe(0);
    expect(await window.getByTestId('map-block').count(), 'an entry per block in the column').toBe(nBlocks);

    // 4. Select a paper: its detail opens beside the canvas and at most 5 evidence edges are drawn, all of its own.
    const at = async (id: string) => {
      const q = await probe(window);
      const n = q.nodes.find((x) => x.id === id)!;
      return { x: q.frame.canvas!.x + n.x, y: q.frame.canvas!.y + n.y };
    };
    const inView = (q: Probe) => q.nodes.filter((n) => n.x > 20 && n.y > 20 && n.x < q.frame.canvas!.w - 20 && n.y < q.frame.canvas!.h - 20);
    p = await probe(window);
    const first = inView(p)[0]!;
    const second = inView(p)[1]!;
    let pt = await at(first.id);
    await window.mouse.click(pt.x, pt.y);
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', first.id);
    p = await probe(window);
    expect(p.edges.length, 'edges of the selected paper').toBeLessThanOrEqual(5);
    for (const e of p.edges) expect([e.a, e.b]).toContain(first.id);
    expect(collisions(p), 'colliding labels with a selection').toBe(0);

    // 5. Back returns to the state before the selection.
    await expect(window.getByTestId('map-back')).toBeEnabled();
    await window.getByTestId('map-back').click();
    await expect(window.getByTestId('net-detail')).toHaveCount(0);
    await expect(window.getByTestId('map-forward')).toBeEnabled();
    await window.getByTestId('map-forward').click();
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', first.id);

    // 6. Path: "Path to..." on the selected paper, then a second paper on the Map.
    await window.getByTestId('net-detail-more').click();
    await window.getByTestId('path-start').click();
    await expect(window.getByTestId('net-tab-map')).toHaveAttribute('aria-selected', 'true');
    pt = await at(second.id);
    await window.mouse.click(pt.x, pt.y);
    await expect(window.getByTestId('net-tab-network')).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('path-strip')).toBeVisible();
    await expect(window.getByTestId('path-chain').or(window.getByTestId('path-none'))).toBeVisible();
    await window.getByTestId('path-close').click();

    // 7. Neighbourhood: a double click on a paper of the Map opens it, centred on that paper.
    await window.getByTestId('net-tab-map').click();
    await expect.poll(async () => inView(await probe(window)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    p = await probe(window);
    const third = inView(p)[2] ?? inView(p)[0]!;
    pt = await at(third.id);
    await window.mouse.dblclick(pt.x, pt.y);
    await expect(window.getByTestId('net-tab-network')).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('net-detail')).toHaveAttribute('data-doc-id', third.id);
    await expect(window.getByTestId('net-canvas')).toBeVisible();
    await expect.poll(async () => Number(await window.getByTestId('net-count').getAttribute('data-count')), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

    // Enter on a paper reached by the keyboard does the same.
    await window.getByTestId('net-tab-map').click();
    await window.getByTestId('map-canvas').focus();
    await window.keyboard.press(']');
    await window.keyboard.press('Enter');
    await expect(window.getByTestId('net-tab-network')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await ctx?.close();
  }
});
