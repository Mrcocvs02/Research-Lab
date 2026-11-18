import { createTextExtractor } from '@rl/data';
import { contentSections, splitSections } from '@rl/ai/analysis';
import { libraryCocitation, linkKeys, rankReferences } from '@rl/citations';
import { contentHashOf, type CitationFile, type CitationLink, type DocumentId } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { localPaths } from '../library/library-runtime.js';
import { readNote } from './note-store.js';

const PAGES = 600;
/** The reference lists of the library are read once per half minute, not once per document (a bulk refresh would read them all each time). */
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; lists: Array<{ docId: string; refs: CitationLink[] }> }>();

async function libraryLists(rt: LibraryRuntime) {
  const hit = cache.get(rt.libraryId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.lists;
  const files = await rt.store.citations.list().catch((): CitationFile[] => []);
  const lists = files.map((f) => ({ docId: f.docId as string, refs: f.references }));
  cache.set(rt.libraryId, { at: Date.now(), lists });
  return lists;
}

/**
 * Puts the references of a document in order of relevance to the work (D-446 g) and stores the 0-1 `relevance` of each. Local: the
 * text of the work (from the cache or the file), its literature note if any, and the reference lists of the other library documents.
 * The stored order is applied inside the store's queue, so a concurrent refresh is not undone. Best effort: nothing changes on failure.
 */
export async function rankCitationsFor(s: MainServices, rt: LibraryRuntime, docId: DocumentId): Promise<boolean> {
  const [file, rec] = await Promise.all([rt.store.citations.get(docId).catch(() => null), rt.store.documents.get(docId).catch(() => null)]);
  if (!file || !rec || file.references.length < 2) return false;
  let pages: Array<{ page: number; text: string }> = [];
  try {
    const root = (await s.libraries.profile(rt.libraryId)).rootPath;
    const x = createTextExtractor({ cacheDir: localPaths(s.localDataDir, rt.libraryId).textCacheDir });
    pages = (await x.extract(root, rec.path, { hash: contentHashOf(rec), maxPages: PAGES })).pages;
  } catch (e) {
    s.log.warn('no text for the citation ranking', { error: e });
  }
  const sections = contentSections(splitSections(pages)).map((x) => ({ title: x.title, text: x.text }));
  const noteText = (await readNote(rt.store.dataDir, docId)) ?? undefined;
  const others = (await libraryLists(rt)).filter((l) => l.docId !== docId).map((l) => l.refs);
  const ranked = rankReferences({ refs: file.references, sections, libraryCounts: libraryCocitation(others), noteText });
  const rank = new Map<string, { i: number; relevance: number }>();
  ranked.forEach((r, i) => {
    for (const k of linkKeys(r.link)) if (!rank.has(k)) rank.set(k, { i, relevance: r.relevance });
  });
  const at = (l: CitationLink) => linkKeys(l).map((k) => rank.get(k)).find((x) => x !== undefined);
  await rt.store.citations.update(docId, (cur) => {
    if (!cur) return file;
    const refs = cur.references.map((l, i) => ({ l, i, r: at(l) }));
    refs.sort((a, b) => (a.r?.i ?? Infinity) - (b.r?.i ?? Infinity) || a.i - b.i);
    return { ...cur, references: refs.map(({ l, r }) => (r ? { ...l, relevance: r.relevance } : l)) };
  });
  return true;
}
