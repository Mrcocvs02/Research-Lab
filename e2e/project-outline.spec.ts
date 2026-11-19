import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipc, ipcData, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * Wave 10, X7 (written, not run in the wave: D-443). The Schema tab of a project: research outline, claims and evidence, "Solo prove",
 * the report (disabled without an outline), and citation suggestions with their own consent (D-423), against the mock provider.
 */
const CHANNELS = ['project:schema', 'project:saveOutline', 'project:saveClaim', 'project:addEvidence', 'project:reportPreview', 'project:reportRun', 'project:consent', 'project:citePreview', 'project:citeRun'];
const MOCK = { RL_AI_PROVIDER: 'mock' };

async function open(testInfo: Parameters<typeof skipUnlessChannels>[1]): Promise<{ ctx: LaunchedApp; window: Page; projectId: string; docId: string }> {
  const ctx = await launchApp({ library: 'full', dialogPath: true, offline: true, env: MOCK });
  const { window } = ctx;
  await createLibraryViaWizard(window, { name: 'Outline library' });
  await skipUnlessChannels(window, testInfo, CHANNELS);
  await waitForScan(window, ctx.library!.manifest!.files.length);
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  const docId = idOf(asArray(await ipcData(window, 'documents:list', { limit: 5 }))[0]!)!;
  const created = await ipcData<{ project: { id: string } }>(window, 'projects:create', { name: 'Thesis', docIds: [docId] });
  return { ctx, window, projectId: created.project.id, docId };
}

test('the Schema tab appears with the outline: claims, evidence, "Solo prove", at most four tabs', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, projectId, docId } = o;
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-open').first().click();
    await expect(window.locator('[role="tab"]')).toHaveCount(3);
    // The way in is the empty state of the Notes tab.
    await window.getByTestId('project-tab-notes').click();
    await window.getByTestId('notes-write-outline').click();
    await expect(window.getByTestId('project-schema')).toBeVisible();
    await window.getByTestId('schema-input-idea').fill('Does X work with little data?');
    await window.getByTestId('schema-input-questions').fill('Is X accurate with fewer than 100 samples?\nWhy does it fail?');
    await window.getByTestId('schema-save').click();
    await expect(window.getByTestId('schema-question')).toHaveCount(2);
    await expect(window.locator('[role="tab"]')).toHaveCount(4);
    await expect(window.getByTestId('schema-no-claims').first()).toBeVisible();

    // A piece of evidence from a highlight (the reader's "Use as evidence" calls the same channel).
    const schema = await ipcData<{ outline: { questions: Array<{ id: string }> } }>(window, 'project:schema', { projectId });
    const q1 = schema.outline.questions[0]!.id;
    await ipcData(window, 'project:addEvidence', { projectId, newClaim: { text: 'Below 100 samples the error grows', questionId: q1 }, evidence: { docId, page: 1, stance: 'supports', excerpt: 'error grows' } });
    await ipcData(window, 'project:saveClaim', { projectId, claim: { text: 'No evidence yet', questionId: q1, evidence: [] } });
    await window.getByTestId('project-tab-members').click();
    await window.getByTestId('project-tab-schema').click();
    await expect(window.getByTestId('schema-claim')).toHaveCount(2);
    await window.getByTestId('schema-only-evidence').check();
    await expect(window.getByTestId('schema-claim')).toHaveCount(1);
    await expect(window.getByTestId('schema-evidence')).toHaveAttribute('data-stance', 'supports');
  } finally {
    await ctx?.close();
  }
});

test('the report needs the outline, and shows the exact text before anything is sent', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, projectId } = o;
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-open').first().click();
    await window.getByTestId('project-more').click();
    await expect(window.getByTestId('project-report')).toBeDisabled();
    await expect(window.getByTestId('project-report')).toHaveAttribute('title', /outline/i);
    await window.keyboard.press('Escape');

    expect((await ipc(window, 'project:reportRun', { projectId, confirmed: true })).error?.code).toBe('INVALID_REQUEST');
    await ipcData(window, 'project:saveOutline', { projectId, outline: { idea: 'Idea', questions: [], hypotheses: [], plan: '' } });
    const p = await ipcData<{ ready: boolean; text: string }>(window, 'project:reportPreview', { projectId });
    expect(p.ready).toBe(true);
    expect(p.text).toContain('Idea');
    // Without the confirmation of the dialog nothing goes.
    expect((await ipc(window, 'project:reportRun', { projectId })).error?.code).toBe('CONFLICT');
  } finally {
    await ctx?.close();
  }
});

test('citation suggestions need the consent of the project, then the confirmation of the exact text (D-423)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const o = await open(testInfo);
    ctx = o.ctx;
    const { window, projectId } = o;
    const text = 'Quantum circuits with few gates are hard to learn from small samples of data.';
    const before = await ipcData<{ consent: boolean }>(window, 'project:citePreview', { projectId, text });
    expect(before.consent).toBe(false);
    expect((await ipc(window, 'project:citeRun', { projectId, text, confirmed: true })).error?.code).toBe('CONFLICT');
    await ipcData(window, 'project:consent', { projectId, granted: true });
    expect((await ipcData<{ consent: boolean }>(window, 'project:citePreview', { projectId, text })).consent).toBe(true);
    expect((await ipc(window, 'project:citeRun', { projectId, text })).error?.code).toBe('CONFLICT');
    await ipcData(window, 'project:consent', { projectId, granted: false });
    expect((await ipc(window, 'project:citeRun', { projectId, text, confirmed: true })).error?.code).toBe('CONFLICT');
  } finally {
    await ctx?.close();
  }
});
