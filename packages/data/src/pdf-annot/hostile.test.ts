import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDir, tempDir } from '../test-utils.js';
import { deflateSync } from 'node:zlib';
import { bufSyncSource, loadDoc } from './doc.js';
import { listExternal } from './external.js';
import { FOREIGN, PAGE_WITH_ANNOTS, docPdf, rng } from './gen.js';
import { inspectFile } from './inspect.js';
import { planSync, type PlanAnnot, type SyncResult } from './plan.js';
import { appendRevision } from './test-pdfs.js';
import { verifyFile } from './verify.js';

/**
 * Hostile input (§8.3.12, §8.3.13): the parser reads bytes it cannot trust. 500 deterministic mutations of synthetic files (truncation,
 * changed and inserted bytes, shuffled chunks, a /Prev that loops, numbers made huge): never an exception that escapes, never a
 * result that would write over bytes of the original, and always within the time limit.
 */
let dir: string;
beforeAll(async () => {
  dir = await tempDir('rl-hostile-');
  await mkdir(dir, { recursive: true });
});
afterAll(() => removeDir(dir));

const annot: PlanAnnot = { id: 'a1', kind: 'highlight', page: 1, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.05 }], color: 'yellow', createdAt: '2026-02-01T00:00:00.000Z' };
const withForeign = appendRevision(docPdf({ pages: 2 }), [[3, PAGE_WITH_ANNOTS('[10 0 R]')], [10, FOREIGN(0)]]);
const SEEDS: Buffer[] = [docPdf(), docPdf({ pages: 3 }), docPdf({ kind: 'stream', predictor: true, pages: 2 }), docPdf({ kind: 'hybrid', pages: 2 }), docPdf({ tree: 'nested', pages: 3 }), withForeign];

