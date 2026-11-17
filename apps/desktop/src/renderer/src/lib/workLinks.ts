import { rl } from './rl';

/** What identifies a work online (all optional: remote metadata is untrusted and often partial). */
export interface WorkIds {
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  externalId?: string | null | undefined;
}

export type WorkLinkKind = 'doi' | 'arxiv' | 'openalex';
/** A work's identifier, never a URL: the main process checks its shape and builds the address (`citations:openExternal`). */
export interface WorkLink {
  kind: WorkLinkKind;
  id: string;
}

/**
 * The best identifier of a work to open it by: DOI first, then arXiv, then an OpenAlex id (`W123`); null when nothing
 * usable. Prefixes (`doi:`, a doi.org address, `arXiv:`) are dropped; the shape is checked by the main process.
 */
export function workLink(ids: WorkIds): WorkLink | null {
  const doi = ids.doi?.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, '');
  if (doi && doi.length <= 300) return { kind: 'doi', id: doi };
  const arxiv = ids.arxivId?.trim().replace(/^arxiv:/i, '');
  if (arxiv && arxiv.length <= 300) return { kind: 'arxiv', id: arxiv };
  const ext = ids.externalId?.trim();
  if (ext && /^W\d+$/.test(ext)) return { kind: 'openalex', id: ext };
  return null;
}

/** Opens a work's page in the system browser: the main process validates the identifier, builds the URL on doi.org, arxiv.org or openalex.org, and opens it. */
export function openWork(link: WorkLink): Promise<unknown> {
  return rl.invoke('citations:openExternal', { kind: link.kind, id: link.id });
}

/** "A. One, B. Two, C. Three" (at most three names); `more` formats the "et al." suffix. */
export function shortAuthors(authors: readonly string[], more: (names: string) => string): string {
  const names = authors.filter((a) => a.trim() !== '');
  if (names.length <= 3) return names.join(', ');
  return more(names.slice(0, 3).join(', '));
}
