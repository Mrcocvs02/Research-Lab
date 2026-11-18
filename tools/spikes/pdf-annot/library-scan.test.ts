// Read-only survey of a real library (opt-in: RL_FIXTURE_LIBRARY=<folder>). Files are only opened with 'r'; the report holds
// aggregate counts and never a name, title or path. A planned update is built in memory and thrown away (nothing is written).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { classify } from './classify';
import { fileSource } from './doc';
import { PdfError } from './objects';
import { buildUpdate } from './writer';

const lib = process.env.RL_FIXTURE_LIBRARY;

function* pdfs(dir: string): Generator<string> {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* pdfs(p);
    else if (e.isFile() && /\.pdf$/i.test(e.name)) yield p;
  }
}
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

describe.skipIf(!lib)('read-only library survey (counts only)', () => {
  it('classifies every PDF', () => {
    const r = { files: 0, accepted: 0, refusedByReason: {} as Record<string, number>, damagedBy: {} as Record<string, number>, encryptedEmptyPassword: 0, encryptedOther: 0, permissionRefusals: 0,
      dataAfterEof: 0, lastXref: {} as Record<string, number>, hybrid: 0, multiRevision: 0, planFailed: {} as Record<string, number>, planned: 0, tooLarge: 0, ioError: 0, maxMs: 0, totalMs: 0 };
    for (const p of pdfs(lib!)) {
      r.files++;
      let src;
      try { src = fileSource(p); } catch { r.ioError++; continue; }
      try {
        if (src.size > 512 * 1024 * 1024) { r.tooLarge++; continue; }
        const t = performance.now();
        const c = classify(src);
        const dt = performance.now() - t;
        r.totalMs += dt; r.maxMs = Math.max(r.maxMs, dt);
        if ((c.ok ? c.trailingBytes : c.trailingBytes ?? 0) > 0) r.dataAfterEof++;
        if (c.ok) {
          r.accepted++;
          inc(r.lastXref, c.kind);
          if (c.hybrid) r.hybrid++;
          if (c.revisions > 1) r.multiRevision++;
          try { buildUpdate(c.doc, { add: [{ nm: 'rl-s2', subtype: 'Highlight', page: 0, rects: [[10, 10, 50, 20]], color: [1, 1, 0] }] }); r.planned++; } catch (e) { inc(r.planFailed, e instanceof PdfError ? e.code : 'internal'); }
        } else {
          inc(r.refusedByReason, c.reason);
          if (c.reason === 'damaged' || c.reason === 'unsupported') inc(r.damagedBy, `${c.reason}:${c.detail}`);
          if (c.emptyPassword) r.encryptedEmptyPassword++;
          else if (c.reason === 'encrypted') r.encryptedOther++;
          if (c.reason === 'permission') r.permissionRefusals++;
        }
      } catch { inc(r.damagedBy, 'exception'); } finally { src.close(); }
    }
    console.log('LIBRARY-SURVEY ' + JSON.stringify(r));
  }, 600_000);
});
