import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@rl/core';
import { diffSnapshots, formatDiff, realFixtureSkipReason, snapshotTree, withRealFixtureCopy, type RealFixtureCopy } from '@rl/testkit';
import { createLegacyImporter, createScanner, createTextExtractor } from './index.js';
import { createLibraryStore } from './store.js';

/**
 * Scan versus import on two temporary COPIES of a real library (RL_FIXTURE_LIBRARY, never the original):
 * copy 1 gets the old index imported, copy 2 (without `.phd_index/`) is only scanned. Skipped without the variable.
 * Only numbers are printed: the library's names and titles never reach the log.
 */
const skip = realFixtureSkipReason();

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** 1 - normalised Levenshtein distance of the normalised strings. */
function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - (prev[y.length] as number) / Math.max(x.length, y.length);
}

describe.skipIf(skip !== undefined)('scan vs import on copies of a real library', () => {
  const copies: RealFixtureCopy[] = [];
  afterAll(async () => {
    for (const c of copies) await c.cleanup();
  });

  it('finds the same documents (ids, paths, sizes), their DOI/arXiv ids, and touches nothing outside .lab', async () => {
    const imp = (await withRealFixtureCopy()) as RealFixtureCopy;
    const scn = (await withRealFixtureCopy()) as RealFixtureCopy;
    copies.push(imp, scn);
    await rm(path.join(scn.root, '.phd_index'), { recursive: true, force: true });

    // Copy 1: import of the old index.
    const impStore = createLibraryStore({ rootPath: imp.root, deviceId: 'device-import' });
    await createLegacyImporter().run({ sourceDir: imp.root, libraryRoot: imp.root, dataDir: impStore.dataDir, deviceId: 'device-import' });
    const imported = await impStore.documents.list();
    const impConfig = await impStore.readConfig();

    // Copy 2: scan only. The scan settings are the ones the import derived from the old index's settings
    // (in the app they come from library.json; a fresh library would have the defaults).
    const scnStore = createLibraryStore({ rootPath: scn.root, deviceId: 'device-scan' });
    await scnStore.init();
    await scnStore.writeConfig({ ...(await scnStore.readConfig()), scan: impConfig.scan, excludedFolders: impConfig.excludedFolders });
    const config = await scnStore.readConfig();
    const before = await snapshotTree(scn.root, { exclude: ['.lab'] });
    let reads = 0;
    const scanner = createScanner({
      hashFile: async (file, signal) => {
        reads++;
        const { sha256File } = await import('@rl/core/node');
        return sha256File(file, signal);
      },
    });
    const t0 = Date.now();
    const result = await scanner.scan(scn.root, { config, store: scnStore, markInbox: false });
    const scanMs = Date.now() - t0;
    expect(result.errors).toEqual([]);
    expect(result.cancelled).toBe(false);
    const scanned = await scnStore.documents.list();

    // 1. ids, paths, sizes.
    const present = imported.filter((d) => !d.missing);
    const scanById = new Map(scanned.map((d) => [d.id, d] as const));
    const byPath = new Map(scanned.map((d) => [d.path, d] as const));
    const sameId = present.filter((d) => scanById.has(d.id));
    const samePath = present.filter((d) => scanById.get(d.id)?.path === d.path);
    const sameSize = present.filter((d) => scanById.get(d.id)?.size === d.size);
    const onlyScan = scanned.filter((d) => !imported.some((i) => i.id === d.id));
    const aliasMatches = present.filter((d) => JSON.stringify([...d.aliasPaths].sort()) === JSON.stringify([...(scanById.get(d.id)?.aliasPaths ?? [])].sort()));
    expect(sameId).toHaveLength(present.length);
    expect(samePath).toHaveLength(present.length);
    expect(sameSize).toHaveLength(present.length);
    expect(aliasMatches).toHaveLength(present.length);
    expect(onlyScan).toEqual([]);
    for (const d of present) expect(scanById.get(d.id)?.hash).toBe(d.hash);
    expect(byPath.size).toBe(scanned.length);

    // 2. Incremental: a second scan reads nothing.
    reads = 0;
    const again = await scanner.scan(scn.root, { config, store: scnStore });
    expect(reads).toBe(0);
    expect(again.unchanged).toBe(scanned.length + scanned.reduce((n, d) => n + d.aliasPaths.length, 0));
    expect(again.added.length + again.changed.length + again.moved.length + again.missing.length).toBe(0);

    // 3. Text extraction: DOI / arXiv of the import found again, titles compared.
    const extractor = createTextExtractor();
    let withDoi = 0;
    let doiInText = 0;
    let doiFound = 0;
    let doiExact = 0;
    let withArxiv = 0;
    let arxivInText = 0;
    let arxivFound = 0;
    let arxivExact = 0;
    let pdfs = 0;
    let noText = 0;
    let failed = 0;
    const sims: number[] = [];
    let titleOnlyMissing = 0;
    for (const d of present) {
      if (!d.path.toLowerCase().endsWith('.pdf')) continue;
      pdfs++;
      let r;
      try {
        r = await extractor.extract(scn.root, d.path, { hash: undefined });
      } catch {
        failed++;
        continue;
      }
      if (!r.hasText) noText++;
      const text = r.pages.map((p) => p.text).join('\n').toLowerCase();
      if (d.doi) {
        withDoi++;
        const want = d.doi.toLowerCase();
        if (text.includes(want)) {
          doiInText++;
          if (r.meta.doiCandidates?.some((c) => c.toLowerCase() === want)) doiFound++;
        }
        if (r.meta.doi?.toLowerCase() === want) doiExact++;
      }
      if (d.arxivId) {
        withArxiv++;
        const want = d.arxivId.toLowerCase().replace(/v\d+$/, '');
        if (text.includes(want)) {
          arxivInText++;
          if (r.meta.arxivCandidates?.some((c) => c.toLowerCase() === want)) arxivFound++;
        }
        if (r.meta.arxivId?.toLowerCase() === want) arxivExact++;
      }
      if (d.title) {
        if (r.meta.title) sims.push(similarity(d.title, r.meta.title));
        else titleOnlyMissing++;
      }
    }
    const mean = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
    const pct = (n: number, of: number) => (of === 0 ? 'n/a' : `${Math.round((100 * n) / of)}%`);
    const summary = {
      importedDocs: imported.length,
      importedMissing: imported.length - present.length,
      scannedDocs: scanned.length,
      added: result.added.length,
      duplicates: result.duplicates.length,
      sameId: pct(sameId.length, present.length),
      samePath: pct(samePath.length, present.length),
      sameSize: pct(sameSize.length, present.length),
      scanMs,
      pdfs,
      pdfWithoutText: noText,
      extractionFailures: failed,
      doi: { inImport: withDoi, inText: doiInText, foundAmongCandidates: doiFound, exactMainDoi: doiExact },
      arxiv: { inImport: withArxiv, inText: arxivInText, foundAmongCandidates: arxivFound, exactMainId: arxivExact },
      titles: { compared: sims.length, noTitleExtracted: titleOnlyMissing, meanSimilarity: Number(mean.toFixed(3)), atLeast0_9: pct(sims.filter((s) => s >= 0.9).length, sims.length), atLeast0_7: pct(sims.filter((s) => s >= 0.7).length, sims.length), exact: pct(sims.filter((s) => s === 1).length, sims.length) },
    };
    console.log('REAL-SCAN-VS-IMPORT', JSON.stringify(summary));

    // The requirement: every identifier of the import that is in the PDF text is found again.
    expect(doiFound).toBe(doiInText);
    expect(arxivFound).toBe(arxivInText);
    expect(failed).toBe(0);

    // 4. Nothing outside .lab changed on the scanned copy (nor on the imported one).
    const after = await snapshotTree(scn.root, { exclude: ['.lab'] });
    const diff = diffSnapshots(before, after);
    expect(diff.clean, formatDiff(diff)).toBe(true);
    expect(diff.touched).toEqual([]);

    const sanity: DocumentRecord[] = scanned.filter((d) => d.id !== d.hash.slice(0, 16));
    expect(sanity.length).toBeLessThanOrEqual(0);
  }, 300_000);
});
