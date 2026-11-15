import { createHash } from 'node:crypto';
import { cp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLegacyImporter } from './index.js';
import { createLibraryStore } from './store.js';
import { removeDir, tempDir } from './test-utils.js';

/**
 * Runs the importer on a COPY of a real library given by RL_FIXTURE_LIBRARY (never on the original).
 * Skipped when the variable is not set.
 */
const fixture = process.env['RL_FIXTURE_LIBRARY'];

async function hashTree(dir: string, skip: (rel: string) => boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      const rel = path.relative(dir, f).split(path.sep).join('/');
      if (skip(rel)) continue;
      if (e.isDirectory()) await walk(f);
      else out[rel] = createHash('sha256').update(await readFile(f)).digest('hex');
    }
  };
  await walk(dir);
  return out;
}

const isLab = (rel: string) => rel === '.lab' || rel.startsWith('.lab/');

describe.skipIf(!fixture)('legacy importer on a copy of a real library', () => {
  let tmp: string | undefined;
  afterAll(async () => {
    if (tmp) await removeDir(tmp);
  });

  it('imports every document with tags and the full taxonomy, leaving all files untouched', async () => {
    tmp = await tempDir('rl-real-');
    const copy = path.join(tmp, 'lib');
    await cp(fixture as string, copy, { recursive: true, filter: (src) => !isLab(path.relative(fixture as string, src).split(path.sep).join('/')) });

    const before = await hashTree(copy, isLab);
    const dataDir = path.join(copy, '.lab');
    const phases = new Set<string>();
    const report = await createLegacyImporter().run({
      sourceDir: copy,
      libraryRoot: copy,
      dataDir,
      deviceId: 'device-test',
      onProgress: (s) => phases.add(s.phase ?? ''),
    });
    const after = await hashTree(copy, isLab);
    expect(after).toEqual(before);
    expect([...phases]).toEqual(expect.arrayContaining(['reading', 'taxonomy', 'documents', 'finalizing']));

    const oldTax = JSON.parse(await readFile(path.join(copy, '.phd_index', 'taxonomy.json'), 'utf8')) as { extra: Record<string, unknown> };
    const oldRecords = (await readFile(path.join(copy, '.phd_index', 'files.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { p: string; tags: { doi?: string; arxiv?: string } });

    const store = createLibraryStore({ rootPath: copy, dataDir, deviceId: 'device-test' });
    const docs = await store.documents.list();
    const tax = await store.readTaxonomy();
    expect(store.issues()).toEqual([]);

    expect(docs).toHaveLength(21);
    expect(report.documents).toBe(21);
    expect(report.missing).toBe(0);
    for (const d of docs) {
      expect(d.title, d.path).toBeTruthy();
      expect(d.tags.length, d.path).toBeGreaterThan(0);
      expect(d.tags.every((t) => tax.nodes.some((n) => n.id === t))).toBe(true);
    }

    const count = (g: string) => tax.nodes.filter((n) => n.group === g).length;
    expect(count('macro')).toBe(11);
    expect(count('micro')).toBe(23);
    expect(tax.documentTypes).toHaveLength(14);
    expect(tax.venues).toHaveLength(16);
    const extras = tax.nodes.filter((n) => n.group?.startsWith('extra'));
    const merged = tax.nodes.reduce((n, x) => n + ((x.legacy?.['mergedExtra'] as unknown[] | undefined)?.length ?? 0), 0);
    const oldExtraCount = Object.keys(oldTax.extra).length;
    expect(extras.length + merged).toBeGreaterThanOrEqual(oldExtraCount);
    expect(merged).toBeLessThan(oldExtraCount);
    expect(tax.nodes.some((n) => n.parents.length > 1)).toBe(true);

    for (const r of oldRecords) {
      const d = docs.find((x) => x.path === r.p);
      expect(d, r.p).toBeDefined();
      expect(d?.doi ?? '').toBe(r.tags.doi ?? '');
      expect(d?.arxivId ?? '').toBe(r.tags.arxiv ?? '');
    }
    expect(docs.some((d) => d.doi) && docs.some((d) => d.arxivId)).toBe(true);

    // Every document has its content hash as id prefix (D-006).
    for (const d of docs) expect(d.id).toBe(d.hash.slice(0, 16));

    // Re-running changes nothing and creates no duplicates.
    const again = await createLegacyImporter().run({ sourceDir: copy, libraryRoot: copy, dataDir, deviceId: 'device-test' });
    expect(again.documents).toBe(0);
    expect(await store.documents.listIds()).toHaveLength(21);
    expect(await hashTree(copy, isLab)).toEqual(before);

    console.log('real import report', JSON.stringify({ ...report, warnings: report.warnings.length }));
  });
});
