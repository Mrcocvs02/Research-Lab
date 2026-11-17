import type { AiField, DocumentRecord, LibraryStore, TaxonomyFile } from '@rl/core';
import { readCachedText } from '@rl/data';
import { citationSignals, type GraphDoc } from '@rl/graph';
import { makeTaxonomyLookup, type TaxonomyLookup } from '../library/indexable.js';

/** Pages of the text cache read per document, and the characters kept of them. */
export const GRAPH_PAGES = 3;
export const GRAPH_TEXT_CHARS = 12_000;

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
}

/** Documents of a library for the graph: the present ones, with their citations and, when asked, cached text. */
export async function loadGraphDocs(store: Pick<LibraryStore, 'documents' | 'citations' | 'readTaxonomy'>, options: LoadOptions = {}): Promise<GraphDoc[]> {
  const [records, tax, files] = await Promise.all([store.documents.list(), store.readTaxonomy().catch((): TaxonomyFile | null => null), store.citations.list().catch(() => [])]);
  const lookup = makeTaxonomyLookup(tax);
  const cit = new Map(files.map((f) => [f.docId as string, citationSignals(f)]));
  const present = records.filter((r) => !r.missing).sort((a, b) => (a.id < b.id ? -1 : 1));
  const out: GraphDoc[] = [];
  for (const rec of present) {
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const cached = options.cacheDir ? await readCachedText(options.cacheDir, rec.hash, GRAPH_PAGES) : undefined;
    out.push(
      toGraphDoc(rec, lookup, {
        abstract: cached?.meta.abstract,
        text: cached ? cached.pages.map((p) => p.text).join('\n').slice(0, GRAPH_TEXT_CHARS) : undefined,
        citations: cit.get(rec.id),
      }),
    );
    if (out.length % 50 === 0) options.onProgress?.(out.length, present.length);
  }
  options.onProgress?.(out.length, present.length);
  return out;
}
