import { AppError, GRAPH_LIMITS, type AiField, type DocumentRecord, type LibraryStore, type TaxonomyFile } from '@rl/core';
import { readCachedText } from '@rl/data';
import { MAX_COUNTS_PER_DOC, TermDictionary, citationSignals, countTerms, packCounts, type GraphDoc } from '@rl/graph';
import { makeTaxonomyLookup, type TaxonomyLookup } from '../library/indexable.js';

/** Pages of the text cache read per document, and the characters kept of them. */
export const GRAPH_PAGES = 3;
export const GRAPH_TEXT_CHARS = 12_000;
/** Documents the graph is built for (above this the build says so instead of running out of memory). */
export const MAX_GRAPH_DOCS = GRAPH_LIMITS.buildDocuments;

const usable = <T>(f: AiField<T> | undefined): T | undefined => (f && f.review.status !== 'rejected' ? f.value : undefined);

export const folderOfPath = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));

/** Changes whenever the record is written or its file changes: what the model's staleness is measured by. */
export const docSig = (r: Pick<DocumentRecord, 'revision' | 'hash'>): string => `${r.revision}.${r.hash.slice(0, 8)}`;

export interface GraphTextSource {
  abstract?: string | undefined;
  text?: string | undefined;
  citations?: { refs: string[]; cites: string[] } | undefined;
}

/**
 * A record as the graph reads it: title, abstract (AI summary/description when not rejected, else the abstract found in
 * the file), AI keywords and synonyms (accepted or proposed, never rejected), tags with what they imply, the first pages.
 */
export function toGraphDoc(rec: DocumentRecord, tax: TaxonomyLookup, src: GraphTextSource = {}): GraphDoc {
  const ai = [usable(rec.ai.summary), usable(rec.ai.description)].filter(Boolean).join('\n');
  return {
    id: rec.id,
    sig: docSig(rec),
    folder: folderOfPath(rec.path),
    title: rec.title ?? '',
    abstract: ai || src.abstract || '',
    keywords: [...(usable(rec.ai.keywords) ?? []), ...(usable(rec.ai.synonyms) ?? [])],
    text: src.text ?? '',
    tags: tax.expandTags(rec.tags),
    refs: src.citations?.refs ?? [],
    cites: src.citations?.cites ?? [],
  };
}

export interface LoadOptions {
  /** Read the first pages from the text cache (never extracts); false: metadata only (cheap, for the on-the-fly view). */
  cacheDir?: string | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
  /** Filled in while loading: how many documents had their citation list cut to the per-document cap. */
  stats?: { trimmedCitations: number } | undefined;
}

/**
 * Documents of a library for the graph: the present ones, with their citations and, when asked, cached text. Words are
 * counted as each document is read and the text is dropped (see `GraphDoc.packed`), so memory grows with the number of
 * documents by a few KB each, not by their pages. More than `MAX_GRAPH_DOCS` documents is refused with a clear error.
 */
export async function loadGraphDocs(store: Pick<LibraryStore, 'documents' | 'citations' | 'readTaxonomy'>, options: LoadOptions = {}): Promise<GraphDoc[]> {
  const [records, tax, files] = await Promise.all([store.documents.list(), store.readTaxonomy().catch((): TaxonomyFile | null => null), store.citations.list().catch(() => [])]);
  const present = records.filter((r) => !r.missing).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (present.length > MAX_GRAPH_DOCS) throw new AppError('INVALID_REQUEST', 'The library has too many documents for the graph', { reason: 'too-large', limit: MAX_GRAPH_DOCS, documents: present.length });
  const lookup = makeTaxonomyLookup(tax);
  // Citation keys shared by many documents are one string in memory.
  const interned = new Map<string, string>();
  const intern = (k: string) => interned.get(k) ?? (interned.set(k, k), k);
  const cit = new Map<string, ReturnType<typeof citationSignals>>();
  for (const f of files) {
    const sig = citationSignals(f);
    if (sig.trimmed && options.stats) options.stats.trimmedCitations++;
    cit.set(f.docId as string, { ...sig, refs: sig.refs.map(intern) });
  }
  const dict = new TermDictionary();
  const out: GraphDoc[] = [];
  for (const rec of present) {
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const cached = options.cacheDir ? await readCachedText(options.cacheDir, rec.hash, GRAPH_PAGES) : undefined;
    const doc = toGraphDoc(rec, lookup, {
      abstract: cached?.meta.abstract,
      text: cached ? cached.pages.map((p) => p.text).join('\n').slice(0, GRAPH_TEXT_CHARS) : undefined,
      citations: cit.get(rec.id),
    });
    doc.packed = packCounts(countTerms(doc), dict, MAX_COUNTS_PER_DOC);
    doc.dict = dict;
    doc.title = doc.abstract = doc.text = '';
    doc.keywords = [];
    out.push(doc);
    if (out.length % 50 === 0) options.onProgress?.(out.length, present.length);
  }
  options.onProgress?.(out.length, present.length);
  return out;
}
