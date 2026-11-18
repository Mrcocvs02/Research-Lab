// Verification of a written file before it replaces the original (ARCHITETTURA-UI §8.3.3 step 6, §8.3.12: "the verification
// refuses every result that cannot be read back exactly"). Runs in the worker on the temporary file.
import { createHash } from 'node:crypto';
import { PDF_WRITE_LIMITS as LIM } from '@rl/core';
import { Ref } from './objects.js';
import { fileSource, getPage, loadDoc, resolve, setDeadline, tick } from './doc.js';
import { readAnnot, revOf } from './annot.js';
import type { PageExpect } from './plan.js';
import { loadPdfjs } from '../extract/pdf.js';

export interface VerifyRequest {
  path: string;
  /** Size and SHA-256 of the file as it was before the update: the new file must start with exactly these bytes. */
  oldSize: number;
  oldHash: string;
  expect: PageExpect[];
  /** Pages of the file (the new one must not lose any). */
  pages: number;
  /** With pdf.js (only at the first write of a file, and after a restore): the objects it must find on their page. */
  deep?: Array<{ page: number; objNum: number; gen: number; subtype: string }>;
}
export type VerifyResult = { ok: true; size: number; sha256: string } | { ok: false; detail: string };

/** SHA-256 of the first `oldSize` bytes and of the whole file, in one sequential read. */
function hashes(path: string, oldSize: number): { prefix: string; all: string; size: number } {
  const src = fileSource(path);
  try {
    const h = createHash('sha256');
    let prefix = '';
    for (let off = 0; off < src.size; ) {
      const end = off < oldSize ? oldSize : src.size;
      const b = src.read(off, Math.min(4 * 1024 * 1024, end - off));
      if (b.length === 0) break;
      h.update(b);
      off += b.length;
      if (off === oldSize) prefix = h.copy().digest('hex');
    }
    return { prefix, all: h.digest('hex'), size: src.size };
  } finally {
    src.close();
  }
}

/** The structural check: every touched page has exactly the expected references (the others untouched and in order) and our objects read back with the expected content. */
function structural(path: string, req: VerifyRequest): string | null {
  const src = fileSource(path);
  setDeadline(LIM.workerTimeoutMs);
  try {
    const doc = loadDoc(src);
    for (const e of req.expect) {
      tick();
      const page = getPage(doc, e.page);
      if (!page) return 'page-missing';
      const arr = resolve(doc, page.dict.get('Annots'));
      if (!Array.isArray(arr)) return 'annots-missing';
      const others: string[] = [];
      const ours = new Map<string, string>();
      for (const el of arr) {
        const f = el instanceof Ref ? readAnnot(doc, el) : null;
        if (f?.nm?.startsWith('rl-')) {
          if (ours.has(f.nm.slice(3))) return 'duplicate-nm';
          ours.set(f.nm.slice(3), revOf(f.sem));
        } else others.push(el instanceof Ref ? `${el.n} ${el.g}` : '?');
      }
      if (others.length !== e.others.length || others.some((k, i) => k !== e.others[i])) return 'others-changed';
      if (ours.size !== e.ours.length || e.ours.some((o) => ours.get(o.id) !== o.rev)) return 'ours-mismatch';
    }
    return null;
  } catch {
    return 'unreadable';
  } finally {
    src.close();
    setDeadline(0);
  }
}

/** pdf.js opens the file, finds the same number of pages and our annotations on their pages with the right subtype. */
async function deepCheck(path: string, req: VerifyRequest): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(path);
  if (data.length > LIM.maxInflatedBytes) return null; // too large for a full read: the structural check stands
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useWorkerFetch: false, verbosity: 0 });
  try {
    const doc = (await task.promise) as unknown as { numPages: number; getPage(n: number): Promise<{ getAnnotations(): Promise<Array<{ id: string; subtype: string }>> }> };
    if (doc.numPages !== req.pages) return 'pages-changed';
    const byPage = new Map<number, Array<{ id: string; subtype: string }>>();
    for (const d of req.deep ?? []) {
      let list = byPage.get(d.page);
      if (!list) byPage.set(d.page, (list = await (await doc.getPage(d.page + 1)).getAnnotations()));
      if (!list.some((a) => a.id === `${d.objNum}R${d.gen ? d.gen : ''}` && a.subtype === d.subtype)) return 'pdfjs-missing';
    }
    return null;
  } catch {
    return 'pdfjs-open';
  } finally {
    await task.destroy().catch(() => {});
  }
}

export async function verifyFile(req: VerifyRequest): Promise<VerifyResult> {
  try {
    const h = hashes(req.path, req.oldSize);
    if (h.size <= req.oldSize) return { ok: false, detail: 'not-grown' };
    if (h.prefix !== req.oldHash) return { ok: false, detail: 'prefix-changed' };
    const bad = structural(req.path, req) ?? (req.deep ? await deepCheck(req.path, req) : null);
    return bad ? { ok: false, detail: bad } : { ok: true, size: h.size, sha256: h.all };
  } catch {
    return { ok: false, detail: 'error' };
  }
}
