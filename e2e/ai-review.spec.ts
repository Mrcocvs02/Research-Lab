import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { enableAiWholeLibrary, waitClaudeReady } from './helpers/settings';
import { openActivity, rows } from './helpers/ui';

/**
 * Phase 4 (wave 4.2) criterion, with the mock provider (`RL_AI_PROVIDER=mock`, no network): the whole library is
 * enabled for the AI from the root entry of the folder tree; a bulk job on the selection shows its estimate, asks for
 * a confirmation and proposes tags and descriptions; the review accepts part of the tags (they become the user's
 * tags), undo brings the proposal back, a description is rejected, and the statistics count what was accepted.
 */
const CHANNELS = ['jobs:estimate', 'jobs:start', 'review:list', 'review:decide', 'review:stats', 'taxonomy:apply'];
const MOCK = { RL_AI_PROVIDER: 'mock' };

interface TaxView { revision: number; nodes: { id: string; label: string }[] }
interface Stats { tags: { proposed: number; accepted: number; rate: number | null } }
interface Doc { tags: string[]; ai: { suggestedTags?: { review: { status: string } } } }

test('bulk AI job with estimate and confirmation, review with partial accept, undo and reject (phase 4)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: MOCK });
    const window = ctx.window;
    await createLibraryViaWizard(window, { name: 'Review library' });
    await skipUnlessChannels(window, testInfo, CHANNELS);
    const total = ctx.library!.manifest!.files.length;
    await waitForScan(window, total);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    // A small taxonomy: the mock proposes nodes whose label words appear in the excerpt (else the first one).
    const tax = await ipcData<TaxView>(window, 'taxonomy:get', {});
    await ipcData(window, 'taxonomy:apply', {
      expectedRevision: tax.revision,
      ops: [
        { op: 'create', label: 'Attention' },
        { op: 'create', label: 'Graphs' },
        { op: 'create', label: 'Optimization' },
        { op: 'create', label: 'Benchmarks' },
      ],
    });

    // 1. The whole library goes to the AI through the root entry of the tree.
    await waitClaudeReady(window);
    await enableAiWholeLibrary(window);

    // 2. Bulk job on the whole selection: estimate first, then confirmation.
    await window.getByTestId('nav-library').click();
    await rows(window).first().click();
    await window.getByTestId('search-results').press('Control+a');
    await expect(window.getByTestId('selection-count')).toHaveText(new RegExp(`${total} selected`));
    await window.getByTestId('bulk-ai-propose').click();
    const dialog = window.getByTestId('job-dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('job-field-tags')).toBeChecked();
    await expect(dialog.getByTestId('job-field-description')).toBeChecked();
    await expect(dialog.getByTestId('job-to-send')).toContainText(String(total), { timeout: 30_000 });
    await dialog.getByTestId('job-confirm').click();
    // The job's row lives in the Activity popover (D-358).
    await openActivity(window);
    const indicator = window.getByTestId('job-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'done', { timeout: 120_000 });

    // 3. The review: tags and descriptions are proposed.
    await indicator.getByTestId('job-review').click();
    await expect(window.getByTestId('review-view')).toBeVisible({ timeout: 30_000 });
    const tagItem = window.locator('[data-testid="review-item"][data-field="tags"]').first();
    await expect(tagItem).toBeVisible({ timeout: 30_000 });
    const docId = (await tagItem.getAttribute('data-doc-id'))!;
    const tagChips = tagItem.getByTestId('review-tag');
    const proposed = await tagChips.count();
    expect(proposed).toBeGreaterThan(0);
    // Keep all but the last one when there are several (partial acceptance).
    if (proposed > 1) await tagChips.last().click();
    await tagItem.getByTestId('review-accept').click();
    await expect(window.locator(`[data-testid="review-item"][data-field="tags"][data-doc-id="${docId}"]`)).toHaveCount(0, { timeout: 30_000 });
    let doc = await ipcData<Doc>(window, 'documents:get', { docId });
    expect(doc.tags.length).toBe(proposed > 1 ? proposed - 1 : 1);
    expect(doc.ai.suggestedTags?.review.status).toBe(proposed > 1 ? 'edited' : 'accepted');

    // 4. Undo brings the proposal back and removes the tags.
    await window.getByTestId('toast-action').click();
    await expect(window.locator(`[data-testid="review-item"][data-field="tags"][data-doc-id="${docId}"]`)).toHaveCount(1, { timeout: 30_000 });
    doc = await ipcData<Doc>(window, 'documents:get', { docId });
    expect(doc.tags).toEqual([]);
    expect(doc.ai.suggestedTags?.review.status).toBe('proposed');

    // 5. Accept it again (all tags), reject a description.
    await window.locator(`[data-testid="review-item"][data-field="tags"][data-doc-id="${docId}"]`).getByTestId('review-accept').click();
    await expect(window.locator(`[data-testid="review-item"][data-field="tags"][data-doc-id="${docId}"]`)).toHaveCount(0, { timeout: 30_000 });
    const descItem = window.locator('[data-testid="review-item"][data-field="description"]').first();
    await expect(descItem.getByTestId('review-ai-mark')).toBeVisible();
    await descItem.getByTestId('review-reject').click();

    // 6. The statistics count the reviewed tags.
    const stats = await ipcData<Stats>(window, 'review:stats', {});
    expect(stats.tags.accepted).toBeGreaterThan(0);
    expect(stats.tags.rate).not.toBeNull();
    await expect(window.getByTestId('review-rate')).toBeVisible();

    // The originals were never touched.
    const diff = await ctx.library!.diff();
    expect([...diff.added, ...diff.removed, ...diff.modified, ...diff.touched]).toEqual([]);
  } finally {
    await ctx?.close();
  }
});
