import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, waitForScan } from './helpers/phase1';

/**
 * The reading state, isolated papers, saved views and export of the Map (D-525..D-528, section 20.5-20.7) on a synthetic library: nothing is
 * saved at first, a view is saved, changed and opened again (also with the window in another shape), "Unread only", "Next to read" and the
 * isolated papers, an SVG and a PNG written to a folder outside the library (the only place the app writes), and the SVG entry switched off with
 * the free layout. The originals stay untouched.
 */
const DOCS = 30;

async function resize(ctx: LaunchedApp, width: number, height: number): Promise<void> {
  await ctx.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height]);
}

/** A file with the given extension appears in `dir`: its name. */
async function fileWith(dir: string, ext: string): Promise<string> {
  let found = '';
  await expect
    .poll(async () => (found = (await readdir(dir)).find((n) => n.endsWith(`.${ext}`)) ?? ''), { timeout: 60_000 })
    .not.toBe('');
  return found;
}

async function openMore(window: Page, testId: string) {
  await window.getByTestId('map-more').click();
  return window.getByTestId(testId);
}

test('Map: reading, isolated papers, saved views and export', async () => {
  test.setTimeout(900_000);
  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'rl-map-views-'));
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: DOCS }, dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_EXPORT_DIALOG_PATH: exportDir } });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Map views library' });
    await waitForScan(window, DOCS);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 300_000 });
    await window.getByTestId('nav-map').click();
    await window.getByTestId('graph-build-empty').click();
    await expect(window.getByTestId('graph-status')).toHaveAttribute('data-state', 'ready', { timeout: 600_000 });
    await expect(window.getByTestId('map-blocks')).toBeVisible({ timeout: 60_000 });
    await resize(ctx, 1920, 1000);
    await expect(window.getByTestId('map-side')).toBeVisible({ timeout: 15_000 });
    await window.waitForTimeout(600);

    // 1. No saved view at first: the section says so and offers to save one.
    await window.getByTestId('map-views-toggle').click();
    await expect(window.getByTestId('map-views-empty')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('map-view-item')).toHaveCount(0);

    // 2. Save the view with a name, then change the filters.
    await window.getByTestId('map-view-save').click();
    await window.getByTestId('map-view-name').fill('First view');
    await window.getByTestId('map-view-save-go').click();
    await expect(window.getByTestId('map-view-item')).toHaveCount(1);
    await expect(window.getByTestId('map-view-item')).toContainText('First view');

    const unread = window.getByTestId('map-only-unread');
    const gaps = window.getByTestId('map-gaps');
    await unread.click();
    await expect(unread).toHaveAttribute('aria-checked', 'true');
    await gaps.click();
    await expect(gaps).toHaveAttribute('aria-checked', 'true');
    await expect(window.getByTestId('map-gaps-count')).toContainText(/\d/);

    // 3. Next to read: the paper opens in its panel and the side column says why.
    await window.getByTestId('map-next-read').click();
    await expect(window.getByTestId('net-detail')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('map-next-why')).not.toBeEmpty();

    // 4. Opening the saved view puts the filters back, also after the window changed shape (the saved camera no longer fits).
    await resize(ctx, 1600, 1000);
    await window.waitForTimeout(800);
    await window.getByTestId('map-view-item').click();
    await expect(unread).toHaveAttribute('aria-checked', 'false');
    await expect(gaps).toHaveAttribute('aria-checked', 'false');
    await expect(window.getByTestId('map-gaps-count')).toHaveCount(0);
    await expect(window.getByTestId('map-error')).toHaveCount(0);

    // 5. Export an SVG and a PNG to a folder outside the library; the file is never over an existing one.
    await (await openMore(window, 'map-export-svg')).click();
    await expect(window.getByTestId('map-export-dialog')).toBeVisible();
    await window.getByTestId('map-export-go').click();
    const svgName = await fileWith(exportDir, 'svg');
    const svg = await readFile(path.join(exportDir, svgName), 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    await expect(window.getByTestId('map-export-dialog')).toHaveCount(0);

    await (await openMore(window, 'map-export-png')).click();
    await window.getByTestId('map-export-go').click();
    const pngName = await fileWith(exportDir, 'png');
    const png = await readFile(path.join(exportDir, pngName));
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await expect(window.getByTestId('map-export-dialog')).toHaveCount(0);
    expect((await readdir(exportDir)).filter((n) => n.endsWith('.svg') || n.endsWith('.png'))).toHaveLength(2);

    // 6. With the free layout ("None") the SVG entry is off, with its reason; the PNG stays.
    const groupBy = window.getByTestId('map-group-by');
    if (!(await groupBy.isVisible())) await window.getByTestId('map-strip-controls').click();
    await groupBy.selectOption('none');
    await expect(window.getByTestId('map-blocks')).toHaveCount(0);
    await window.getByTestId('map-more').click();
    await expect(window.getByTestId('map-export-svg')).toBeDisabled();
    await expect(window.getByTestId('map-export-png')).toBeEnabled();
    await window.keyboard.press('Escape');

    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
    await rm(exportDir, { recursive: true, force: true });
  }
});
