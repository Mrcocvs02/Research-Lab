import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, idOf, ipcData, searchHits, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { clickRow } from './helpers/ui';

/**
 * Phase 5 criteria, with the network replaced by `RL_E2E_NET_FIXTURES` (OpenAlex answers built from the synthetic
 * library's own DOIs): for a sample paper the app lists which references are in the library and which are missing;
 * "read next" explains each recommendation with the library papers that cite it; a preprint's published version is
 * recognised and applied only after confirmation, and undo restores the preprint.
 */
const CHANNELS = ['citations:get', 'citations:refresh', 'recommend:readNext', 'watch:checkPublished', 'watch:applyPublished'];
const OA = 'https://api.openalex.org';
const LINK = 'id,doi,title,publication_year,authorships,primary_location';
const MISSING = { doi: '10.9999/rl-e2e.missing.900', title: 'Missing Foundations of Synthetic Testing' };
const PUBLISHED = { doi: '10.7777/rl-e2e.journal.303', venue: 'Journal of Synthetic Results' };

const work = (id: string, doi: string, title: string, extra: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/${id}`,
  doi: `https://doi.org/${doi}`,
  title,
  publication_year: 2024,
  authorships: [{ author: { display_name: 'Ada Example' } }],
  primary_location: { source: { display_name: 'Synthetic Venue' } },
  ...extra,
});

interface Doc { doi: string | null; revision: number; publication: { status: string } }

test('references in library and missing, explained read-next, published preprint applied after confirmation (phase 5)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rl-net-'));
  const fixtures = path.join(dir, 'net.json');
  await writeFile(fixtures, '{}');
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, env: { RL_E2E_NET_FIXTURES: fixtures } });
    const window = ctx.window;
    const papers = ctx.library!.manifest!.files.filter((f) => f.format === 'pdf' && f.title && f.doi);
    test.skip(papers.length < 3, 'needs three titled PDFs with a DOI');
    const [a, b, c] = papers as [(typeof papers)[0], (typeof papers)[0], (typeof papers)[0]];

    // OpenAlex as the fixture: A cites B (in the library) and two missing works; B cites one of them too.
    await writeFile(
      fixtures,
      JSON.stringify({
        [`${OA}/works/doi:${a.doi}`]: work('W101', a.doi!, a.title!, { referenced_works: ['https://openalex.org/W102', 'https://openalex.org/W900', 'https://openalex.org/W901'], cited_by_count: 0 }),
        [`${OA}/works/doi:${b.doi}`]: work('W102', b.doi!, b.title!, { referenced_works: ['https://openalex.org/W900'], cited_by_count: 1 }),
        [`${OA}/works?filter=openalex_id:W102|W900|W901&per-page=50&select=${LINK}`]: {
          results: [work('W102', b.doi!, b.title!), work('W900', MISSING.doi, MISSING.title), work('W901', '10.9999/rl-e2e.other.901', 'Another Missing Work')],
        },
        [`${OA}/works?filter=openalex_id:W900&per-page=50&select=${LINK}`]: { results: [work('W900', MISSING.doi, MISSING.title)] },
        // C as a preprint: found through its arXiv DOI, merged with the published version.
        [`${OA}/works/doi:10.48550/arxiv.${c.arxivId}`]: work('W103', PUBLISHED.doi, c.title!, {
          type: 'article',
          primary_location: { source: { display_name: PUBLISHED.venue, type: 'journal' } },
          biblio: { volume: '12', issue: '3', first_page: '45', last_page: '67' },
          publication_year: 2025,
        }),
        [`${OA}/works/doi:${PUBLISHED.doi}`]: work('W103', PUBLISHED.doi, c.title!, { type: 'article', primary_location: { source: { display_name: PUBLISHED.venue, type: 'journal' } }, biblio: { volume: '12', issue: '3', first_page: '45', last_page: '67' }, publication_year: 2025 }),
        // Any other list (cited-by pages, searches): empty.
        [`${OA}/works`]: { results: [], meta: { next_cursor: null } },
      }),
    );

    await createLibraryViaWizard(window, { name: 'Citations library' });
    await skipUnlessChannels(window, testInfo, CHANNELS);
    await waitForScan(window, ctx.library!.manifest!.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const idFor = async (title: string) => idOf((await searchHits(window, `"${title}"`))[0])!;
    const [idA, idB, idC] = [await idFor(a.title!), await idFor(b.title!), await idFor(c.title!)];

    // 1. A sample paper: references in the library and missing.
    await window.getByTestId('view-menu').click();
    await window.getByTestId('search-sort').selectOption('title');
    await clickRow(window, a.title!);
    if (!(await window.getByTestId('detail-pane').isVisible())) await window.getByTestId('detail-toggle').click();
    await expect(window.getByTestId('doc-panel')).toBeVisible();
    await window.getByTestId('citations-toggle').click();
    const panel = window.getByTestId('citations-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByTestId('citations-refresh').click();
    await expect(panel.getByTestId('citation-ref')).toHaveCount(3, { timeout: 60_000 });
    await expect(panel.locator('[data-testid="citation-ref"][data-in-library="true"]')).toHaveCount(1);
    await expect(panel.locator('[data-testid="citation-ref"][data-in-library="false"]')).toHaveCount(2);
    await expect(panel.getByTestId('citations-summary')).toContainText('1');
    const view = await ipcData<{ references: { matched: { docId: string } | null }[] }>(window, 'citations:get', { docId: idA });
    expect(view.references.find((r) => r.matched)?.matched?.docId).toBe(idB);

    // 2. Read next, explained by the citing papers.
    await ipcData(window, 'citations:refresh', { docId: idB });
    await window.getByTestId('nav-discover').click();
    await window.getByTestId('discover-tab-readnext').click();
    const item = window.getByTestId('readnext-item').filter({ hasText: MISSING.title });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(item.getByTestId('readnext-citing')).toHaveCount(2);

    // 3. The published version of a preprint, applied after confirmation, then undone.
    const before = await ipcData<Doc>(window, 'documents:get', { docId: idC });
    await ipcData(window, 'documents:update', { docId: idC, patch: { doi: null, venue: null }, expectedRevision: before.revision });
    await window.getByTestId('discover-tab-published').click();
    await window.getByTestId('published-check').click();
    const proposal = window.getByTestId('published-item').filter({ hasText: PUBLISHED.doi });
    await expect(proposal).toBeVisible({ timeout: 60_000 });
    let doc = await ipcData<Doc>(window, 'documents:get', { docId: idC });
    expect(doc.doi).toBeNull(); // nothing changes before the confirmation
    await proposal.getByTestId('published-confirm').click();
    await expect.poll(async () => (await ipcData<Doc>(window, 'documents:get', { docId: idC })).doi, { timeout: 30_000 }).toBe(PUBLISHED.doi);
    doc = await ipcData<Doc>(window, 'documents:get', { docId: idC });
    expect(doc.publication.status).toBe('published');
    await window.getByTestId('toast-action').click();
    await expect.poll(async () => (await ipcData<Doc>(window, 'documents:get', { docId: idC })).doi, { timeout: 30_000 }).toBeNull();

    // The originals were never touched.
    const diff = await ctx.library!.diff();
    expect([...diff.added, ...diff.removed, ...diff.modified, ...diff.touched]).toEqual([]);
  } finally {
    await ctx?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
