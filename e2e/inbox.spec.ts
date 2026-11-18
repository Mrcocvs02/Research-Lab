import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { writeSyntheticPdf } from '@rl/testkit';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, skipUnlessChannels, waitForScan } from './helpers/phase1';

/**
 * Phase 4 (wave 4.2) criterion: a PDF from outside the library arrives in the inbox (the same `inbox:add` call the
 * window's drop handler makes), the app reads its DOI, finds the metadata (from the `RL_E2E_METADATA` fixture instead
 * of the network), proposes name and folder, and on confirmation copies it into the library with the right metadata in
 * under a minute. The original file is not modified; the same file again is recognised as already in the library.
 */
const CHANNELS = ['inbox:list', 'inbox:add', 'inbox:confirm', 'inbox:dismiss'];
const DOI = '10.5555/rl-e2e.0001';
const RECORD = {
  title: 'Synthetic Arrivals for Testing Inboxes',
  authors: ['Ada Example', 'Bo Sample'],
  year: 2025,
  venue: 'Journal of Synthetic Tests',
  doi: DOI,
  arxivId: null,
  abstract: 'A synthetic abstract used only by the end-to-end test of the inbox.',
  publication: 'published',
};

const sha256 = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

interface AddResult { added: { id: string }[]; refused: { name: string; reason: string }[] }
interface Doc { title: string | null; authors: string[]; year: number | null; doi: string | null; path: string; inbox?: unknown }

test('a dropped PDF gets its metadata, a proposed name and folder, and is copied on confirmation (phase 4)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-inbox-src-'));
  try {
    const source = path.join(outside, 'download.pdf');
    await writeSyntheticPdf(source, { title: RECORD.title, authors: RECORD.authors, year: RECORD.year, body: 'Body text of a synthetic arrival.', doi: DOI });
    const before = await sha256(source);
    const metadataFile = path.join(outside, 'metadata.json');
    await writeFile(metadataFile, JSON.stringify({ [`doi:${DOI}`]: RECORD }));

    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: { RL_AI_PROVIDER: 'mock', RL_E2E_METADATA: metadataFile } });
    const window = ctx.window;
    await createLibraryViaWizard(window, { name: 'Inbox library' });
    await skipUnlessChannels(window, testInfo, CHANNELS);
    const total = ctx.library!.manifest!.files.length;
    await waitForScan(window, total);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    // 1. The file arrives (what the drop handler does with `rlBridge.pathForFile`).
    await window.getByTestId('nav-review').click();
    await expect(window.getByTestId('inbox-view')).toBeVisible({ timeout: 30_000 });
    const started = Date.now();
    const added = await ipcData<AddResult>(window, 'inbox:add', { paths: [source] });
    expect(added.refused).toEqual([]);
    expect(added.added).toHaveLength(1);
    const id = added.added[0]!.id;
    const card = window.locator(`[data-testid="inbox-item"][data-id="${id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('inbox-badge')).toContainText('1');

    // 2. DOI read from the file, metadata found, name proposed.
    await expect(card.getByTestId('inbox-detected')).toContainText(DOI, { timeout: 30_000 });
    await expect(card.getByTestId('inbox-lookup')).toHaveAttribute('data-state', 'found', { timeout: 30_000 });
    await expect(card.getByTestId('inbox-title')).toHaveValue(RECORD.title);
    await expect(card.getByTestId('inbox-year')).toHaveValue(String(RECORD.year));
    const name = await card.getByTestId('inbox-name').inputValue();
    expect(name).toMatch(/2025/);
    expect(name).toMatch(/\.pdf$/);
    await card.getByTestId('inbox-folder').selectOption('papers');

    // 3. Confirm: a new file in the library, with the metadata, under a minute.
    await card.getByTestId('inbox-confirm').click();
    await expect(card).toHaveCount(0, { timeout: 60_000 });
    expect(Date.now() - started).toBeLessThan(60_000);
    const copied = path.join(ctx.library!.root, 'papers', name);
    expect((await stat(copied)).isFile()).toBe(true);
    expect(await sha256(copied)).toBe(before);
    const doc = await ipcData<Doc>(window, 'documents:get', { docId: id });
    expect(doc.path).toBe(`papers/${name}`);
    expect(doc.title).toBe(RECORD.title);
    expect(doc.year).toBe(RECORD.year);
    expect(doc.doi?.toLowerCase()).toBe(DOI);
    expect(doc.inbox).toBeUndefined();

    // The original outside the library is untouched; the library gained exactly that file.
    expect(await sha256(source)).toBe(before);
    const diff = await ctx.library!.diff();
    expect(diff.added).toEqual([`papers/${name}`]);
    expect([...diff.removed, ...diff.modified]).toEqual([]);

    // 4. The same file again: recognised as already in the library, cannot be confirmed.
    const again = await ipcData<AddResult>(window, 'inbox:add', { paths: [source] });
    if (again.added.length === 1) {
      const dup = window.locator(`[data-testid="inbox-item"][data-id="${id}"]`);
      await expect(dup.getByTestId('inbox-duplicate')).toHaveAttribute('data-kind', 'same-file', { timeout: 30_000 });
      await expect(dup.getByTestId('inbox-confirm')).toBeDisabled();
      await dup.getByTestId('inbox-dismiss').click();
      await expect(dup).toHaveCount(0, { timeout: 30_000 });
    } else {
      expect(again.refused.map((r) => r.reason)).toContain('already-queued');
    }
  } finally {
    await ctx?.close();
    await rm(outside, { recursive: true, force: true });
  }
});
