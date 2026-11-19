import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { LaunchedApp } from './helpers/launch';
import { ipcData } from './helpers/phase1';
import { openSyntheticLibrary } from './helpers/ui';

/**
 * Import from DOI, arXiv or URL (feature 23) and resources beyond PDFs (feature 48), through the interface, on a synthetic
 * library. The online record comes from the `RL_E2E_METADATA` fixture (no network); no PDF is downloaded.
 *
 * 1. "+ Add > From DOI, arXiv or URL…": one DOI that is known, one that is not, a `file:` address and a private address. The
 *    known one is added as a data-only entry ("No file"), the others are refused with their reason, nothing is added to the
 *    library folder, and the list of documents is unchanged. A DOI pasted in the search box offers the same action.
 * 2. "+ Add > Resource or link…": a web address is refused when it is not http or https; a code link is added (the kind is
 *    guessed from the address), a folder of the library too; both show in the Library with the Resources facet; removing
 *    one only removes the entry.
 *
 * Run it alone, after `npm run build` (it launches the built app).
 */
const DOI = '10.5555/rl-e2e.res1';
const RECORD = { title: 'Synthetic Data-Only Entry', authors: ['Ada Example'], year: 2024, venue: 'Journal of Synthetic Tests', doi: DOI, arxivId: null, abstract: null, publication: 'published' };

test('add from a DOI without a file, then resources: a link and a folder', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  const work = await mkdtemp(path.join(os.tmpdir(), 'rl-res-e2e-'));
  try {
    const metadataFile = path.join(work, 'metadata.json');
    await writeFile(metadataFile, JSON.stringify({ [`doi:${DOI}`]: RECORD }));
    const opened = await openSyntheticLibrary(testInfo, 'papers', { RL_E2E_METADATA: metadataFile });
    ctx = opened.ctx;
    const { window, total } = opened;
    const lib = ctx.library!;

    // 1. From a DOI.
    await window.getByTestId('add-menu').click();
    await window.getByTestId('add-menu-id').click();
    await expect(window.getByTestId('id-dialog')).toBeVisible();
    await window.getByTestId('id-text').fill([DOI, '10.5555/rl-e2e.unknown', 'file:///etc/hosts', 'http://127.0.0.1/doi/10.5555/abc'].join('\n'));
    await window.getByTestId('id-find').click();
    const results = window.getByTestId('id-result');
    await expect(results).toHaveCount(4);
    await expect(results.nth(0)).toHaveAttribute('data-state', 'recognized');
    await expect(results.nth(0)).toContainText(RECORD.title);
    await expect(results.nth(1)).toHaveAttribute('data-state', 'not-found');
    await expect(results.nth(2)).toHaveAttribute('data-state', 'invalid');
    await expect(results.nth(2)).toContainText('http and https');
    await expect(results.nth(3)).toHaveAttribute('data-state', 'invalid');
    await expect(results.nth(3)).toContainText('private network');
    // Only what was recognised can be added, and the PDF download is not offered for a DOI.
    await expect(window.getByTestId('id-pick')).toHaveCount(1);
    await expect(window.getByTestId('id-download')).toHaveCount(0);
    await window.getByTestId('id-add').click();
    await expect(window.getByTestId('id-result-summary')).toContainText('1 added');
    await window.getByTestId('id-close').click();

    // The entry is among the resources ("No file"); the documents and the library folder are as they were.
    await window.getByTestId('facet-resources').click();
    await expect(window.getByTestId('resources-pane')).toBeVisible();
    const entry = window.getByTestId('resource-row').filter({ hasText: RECORD.title });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('No file');
    expect((await ipcData<{ items: unknown[] }>(window, 'documents:list', { limit: 500 })).items).toHaveLength(total);
    // Adding the same DOI again says it is already there.
    await window.getByTestId('add-menu').click();
    await window.getByTestId('add-menu-id').click();
    await window.getByTestId('id-text').fill(DOI);
    await window.getByTestId('id-find').click();
    await expect(window.getByTestId('id-result')).toHaveAttribute('data-state', 'in-library');
    await expect(window.getByTestId('id-pick')).toHaveCount(0);
    await window.keyboard.press('Escape');

    // A DOI pasted in the search box offers the same action.
    await window.getByTestId('search-input').fill('10.5555/rl-e2e.pasted');
    await expect(window.getByTestId('search-add-id')).toBeVisible();
    await window.getByTestId('search-add-id').click();
    await expect(window.getByTestId('id-text')).toHaveValue('10.5555/rl-e2e.pasted');
    await window.keyboard.press('Escape');
    await window.getByTestId('facet-resources').click(); // back to the documents
    await expect(window.getByTestId('resources-pane')).toHaveCount(0);

    // 2. Resources.
    await window.getByTestId('add-menu').click();
    await window.getByTestId('add-menu-resource').click();
    await expect(window.getByTestId('resource-dialog')).toBeVisible();
    await window.getByTestId('resource-url').fill('file:///etc/passwd');
    await window.getByTestId('resource-submit').click();
    await expect(window.getByTestId('resource-error')).toContainText('http and https');
    await window.getByTestId('resource-url').fill('https://github.com/example-org/example-repo');
    await expect(window.getByTestId('resource-kind')).toHaveValue('code');
    await window.getByTestId('resource-title').fill('Code of method X');
    await window.getByTestId('resource-submit').click();
    await expect(window.getByTestId('resource-dialog')).toHaveCount(0);

    // A folder of the library (the dialog hook answers with the library folder; it is stored relative to it).
    await window.getByTestId('add-menu').click();
    await window.getByTestId('add-menu-resource').click();
    await window.getByTestId('resource-choose-folder').click();
    await expect(window.getByTestId('resource-picked')).toBeVisible();
    await window.getByTestId('resource-title').fill('Papers folder');
    await window.getByTestId('resource-submit').click();
    await expect(window.getByTestId('resource-dialog')).toHaveCount(0);

    await window.getByTestId('facet-resources').click();
    const code = window.getByTestId('resource-row').filter({ hasText: 'Code of method X' });
    await expect(code).toHaveAttribute('data-kind', 'code');
    await expect(code).toContainText('github.com');
    await expect(window.getByTestId('resource-row').filter({ hasText: 'Papers folder' })).toHaveAttribute('data-kind', 'folder');
    // The preview needs a click and says that it contacts the site (the menu entry is there, not run here).
    await code.getByTestId('resource-more').click();
    await expect(window.getByTestId('resource-preview')).toContainText('contacts the site');
    await window.keyboard.press('Escape');

    // Removing one removes only the entry.
    await code.getByTestId('resource-more').click();
    await window.getByTestId('resource-remove').click();
    await expect(window.getByTestId('resource-row').filter({ hasText: 'Code of method X' })).toHaveCount(0);
    await expect(window.getByTestId('resource-row').filter({ hasText: 'Papers folder' })).toHaveCount(1);

    // Nothing was added to or changed in the library folder.
    expect((await lib.diff()).clean).toBe(true);
  } finally {
    await ctx?.close();
    await rm(work, { recursive: true, force: true });
  }
});
