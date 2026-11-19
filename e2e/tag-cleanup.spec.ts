import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, waitForScan } from './helpers/phase1';

/**
 * The guided vocabulary cleanup (D-497, section 19.1.5) on a synthetic, deliberately messy taxonomy: near-duplicates that differ by
 * spelling, plural, acronym or regional spelling, a group of twin tags, and a tag that is really a journal. The sure proposals come
 * ticked; the six steps are walked through; "Undo all" brings the taxonomy and the tags of every document back to what they were.
 */

type Created = { created: Array<{ id: string }> };
interface Node {
  id: string;
  counts?: unknown;
  [k: string]: unknown;
}

/** Taxonomy nodes (without the live counts) and the direct tags, venue and type of every document: what "initial state" means. */
async function snapshot(window: Page, docIds: string[]): Promise<string> {
  const { nodes } = await ipcData<{ nodes: Node[] }>(window, 'taxonomy:get', {});
  const tax = nodes.map(({ counts: _c, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id));
  const docs: unknown[] = [];
  for (const docId of [...docIds].sort()) {
    const d = await ipcData<{ directTags?: string[]; tags: string[]; venue: string | null; type: string | null }>(window, 'documents:get', { docId });
    docs.push({ docId, tags: [...(d.directTags ?? d.tags)].sort(), venue: d.venue, type: d.type });
  }
  return JSON.stringify({ tax, docs });
}

test('guided tag cleanup: sure proposals ticked, six steps, undo all restores the initial state (D-497)', async () => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: { corpus: 12 }, dialogPath: true, offline: true });
    const { window } = ctx;
    await createLibraryViaWizard(window, { name: 'Tag cleanup library' });
    await waitForScan(window, 12);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const list = await ipcData<{ items: Array<{ docId: string }> }>(window, 'documents:list', { limit: 50 });
    const docIds = list.items.map((i) => i.docId);
    expect(docIds.length).toBeGreaterThanOrEqual(8);

    // The messy taxonomy: every pair below is a duplicate the detector must find (generic, invented names).
    const make = async (label: string, docs: number[]): Promise<string> => {
      const r = await ipcData<Created>(window, 'taxonomy:apply', { ops: [{ op: 'create', label }] });
      const id = r.created[0]!.id;
      if (docs.length > 0) await ipcData(window, 'documents:tag', { docIds: docs.map((i) => docIds[i]!), add: [id] });
      return id;
    };
    await make('alfa x', [0, 1, 2]);
    await make('Alfa-x', [3]); // spelling and separators (sure)
    await make('concetto beta', [0, 1]);
    await make('concetti beta', [2]); // plural (sure)
    await make('Gamma delta epsilon (GDE)', [4]);
    await make('GDE', [5]); // acronym in the name (sure)
    // Undoing a merge is refused when a later change touched a document that carries the surviving tag, so each step works on its own papers.
    await make('colour x', [8, 9]);
    await make('color x', [8, 9, 10]); // regional spelling (probable)
    for (const l of ['twin a', 'twin b', 'twin c', 'twin d']) await make(l, [6, 7]); // twins on the same papers
    await make('Journal of Tests', [11]); // a venue used as a tag (metadata)
    const initial = await snapshot(window, docIds);
    const before = JSON.parse(initial).tax.length as number;

    // Open the cleanup from the tag manager.
    await window.getByTestId('library-more').click();
    await window.getByRole('menuitem', { name: /Manage tags|Gestisci tag/ }).click();
    await expect(window.getByTestId('taxonomy-manager')).toBeVisible();
    await expect(window.getByTestId('tag-health')).toBeVisible();
    await window.getByTestId('tag-cleanup-open').click();
    await expect(window.getByTestId('tag-cleanup')).toBeVisible();

    // Step 1: the sure ones are already ticked; one click applies them as one change.
    await expect(window.getByTestId('tag-cleanup-step-1')).toHaveAttribute('aria-current', 'step');
    const rows1 = window.getByTestId('tag-cleanup-row');
    await expect(rows1.first()).toBeVisible();
    expect(await rows1.count(), 'sure duplicates found').toBeGreaterThanOrEqual(3);
    for (const row of await rows1.all()) await expect(row).toHaveAttribute('data-checked', 'true');
    await window.getByTestId('tag-cleanup-apply').click();
    await expect(window.getByTestId('tag-cleanup-step-2')).toHaveAttribute('aria-current', 'step');
    const afterSure = JSON.parse(await snapshot(window, docIds)).tax.length as number;
    expect(afterSure, 'the sure duplicates are merged').toBeLessThan(before);

    // Steps 2 to 5: apply what the defaults propose, or skip a step that has nothing ticked.
    for (const n of [2, 3, 4, 5]) {
      await expect(window.getByTestId(`tag-cleanup-step-${n}`)).toHaveAttribute('aria-current', 'step');
      await window.waitForTimeout(800); // the rows of the step load after the step opens
      const apply = window.getByTestId('tag-cleanup-apply');
      if (await apply.isEnabled()) await apply.click();
      else await window.getByTestId('tag-cleanup-skip').click();
    }

    // Step 6: the before/after table, then "Undo all".
    await expect(window.getByTestId('tag-cleanup-summary')).toBeVisible();
    expect(await snapshot(window, docIds), 'the cleanup changed something').not.toBe(initial);
    await window.getByTestId('tag-cleanup-undo-all').click();
    await expect.poll(() => snapshot(window, docIds), { timeout: 30_000 }).toBe(initial);
    await expect(window.getByTestId('tag-cleanup-undo-all')).toBeDisabled();
  } finally {
    await ctx?.close();
  }
});
