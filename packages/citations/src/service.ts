import { AppError, SCHEMA_VERSION, type CitationFile, type CitationLink, type CitationService, type DocumentRecord } from '@rl/core';
import { buildOwnedIndex, matchLinks, titleKey, type OwnedIndex } from './match.js';
import { createNet, type NetOptions } from './net.js';
import { createArxiv, createOpenAlex, createSemanticScholar, type CitationSourceX, type LookupResult, type SourceRef } from './sources.js';

export interface RefreshOptions {
  /** What to fetch; the rest is kept from `previous`. Default: both. */
  what?: Array<'references' | 'citedBy'>;
  /** The file stored so far (its work id saves a lookup, its other half is kept). */
  previous?: CitationFile | null;
}

export interface CitationServiceX extends CitationService {
  refresh(doc: DocumentRecord, owned: DocumentRecord[] | OwnedIndex, signal?: AbortSignal, options?: RefreshOptions): Promise<CitationFile>;
}

/** OpenAlex (primary), Semantic Scholar (when OpenAlex does not know the work or fails), arXiv (metadata only). */
export function createCitationSources(o: NetOptions & { now?: () => Date }): CitationSourceX[] {
  const net = createNet(o);
  const now = o.now ?? (() => new Date());
  return [createOpenAlex(net, now), createSemanticScholar(net, now), createArxiv(net)];
}

/** Can anything be looked up for this document? A DOI, an arXiv id, or a title of some length. */
export const hasLookupKey = (d: Pick<DocumentRecord, 'doi' | 'arxivId' | 'title'>): boolean => Boolean(d.doi?.trim() || d.arxivId?.trim() || (d.title && titleKey(d.title).length >= 12));

export function refOf(doc: DocumentRecord, externalId?: string): SourceRef {
  return {
    ...(doc.doi ? { doi: doc.doi } : {}),
    ...(doc.arxivId ? { arxivId: doc.arxivId } : {}),
    ...(doc.title ? { title: doc.title } : {}),
    ...(doc.authors.length ? { authors: doc.authors } : {}),
    ...(doc.year ? { year: doc.year } : {}),
    ...(externalId ? { externalId } : {}),
  };
}

export function createCitationService(sources: CitationSourceX[], now: () => Date = () => new Date()): CitationServiceX {
  return {
    async refresh(doc, owned, signal, options = {}) {
      const what = options.what ?? ['references', 'citedBy'];
      const prev = options.previous ?? null;
      const ref = refOf(doc, prev?.externalId);
      const ix = Array.isArray(owned) ? buildOwnedIndex(owned) : owned;
      let failure: unknown = null;
      for (const source of sources) {
        let meta: LookupResult | null;
        try {
          meta = await source.lookup(ref, signal);
        } catch (e) {
          if (e instanceof AppError && e.code === 'CANCELLED') throw e;
          failure ??= e;
          continue;
        }
        if (!meta || (source.id === 'arxiv' && sources.length > 1)) continue;
        // Within the source that knows the work: one failing half fails the refresh (the stored file stays as it was).
        const at = now().toISOString();
        const sourceRef: SourceRef = { ...ref, ...(meta.externalId ? { externalId: meta.externalId } : {}) };
        const references = what.includes('references') ? await source.fetchReferences(sourceRef, signal) : (prev?.references ?? []);
        const citedBy = what.includes('citedBy') ? await source.fetchCitedBy(sourceRef, signal) : (prev?.citedBy ?? []);
        const count = what.includes('citedBy') ? (meta.citedByCount ?? (citedBy.length > 0 ? citedBy.length : undefined)) : prev?.citedByCount;
        const ext = meta.externalId ?? prev?.externalId;
        const file: CitationFile = {
          schemaVersion: SCHEMA_VERSION,
          docId: doc.id,
          ...(ext ? { externalId: ext } : {}),
          references: matchLinks(references, ix, doc.id),
          citedBy: matchLinks(citedBy, ix, doc.id),
          ...(count !== undefined ? { citedByCount: count } : {}),
          ...(what.includes('references') ? { referencesCheckedAt: at } : prev?.referencesCheckedAt ? { referencesCheckedAt: prev.referencesCheckedAt } : {}),
          ...(what.includes('citedBy') ? { citedByCheckedAt: at } : prev?.citedByCheckedAt ? { citedByCheckedAt: prev.citedByCheckedAt } : {}),
        };
        return file;
      }
      if (failure) throw failure;
      throw new AppError('NOT_FOUND', 'No online source knows this work');
    },
  };
}

export type { CitationLink };
