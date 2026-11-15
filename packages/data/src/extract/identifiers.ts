/** DOI and arXiv identifiers found in free text. Pure functions; the text is only ever matched, never interpreted. */

export interface ArxivMatch {
  /** Without the version: `2401.01120` or `hep-th/9901001`. */
  id: string;
  version?: number;
}

export interface DoiMatch {
  doi: string;
  /** Preceded by a `doi` label or a doi.org URL: much more likely to be the document's own. */
  labelled: boolean;
}

const MAX_DOI = 200;

/** Removes the punctuation a sentence or a reference list glues to the end of a DOI. */
export function cleanDoi(raw: string): string {
  let s = raw.replace(/[­​]/g, '');
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:!?'"’”…]+$/u, '');
    // Closing brackets only when they have no opening partner inside the DOI.
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
      ['<', '>'],
    ] as const) {
      while (s.endsWith(close) && s.split(open).length < s.split(close).length) s = s.slice(0, -1);
    }
    if (s === before) break;
  }
  return s;
}

const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/gi; // whitespace class also covers NBSP and the unicode line separators

/** Every DOI in `text`, in order, cleaned of trailing punctuation. */
export function findDois(text: string): DoiMatch[] {
  const out: DoiMatch[] = [];
  for (const m of text.matchAll(DOI_RE)) {
    const start = m.index ?? 0;
    if (start > 0 && /[A-Za-z0-9]/.test(text.charAt(start - 1))) continue; // part of a longer token
    const doi = cleanDoi(m[0]);
    if (!/^10\.\d{4,9}\/\S+$/.test(doi) || doi.length > MAX_DOI) continue;
    const before = text.slice(Math.max(0, start - 24), start).toLowerCase();
    out.push({ doi, labelled: /doi\s*[:=]?\s*(?:https?:\/\/(?:dx\.)?doi\.org\/)?$|doi\.org\/$/.test(before) });
  }
  return out;
}

const NEW_ID = String.raw`\d{4}\.\d{4,5}`;
const OLD_ID = String.raw`[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z]{2})?\/\d{7}`;
const ARXIV_RE = new RegExp(
  String.raw`(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/)(${NEW_ID}|${OLD_ID})(?:v(\d+))?(?![\d])`,
  'gi',
);

/** Every arXiv id with an explicit `arXiv:` label or an arxiv.org URL (bare numbers are too ambiguous). */
export function findArxivIds(text: string): ArxivMatch[] {
  const out: ArxivMatch[] = [];
  for (const m of text.matchAll(ARXIV_RE)) {
    const id = m[1] as string;
    const version = m[2] ? Number(m[2]) : undefined;
    out.push({ id: /^\d/.test(id) ? id : id.replace(/^[A-Za-z-]+/, (c) => c.toLowerCase()), ...(version !== undefined ? { version } : {}) });
  }
  return out;
}

/** Year implied by an arXiv id (`2401.xxxxx` -> 2024, `hep-th/9901001` -> 1999). */
export function arxivYear(id: string): number | undefined {
  const m = /^(\d{2})\d{2}\.\d{4,5}$/.exec(id) ?? /\/(\d{2})\d{5}$/.exec(id);
  if (!m) return undefined;
  const yy = Number(m[1]);
  if (!/^\d/.test(id)) return yy >= 91 ? 1900 + yy : 2000 + yy;
  return yy >= 7 ? 2000 + yy : undefined;
}

export function uniqueInOrder<T>(xs: Iterable<T>, key: (x: T) => string = (x) => String(x), cap = 20): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of xs) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}
