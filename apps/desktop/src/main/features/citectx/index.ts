import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createTextExtractor } from '@rl/data';
import { AppError, CITECTX_LIMITS, contentHashOf, documentIdSchema, itemIdSchema, type DocumentId } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import { citationView } from '../../citations/refresh.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { localPaths } from '../../library/library-runtime.js';
import { cacheHash } from '../ai/batch.js';
import { getRefs } from '../refs/index.js';
import { mentionSentences } from './parse.js';

/**
 * Context of the citations (feature 11, §17.4.18): for each paper of the library that cites this document, the sentences in
 * which it does, from its extracted text and its own bibliography (the entry that matches this document gives the number or the
 * author and year to look for). This machine only: no network, no Claude. Cached in the local cache by the set of citing
 * papers (rebuildable); "refresh" rebuilds. Loaded on demand.
 */
type Item = { docId: string; sentences: Array<{ page: number; text: string }> };
type Cached = { key: string; computedAt: string; items: Item[] };

export async function getCiteContext(s: MainServices, req: { docId: string; refresh?: boolean | undefined }): Promise<{ items: Item[]; computedAt: string | null }> {
  const rt = await s.runtime.require();
  const target = documentIdSchema.parse(req.docId) as DocumentId;
  if (!(await rt.store.documents.get(target))) throw new AppError('NOT_FOUND', 'Unknown document');
  const citing = [...new Set((await citationView(rt, target)).citedBy.flatMap((l) => (l.matched ? [l.matched.docId as string] : [])))].sort().slice(0, CITECTX_LIMITS.works);
  const recs = await Promise.all(citing.map((id) => rt.store.documents.get(id as DocumentId)));
  const key = cacheHash([citing, recs.map((r) => (r ? contentHashOf(r) : ''))]);
  const file = path.join(s.localDataDir, 'cache', 'citectx', itemIdSchema.parse(rt.libraryId), `${target}.json`);
  if (!req.refresh) {
    const hit = await readFile(file, 'utf8').then((x) => JSON.parse(x) as Cached, () => null);
    if (hit && hit.key === key && Array.isArray(hit.items)) return { items: hit.items, computedAt: hit.computedAt };
  }
  const root = (await s.libraries.profile(rt.libraryId)).rootPath;
  const extractor = createTextExtractor({ cacheDir: localPaths(s.localDataDir, rt.libraryId).textCacheDir });
  const items: Item[] = [];
  for (const [i, id] of citing.entries()) {
    const rec = recs[i];
    if (!rec || rec.missing) continue;
    try {
      // The entry of the citing paper's bibliography that is this document says how to find the mention.
      const entry = (await getRefs(s, { docId: id })).items.find((e) => e.docId === target);
      if (!entry) continue;
      const text = await extractor.extract(root, rec.path, { hash: contentHashOf(rec), ...(rec.pdfWrite ? { contentHash: contentHashOf(rec) } : {}) });
      const sentences = mentionSentences(text.pages, { n: entry.n, surname: entry.surname, year: entry.year });
      if (sentences.length > 0) items.push({ docId: id, sentences });
    } catch (e) {
      s.log.warn('citation context: a paper could not be read', { error: e });
    }
  }
  const computedAt = new Date().toISOString();
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteJson(file, { key, computedAt, items } satisfies Cached).catch((e: unknown) => s.log.warn('could not cache the citation context', { error: e }));
  return { items, computedAt };
}
