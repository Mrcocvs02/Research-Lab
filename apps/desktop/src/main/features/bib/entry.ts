/** One reference as read from BibTeX, CSL JSON, Zotero RDF or a Zotero database (shared by the readers). */
export interface BibEntry {
  /** The key the source gave it, when it did. */
  key: string | null;
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  /** Volume, issue and pages as one line. */
  venueRef: string | null;
  doi: string | null;
  arxivId: string | null;
  tags: string[];
  collections: string[];
  /** Plain-text notes. */
  notes: string[];
  /** File paths as the source wrote them (absolute, or relative to `base`). */
  files: string[];
}

export type BibSource = 'bibtex' | 'csl' | 'rdf' | 'zotero';
export interface BibRead {
  source: BibSource;
  entries: BibEntry[];
  /** Folder the relative file paths of the entries start from. */
  base: string;
  /** Items that could not be read, with a reason code. */
  skipped: Array<{ label: string; reason: string }>;
}

export const LIMITS = { entries: 20000, text: 4000, notes: 20000, list: 200 } as const;

export const blank = (): BibEntry => ({ key: null, title: null, authors: [], year: null, venue: null, venueRef: null, doi: null, arxivId: null, tags: [], collections: [], notes: [], files: [] });

export const clip = (s: string | null | undefined, max: number = LIMITS.text): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t.slice(0, max);
};

/** Like `clip`, but keeps the line breaks of a note (paragraphs from HTML notes). */
export const clipNote = (s: string | null | undefined, max: number = LIMITS.notes): string | null => {
  const t = (s ?? '').replace(/[^\S\n]+/g, ' ').replace(/ ?\n[ \n]*/g, '\n').trim();
  return t === '' ? null : t.slice(0, max);
};

export function normDoi(s: string | null | undefined): string | null {
  const m = /10\.\d{4,9}\/[^\s"<>]+/.exec(s ?? '');
  return m ? m[0].replace(/[.,;)]+$/, '').toLowerCase().slice(0, 300) : null;
}

export function normArxiv(s: string | null | undefined): string | null {
  const m = /(?:arxiv[:/ ]*)?((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(v\d+)?/i.exec(s ?? '');
  return m ? m[1]! : null;
}

export const yearOf = (s: string | null | undefined): number | null => {
  const m = /\b(1[0-9]{3}|2[0-9]{3})\b/.exec(s ?? '');
  return m ? Number(m[1]) : null;
};

export const cleanAuthors = (xs: string[]): string[] => xs.map((a) => clip(a, 300)).filter((a): a is string => a !== null).slice(0, LIMITS.list);

export const cleanList = (xs: string[]): string[] => [...new Set(xs.map((x) => clip(x, 200)).filter((x): x is string => x !== null))].slice(0, LIMITS.list);

/** Comparison form of a title: lower case, letters and digits only. */
export const titleKey = (s: string | null): string => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
