import { rl } from './rl';

/** What identifies a work online (all optional: remote metadata is untrusted and often partial). */
export interface WorkIds {
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  externalId?: string | null | undefined;
}

export type WorkLinkKind = 'doi' | 'arxiv' | 'openalex';
export interface WorkLink {
  kind: WorkLinkKind;
  url: string;
}

const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');

/**
 * The page of a work on a host the app may open (doi.org, arxiv.org, openalex.org), built from its identifiers. The
 * identifier is always percent-encoded after the fixed host, so a hostile value cannot change where the link goes.
 * DOI first, then arXiv, then an OpenAlex id (`W123`); null when nothing usable.
 */
export function workLink(ids: WorkIds): WorkLink | null {
  const doi = ids.doi?.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, '');
  if (doi) return { kind: 'doi', url: `https://doi.org/${enc(doi)}` };
  const arxiv = ids.arxivId?.trim().replace(/^arxiv:/i, '');
  if (arxiv) return { kind: 'arxiv', url: `https://arxiv.org/abs/${enc(arxiv)}` };
  const ext = ids.externalId?.trim();
  if (ext && /^W\d+$/.test(ext)) return { kind: 'openalex', url: `https://openalex.org/${ext}` };
  return null;
}

/** Opens a link in the system browser through the main process (which checks the scheme again). */
export function openExternal(url: string): Promise<unknown> {
  return rl.invoke('reader:openLink', { url });
}

/** "A. One, B. Two, C. Three" (at most three names); `more` formats the "et al." suffix. */
export function shortAuthors(authors: readonly string[], more: (names: string) => string): string {
  const names = authors.filter((a) => a.trim() !== '');
  if (names.length <= 3) return names.join(', ');
  return more(names.slice(0, 3).join(', '));
}
