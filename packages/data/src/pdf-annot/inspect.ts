// Counts the annotations of other programmes in a file, and in its first `baseSize` bytes (the file as it was before our first
// write): the difference is what a byte-exact restore would drop (§8.3.8). Read only, in the worker.
import { PDF_WRITE_LIMITS as LIM } from '@rl/core';
import { Ref } from './objects.js';
import { fileSource, getPage, loadDoc, resolve, setDeadline, tick, type SyncSource } from './doc.js';
import { readAnnot } from './annot.js';
import { pageCountOf } from './plan.js';
import { unlock } from './refuse.js';
import type { ExternalItem } from './external.js';

export type InspectResult = { ok: true; external: number; externalAtBase: number | null; pages: number; items?: ExternalItem[]; truncated?: boolean } | { ok: false };

async function countExternal(src: SyncSource): Promise<{ n: number; pages: number }> {
  const doc = loadDoc(src);
  if (doc.trailer.has('Encrypt') && !(await unlock(doc)).ok) throw new Error('locked');
  const pages = Math.min(pageCountOf(doc), 5000);
  let n = 0;
  for (let i = 0; i < pages; i++) {
    tick();
    const arr = resolve(doc, getPage(doc, i)?.dict.get('Annots'));
    if (!Array.isArray(arr)) continue;
    for (const el of arr) if (!(el instanceof Ref && readAnnot(doc, el)?.nm?.startsWith('rl-'))) n++;
  }
  return { n, pages };
}

/** `list`: instead of counting, reads the highlights and underlines of other programs (§8.3.14). */
export async function inspectFile(path: string, baseSize?: number, list?: boolean): Promise<InspectResult> {
  const src = fileSource(path);
  setDeadline(LIM.workerTimeoutMs);
  try {
    if (list) {
      const doc = loadDoc(src);
      if (doc.trailer.has('Encrypt') && !(await unlock(doc)).ok) throw new Error('locked');
      // A chunk of its own: the writer chunk stays within its cap and the listing loads only when the user asks for it.
      const r = (await import('./external.js')).listExternal(doc);
      return { ok: true, external: r.items.length, externalAtBase: null, pages: 0, items: r.items, truncated: r.truncated };
    }
    const now = await countExternal(src);
    let externalAtBase: number | null = null;
    if (baseSize !== undefined && baseSize > 0 && baseSize < src.size) {
      try {
        externalAtBase = (await countExternal({ size: baseSize, read: (o, l) => src.read(o, Math.max(0, Math.min(l, baseSize - o))) })).n;
      } catch {
        externalAtBase = null;
      }
    }
    return { ok: true, external: now.n, externalAtBase, pages: now.pages };
  } catch {
    return { ok: false };
  } finally {
    src.close();
    setDeadline(0);
  }
}
