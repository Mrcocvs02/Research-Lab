// Timing of one write on synthetic 1, 20 and 100 MB files (opt-in: RL_S2_BENCH=1; sizes via RL_S2_SIZES="1,20,100").
import { closeSync, copyFileSync, fsyncSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync, writeSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { fileSource, bufSource } from './doc';
import { libPdf } from './pdfs';
import { ser } from './objects';
import { buildUpdate } from './writer';

const run = process.env.RL_S2_BENCH === '1';
const dir = join(import.meta.dirname, '.scratch', 'bench');
const MB = 1024 * 1024;

/** A valid base PDF followed by one incremental revision that holds a big filler stream: reaches any size without a big buffer. */
async function growFile(path: string, mb: number, kind: 'table' | 'stream'): Promise<void> {
  const base = await libPdf({ pages: 20, objectStreams: kind === 'stream' });
  const c = classify(bufSource(base));
  if (!c.ok) throw new Error('base');
  const n = c.doc.size;
  const len = mb * MB - base.length - 600;
  const fd = openSync(path, 'w');
  writeSync(fd, base);
  const head = Buffer.from(`\n${n} 0 obj\n<< /Length ${len} >>\nstream\n`);
  writeSync(fd, head);
  const chunk = Buffer.alloc(4 * MB, 0x20);
  for (let left = len; left > 0; left -= chunk.length) writeSync(fd, chunk, 0, Math.min(left, chunk.length));
  const tailObj = Buffer.from('\nendstream\nendobj\n');
  writeSync(fd, tailObj);
  const off = base.length + head.length + len;
  const xr = off + tailObj.length - 0;
  const root = ser(c.doc.trailer.get('Root') ?? null);
  const objPos = base.length + 1;
  if (kind === 'table') {
    writeSync(fd, `xref\n${n} 1\n${String(objPos).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${n + 1} /Root ${root} /Prev ${c.doc.lastStartxref} >>\nstartxref\n${xr}\n%%EOF\n`);
  } else {
    const rows = Buffer.alloc(14);
    rows[0] = 1; rows.writeUInt32BE(objPos, 1); rows.writeUInt16BE(0, 5);
    rows[7] = 1; rows.writeUInt32BE(xr, 8); rows.writeUInt16BE(0, 12);
    writeSync(fd, Buffer.concat([Buffer.from(`${n + 1} 0 obj\n<< /Type /XRef /Size ${n + 2} /W [1 4 2] /Index [${n} 2] /Root ${root} /Prev ${c.doc.lastStartxref} /Length 14 >>\nstream\n`), rows, Buffer.from('\nendstream\nendobj\nstartxref\n' + xr + '\n%%EOF\n')]));
  }
  closeSync(fd);
}

function sha(path: string): string {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  const b = Buffer.alloc(4 * MB);
  for (let n; (n = readSync(fd, b, 0, b.length, null)) > 0;) h.update(b.subarray(0, n));
  closeSync(fd);
  return h.digest('hex');
}
const ms = (f: () => void): number => { const t = performance.now(); f(); return Math.round((performance.now() - t) * 10) / 10; };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

describe.skipIf(!run)('write time on synthetic files', () => {
  const sizes = (process.env.RL_S2_SIZES ?? '1,20,100').split(',').map(Number);
  it.each(sizes.flatMap((s) => (['table', 'stream'] as const).map((k) => [s, k] as const)))('%i MB, last xref %s', async (mb, kind) => {
    mkdirSync(dir, { recursive: true });
    const orig = join(dir, `o-${mb}-${kind}.pdf`);
    await growFile(orig, mb, kind);
    const size = statSync(orig).size;
    const t = { plan: [] as number[], sha: [] as number[], rename: [] as number[], append: [] as number[] };
    for (let i = 0; i < 3; i++) {
      let upd!: ReturnType<typeof buildUpdate>;
      t.plan.push(ms(() => {
        const src = fileSource(orig);
        const c = classify(src);
        if (!c.ok) throw new Error(`refused ${c.reason}/${c.detail}`);
        upd = buildUpdate(c.doc, { add: [{ nm: 'rl-b', subtype: 'Highlight', page: 3, rects: [[40, 300, 200, 320]], color: [1, 1, 0] }] });
        src.close();
      }));
      t.sha.push(ms(() => { sha(orig); }));
      // 'rename': copy next to the original, append, fsync, hash the result, replace the original (the copy is made again each loop).
      const tmp = join(dir, `.t-${mb}-${kind}.tmp`), target = join(dir, `r-${mb}-${kind}.pdf`);
      copyFileSync(orig, target);
      { const f = openSync(target, 'r+'); fsyncSync(f); closeSync(f); }
      t.rename.push(ms(() => {
        copyFileSync(target, tmp);
        const fd = openSync(tmp, 'r+');
        writeSync(fd, upd.bytes, 0, upd.bytes.length, size);
        fsyncSync(fd);
        closeSync(fd);
        renameSync(tmp, target);
      }));
      // 'append': append in place and fsync.
      const target2 = join(dir, `a-${mb}-${kind}.pdf`);
      copyFileSync(orig, target2);
      { const f = openSync(target2, 'r+'); fsyncSync(f); closeSync(f); } // settle the copy so only the append is timed
      t.append.push(ms(() => {
        const fd = openSync(target2, 'r+');
        writeSync(fd, upd.bytes, 0, upd.bytes.length, size);
        fsyncSync(fd);
        closeSync(fd);
      }));
      expect(statSync(target2).size).toBe(size + upd.bytes.length);
      if (i === 2) { const c2 = classify(fileSource(target2)); expect(c2.ok).toBe(true); }
      rmSync(target, { force: true }); rmSync(target2, { force: true });
    }
    const row = { mb, kind, bytes: size, planMs: median(t.plan), sha256Ms: median(t.sha), renameCommitMs: median(t.rename), appendCommitMs: median(t.append) };
    appendFileSync(join(import.meta.dirname, '.scratch', 'bench.jsonl'), JSON.stringify(row) + '\n');
    console.log('BENCH', JSON.stringify(row));
    rmSync(orig, { force: true });
    writeFileSync(join(dir, '.keep'), '');
  }, 300_000);
});
