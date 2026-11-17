import type { CitationFile, CitationLink } from '@rl/core';
import { fold } from './explore.js';

/** A stable key of a work: DOI, arXiv id, the source's own id, or (long enough) a title with its year. */
export function citationKey(l: Pick<CitationLink, 'doi' | 'arxivId' | 'externalId' | 'title' | 'year'>): string | null {
  const doi = l.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  if (doi) return `doi:${doi}`;
  const arxiv = l.arxivId?.trim().toLowerCase().replace(/v\d+$/, '');
  if (arxiv) return `arxiv:${arxiv}`;
  if (l.externalId?.trim()) return `id:${l.externalId.trim().toLowerCase()}`;
  const title = l.title ? fold(l.title).replace(/ /g, '') : '';
  return title.length >= 25 ? `t:${title.slice(0, 80)}:${l.year ?? ''}` : null;
}

/**
 * What a citation file says for the graph: keys of the works the document cites (`r:`) and of those citing it (`c:`),
 * so that two documents sharing a key share a citation, and the library documents it is linked to directly.
 */
export function citationSignals(file: CitationFile | null): { refs: string[]; cites: string[] } {
  if (!file) return { refs: [], cites: [] };
  const refs = new Set<string>();
  const cites = new Set<string>();
  for (const [list, prefix] of [[file.references, 'r:'], [file.citedBy, 'c:']] as const) {
    for (const l of list) {
      const key = citationKey(l);
      if (key) refs.add(prefix + key);
      if (l.matchedDocId) cites.add(l.matchedDocId);
    }
  }
  return { refs: [...refs], cites: [...cites] };
}