function mutate(buf: Buffer, r: () => number): Buffer {
  const out = Buffer.from(buf);
  const at = () => Math.floor(r() * out.length);
  const kind = Math.floor(r() * 7);
  if (kind === 0) return out.subarray(0, Math.floor(r() * out.length)); // truncation
  if (kind === 1) {
    for (let i = 0, n = 1 + Math.floor(r() * 8); i < n; i++) out[at()] = Math.floor(r() * 256); // changed bytes
    return out;
  }
  if (kind === 2) {
    const p = at();
    return Buffer.concat([out.subarray(0, p), Buffer.from(Array.from({ length: 1 + Math.floor(r() * 40) }, () => Math.floor(r() * 256))), out.subarray(p)]); // inserted bytes
  }
  if (kind === 3) {
    const a = at(), b = Math.min(out.length, a + 1 + Math.floor(r() * 200)), p = at();
    return Buffer.concat([out.subarray(0, p), out.subarray(a, b), out.subarray(p)]); // a chunk duplicated elsewhere
  }
  if (kind === 4) {
    // digits made huge or negative (offsets, counts, sizes)
    const text = out.toString('latin1');
    const digits = [...text.matchAll(/\d+/g)];
    const m = digits[Math.floor(r() * digits.length)];
    if (!m) return out;
    const big = ['99999999999', '-1', '4294967296', '0'][Math.floor(r() * 4)]!;
    return Buffer.from(text.slice(0, m.index) + big + text.slice((m.index ?? 0) + m[0].length), 'latin1');
  }
  if (kind === 5) return Buffer.from(out.toString('latin1').replace(/\/Root \d+ 0 R/, (m) => `${m} /Prev ${Number(/startxref\s+(\d+)/.exec(out.toString('latin1'))?.[1] ?? 0)}`), 'latin1'); // a /Prev that loops
  const p = at();
  return Buffer.concat([out.subarray(0, p), Buffer.from('<< /Annots [ '.repeat(1 + Math.floor(r() * 80))), out.subarray(p)]); // unbalanced nesting
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('hostile files: 500 deterministic mutations (§8.3.13)', () => {
  it('never throws, never writes over the original, always answers in time', async () => {
    const r = rng(20260218);
    const stats = { ok: 0, refused: 0, written: 0 };
    for (let i = 0; i < 500; i++) {
      const seed = SEEDS[i % SEEDS.length]!;
      const buf = mutate(seed, r);
      const p = path.join(dir, `m${i}.pdf`);
      await writeFile(p, buf);
      const t0 = Date.now();
      let res: SyncResult;
      try {
        res = await planSync({ path: p, mode: 'sync', annotations: [annot], otherIds: [], known: {}, now: annot.createdAt });
      } catch (e) {
        throw new Error(`mutation ${i} threw: ${String(e)}`);
      }
      expect(Date.now() - t0, `mutation ${i} took too long`).toBeLessThan(10_000);
      if (res.ok) {
        stats.ok++;
        if (res.update) {
          stats.written++;
          // the result is bytes to append at the original size, nothing else
          expect(res.update.oldSize, `mutation ${i}`).toBe(buf.length);
          const out = Buffer.concat([buf, res.update.bytes]);
          expect(out.subarray(0, buf.length).equals(buf)).toBe(true);
          // and whatever the plan accepted must verify, or be refused by the verification: never an exception
          const q = path.join(dir, `m${i}-out.pdf`);
          await writeFile(q, out);
          await expect(verifyFile({ path: q, oldSize: buf.length, oldHash: sha(buf), expect: res.expect, pages: res.pages })).resolves.toBeDefined();
        }
      } else stats.refused++;
      // the read-only inspection of the same file never throws either
      await expect(inspectFile(p, Math.floor(buf.length / 2))).resolves.toBeDefined();
    }
    expect(stats.ok + stats.refused).toBe(500);
    expect(stats.refused).toBeGreaterThan(50); // the mutations do break files
    expect(stats.written).toBeGreaterThan(0); // and some stay valid
  }, 120_000);

  it('a self-referencing /Annots, a reference chain and a missing page do not loop or throw', async () => {
    const selfRef = appendRevision(docPdf(), [[3, PAGE_WITH_ANNOTS('3 0 R')]]);
    const chain = appendRevision(docPdf(), [[3, PAGE_WITH_ANNOTS('10 0 R')], [10, '11 0 R'], [11, '10 0 R']]);
    const missingPage = Buffer.from(docPdf({ pages: 2 }).toString('latin1').replace('/Kids [3 0 R 4 0 R]', '/Kids [3 0 R 8 0 R]'), 'latin1');
    for (const [i, buf] of [selfRef, chain, missingPage].entries()) {
      const p = path.join(dir, `h${i}.pdf`);
      await writeFile(p, buf);
      const res = await planSync({ path: p, mode: 'sync', annotations: [annot], otherIds: [], known: {}, now: annot.createdAt });
      expect(res.ok === false || res.update === null || res.update.oldSize === buf.length).toBe(true);
    }
  });
});

describe('xref bombs, non-finite geometry and imported highlights (I3, M5, I6)', () => {
  const run = async (buf: Buffer, over: Partial<PlanAnnot> = {}) => {
    const p = path.join(dir, `x${Math.random().toString(36).slice(2)}.pdf`);
    await writeFile(p, buf);
    return planSync({ path: p, mode: 'sync', annotations: [{ ...annot, ...over }], otherIds: [], known: {}, now: annot.createdAt });
  };

  it('an xref stream whose /Index claims millions of entries is refused quickly, and so is a table that does', async () => {
    const zeros = deflateSync(Buffer.alloc(8 * 1024 * 1024));
    const head = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n';
    const dict = `<< /Type /XRef /Size 5 /W [1 0 0] /Index [0 8388608] /Root 1 0 R /Filter /FlateDecode /Length ${zeros.length} >>`;
    const buf = Buffer.concat([Buffer.from(head + '4 0 obj\n' + dict + '\nstream\n', 'latin1'), zeros, Buffer.from(`\nendstream\nendobj\nstartxref\n${head.length}\n%%EOF\n`)]);
    const t0 = Date.now();
    expect(await run(buf)).toMatchObject({ ok: false, reason: 'damaged' });
    expect(Date.now() - t0).toBeLessThan(5000);
    const table = Buffer.from(head + 'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000009 00000 n \n3 99999999\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + head.length + '\n%%EOF\n', 'latin1');
    expect(await run(table)).toMatchObject({ ok: false, reason: 'damaged' });
  });

  it('a page box and quads at the limit of the double range give no NaN in the external list', () => {
    const huge = '1' + '0'.repeat(308);
    const quad = `[-${huge} ${huge} ${huge} ${huge} -${huge} -${huge} ${huge} -${huge}]`;
    const buf = docPdf({ pages: [{ mediaBox: `[-${huge} -${huge} ${huge} ${huge}]`, annots: '[20 0 R]' }], extraObjs: [{ n: 20, body: `<< /Type /Annot /Subtype /Highlight /Rect [0 0 1 1] /QuadPoints ${quad} /C [1 1 0] >>` }] });
    const { items } = listExternal(loadDoc(bufSyncSource(buf)));
    for (const it of items) for (const r of it.rects) expect(Object.values(r).every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(items)).not.toContain('null');
  });

  it('a highlight of another program that the app already imported is not written a second time; a different one is', async () => {
    const ext = '<< /Type /Annot /Subtype /Highlight /Rect [20 150 120 160] /QuadPoints [20 160 120 160 20 150 120 150] /C [1 0.92 0.23] /NM (other-1) >>';
    const buf = docPdf({ pages: [{ annots: '[20 0 R]' }], extraObjs: [{ n: 20, body: ext }] });
    expect(await run(buf)).toMatchObject({ ok: true, update: null });
    const res = await run(buf, { rects: [{ x: 0.1, y: 0.5, w: 0.5, h: 0.05 }] });
    expect(res.ok && res.update !== null).toBe(true);
  });
});
