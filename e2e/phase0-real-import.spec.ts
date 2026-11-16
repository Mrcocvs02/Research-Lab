import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, realLibrarySkipReason, type LaunchedApp } from './helpers/launch';

/**
 * Phase 0 acceptance on real data: the first-run wizard imports a pre-existing index from a
 * temporary copy of RL_FIXTURE_LIBRARY. Skipped when the variable is not set.
 */
test('first run imports a pre-existing index from a real library copy', async () => {
  const skip = realLibrarySkipReason();
  test.skip(Boolean(skip), skip);
  test.setTimeout(180_000);

  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'real', dialogPath: true });
    const { window } = ctx;
    const root = ctx.library!.root;
    const next = () => window.getByTestId('wizard-next').click();

    await expect(window.getByTestId('wizard')).toBeVisible();
    await window.getByTestId('wizard-ui-language').selectOption('en');
    await next();
    await next(); // profile: optional

    await window.getByTestId('wizard-choose-folder').click();
    await expect(window.getByTestId('wizard-folder-chosen')).toBeVisible();
    await next();

    await window.getByTestId('wizard-lib-name').fill('Imported library');
    await next();

    // Legacy step: shown only because the probe found a pre-existing index.
    await expect(window.getByTestId('legacy-preview')).toBeVisible();
    await window.getByTestId('wizard-import-legacy').check();
    await next();
    await next(); // taxonomy: comes from the import

    await window.getByTestId('wizard-ai-confirm').check();
    await next();
    await window.getByTestId('wizard-create').click();

    await expect(window.getByTestId('import-done')).toBeVisible({ timeout: 150_000 });

    // Expected count comes from the copied index itself, not from a number tied to one library.
    const indexLines = (await readFile(path.join(root, '.phd_index', 'files.jsonl'), 'utf8')).split('\n').filter((l) => l.trim());
    const docsDir = path.join(root, '.lab', 'documents');
    const docFiles = (await readdir(docsDir)).filter((f) => f.endsWith('.json'));
    expect(indexLines.length).toBeGreaterThan(0);
    type Rec = { path: string; title?: string; tags?: unknown[]; legacy?: unknown; inbox?: unknown };
    const docs: Rec[] = [];
    for (const f of docFiles) docs.push(JSON.parse(await readFile(path.join(docsDir, f), 'utf8')) as Rec);
    // Every index row becomes exactly one imported document, with title and tags.
    const imported = docs.filter((d) => d.legacy !== undefined);
    expect(imported).toHaveLength(indexLines.length);
    for (const d of imported) {
      expect(d.title, d.path).toBeTruthy();
      expect(d.tags?.length ?? 0, d.path).toBeGreaterThan(0);
    }
    // Files added to the library after the old index was written are found by the first scan and wait in the inbox.
    for (const d of docs.filter((x) => x.legacy === undefined)) expect(d.inbox, d.path).toBeTruthy();
    // Never two records for the same file.
    expect(new Set(docs.map((d) => d.path)).size).toBe(docs.length);
    const taxonomy = JSON.parse(await readFile(path.join(root, '.lab', 'taxonomy.json'), 'utf8')) as {
      nodes: unknown[] | Record<string, unknown>;
    };
    const nodeCount = Array.isArray(taxonomy.nodes) ? taxonomy.nodes.length : Object.keys(taxonomy.nodes).length;
    expect(nodeCount).toBeGreaterThanOrEqual(34); // 11 macro + 23 micro at least

    await ctx.verifyLibraryUntouched(); // throws when anything outside .lab changed
  } finally {
    await ctx?.close();
  }
});
