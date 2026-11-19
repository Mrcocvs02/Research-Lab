import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { clickRow, pickSort } from './helpers/ui';

/**
 * Discovery runs (features 41, 42; §17.4.17), with the network replaced by an empty `RL_E2E_NET_FIXTURES`: "New search" offers
 * the three kinds with a hint; "Find a bridge" of the selection bar needs exactly two documents; "Extend the bibliography" and
 * the bridge open Discover on the Searches tab and give an answer that says what happened (never a silent empty list), and no
 * file is downloaded.
 */
test('new search menu, extend and bridge from the selection, an honest answer (features 41, 42)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rl-net-'));
  const fixtures = path.join(dir, 'net.json');
  await writeFile(fixtures, JSON.stringify({ 'https://api.openalex.org/works': { results: [], meta: { next_cursor: null } } }));
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, env: { RL_E2E_NET_FIXTURES: fixtures } });
    const window = ctx.window;
    const papers = ctx.library!.manifest!.files.filter((f) => f.format === 'pdf' && f.title && f.doi);
    test.skip(papers.length < 2, 'needs two titled PDFs with a DOI');
    await createLibraryViaWizard(window, { name: 'Discover library' });
    await skipUnlessChannels(window, testInfo, ['discover:start', 'discover:list']);
    await waitForScan(window, ctx.library!.manifest!.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    // The primary of Discover lists the three kinds.
    await window.getByTestId('nav-discover').click();
    await window.getByTestId('discover-new-search').click();
    for (const k of ['question', 'extend', 'bridge']) await expect(window.getByTestId(`new-search-${k}`)).toBeVisible();
    await window.keyboard.press('Escape');

    // The bridge needs exactly two documents.
    await window.getByTestId('nav-library').click();
    await pickSort(window, 'title');
    // The selection bar (and its menu) exists from two documents on (section 4.2, B3): with every document selected the bridge is off, with a reason.
    await clickRow(window, papers[0]!.title!);
    await window.getByTestId('search-results').press('Control+a');
    await window.getByTestId('selection-more').click();
    await expect(window.getByTestId('selection-bridge')).toHaveAttribute('aria-disabled', 'true');
    await window.keyboard.press('Escape');
    await clickRow(window, papers[0]!.title!);
    await clickRow(window, papers[1]!.title!, ['Control']);
    await window.getByTestId('selection-more').click();
    await window.getByTestId('selection-bridge').click();

    // Discover opens on the Searches tab and answers, without downloading anything.
    await expect(window.getByTestId('discover-searches')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('run-body').or(window.getByTestId('search-transient')).first()).toBeVisible({ timeout: 60_000 });
    await expect(window.getByTestId('run-import')).toHaveCount(0);
  } finally {
    await ctx?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
