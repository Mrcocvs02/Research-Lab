import { expect, test } from '@playwright/test';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FixtureManifest } from '@rl/testkit';
import { DATA_DIR_NAME, launchApp, realLibrarySkipReason, type LaunchedApp, type LibrarySpec } from './helpers/launch';
import { PHASE1_CHANNELS, createLibraryViaWizard, skipUnlessChannels, waitForScanSettled } from './helpers/phase1';

/**
 * Rule 1 on the scan (PLAN section 7): a full scan changes nothing outside `.lab`, creates nothing outside it,
 * and `.lab/documents` ends up with one file per document.
 */
async function scanAndCheck(ctx: LaunchedApp, testInfo: Parameters<typeof skipUnlessChannels>[1]): Promise<{ documents: number; files: string[] }> {
  const { window } = ctx;
  await skipUnlessChannels(window, testInfo, PHASE1_CHANNELS);
  // A library with an old index makes the wizard offer its import: declined here, the scan is under test.
  const legacyStep = await access(path.join(ctx.library!.root, '.phd_index')).then(() => true, () => false);
  await createLibraryViaWizard(window, { name: 'Scan library', legacyStep });
  const documents = await waitForScanSettled(window);

  // Nothing added, removed, modified or even touched (mtime) outside the data folder.
  const diff = await ctx.library!.diff();
  expect(diff, 'files outside .lab changed').toMatchObject({ added: [], removed: [], modified: [], touched: [] });
  await ctx.verifyLibraryUntouched();

  // One record per document, named after the id, with no absolute path inside.
  const dir = path.join(ctx.library!.root, DATA_DIR_NAME, 'documents');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  expect(files.length, 'one file per document in .lab/documents').toBe(documents);
  expect((await readdir(dir)).filter((f) => f.endsWith('.tmp')), 'no temporary files left behind').toEqual([]);
  const root = ctx.library!.root;
  for (const f of files.slice(0, 400)) {
    const raw = await readFile(path.join(dir, f), 'utf8');
    const rec = JSON.parse(raw) as { id?: string; path?: string };
    expect(rec.id, f).toBe(f.replace(/\.json$/, ''));
    expect(rec.path, f).toBeTruthy();
    const variants = [root, root.split(path.sep).join('\\\\'), root.split(path.sep).join('/')];
    for (const needle of variants) expect(raw, `absolute path in ${f}`).not.toContain(needle);
  }
  return { documents, files };
}

test('full synthetic library: scan leaves every original untouched', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    const spec: LibrarySpec = 'full'; // accents, deep nesting, a path over 260 characters, hostile PDF, image-only PDF
    ctx = await launchApp({ library: spec, dialogPath: true });
    const manifest = ctx.library!.manifest as FixtureManifest;
    const { documents, files } = await scanAndCheck(ctx, testInfo);
    const pdfs = manifest.files.filter((f) => f.format === 'pdf').length;
    expect(documents, 'every PDF (scanned, hostile, long path included) becomes a document').toBeGreaterThanOrEqual(pdfs);

    // The records of the special files exist by path.
    const dir = path.join(ctx.library!.root, DATA_DIR_NAME, 'documents');
    const paths = new Set<string>();
    for (const f of files) paths.add((JSON.parse(await readFile(path.join(dir, f), 'utf8')) as { path: string }).path);
    for (const kind of ['scanned', 'hostile', 'accented', 'long-path', 'nested'] as const) {
      for (const e of manifest.byKind(kind)) expect(paths.has(e.relPath), `${kind}: ${e.relPath.slice(0, 60)}`).toBe(true);
    }
  } finally {
    await ctx?.close();
  }
});

test('copy of the real library (RL_FIXTURE_LIBRARY): scan leaves every original untouched', async ({}, testInfo) => {
  const skip = realLibrarySkipReason();
  test.skip(Boolean(skip), skip);
  test.setTimeout(1_800_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'real', dialogPath: true });
    const { documents } = await scanAndCheck(ctx, testInfo);
    expect(documents).toBeGreaterThan(0);
    console.info(`[scan] real library copy: ${documents} documents`);
  } finally {
    await ctx?.close();
  }
});
