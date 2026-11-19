import type { CompareCell, CompareColumn, LiteratureKey } from '@rl/core';

/**
 * Cells from the literature note of a paper (feature 16): the note is the template filled in, so its sections are found by
 * their headings (Italian and English); the text and the pages of a section become the cell. A section that is empty or "—" gives
 * nothing, and the caller then asks Claude. Pure.
 */
const HEADINGS: Record<LiteratureKey, RegExp> = {
  problem: /^(problema|problem)\b/i,
  contribution: /^(contributo|contribution)\b/i,
  method: /^(metodo|method)\b/i,
  results: /^(risultati|results)\b/i,
  data: /^(dati|data)\b/i,
  limits: /^(limiti|limits)\b/i,
};

const PAGE_LINK = /\[p\.\s*(\d{1,5})\]\(lab:\/\/doc\/[0-9a-f]{16}\?page=\d+\)/g;

/** `text (p. 2, p. 4)` with links: the text without the page list, and the pages. */
export function cellOfSection(raw: string): { text: string; pages: number[] } | null {
  const pages = [...raw.matchAll(PAGE_LINK)].map((m) => Number(m[1]));
  const text = raw
    .replace(/\(\s*(?:\[p\.[^\]]*\]\([^)]*\)\s*,?\s*)+\)/g, '')
    .replace(PAGE_LINK, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '' || /^[—–-]+$/.test(text)) return null;
  return { text: text.slice(0, 600), pages: [...new Set(pages)].sort((a, b) => a - b).slice(0, 8) };
}

/** The sections of a note by key. */
export function noteCells(body: string): Map<LiteratureKey, { text: string; pages: number[] }> {
  const out = new Map<LiteratureKey, { text: string; pages: number[] }>();
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    const key = (Object.keys(HEADINGS) as LiteratureKey[]).find((k) => HEADINGS[k].test(title));
    if (!key || out.has(key)) continue;
    const cell = cellOfSection(nl < 0 ? '' : part.slice(nl + 1));
    if (cell) out.set(key, cell);
  }
  return out;
}

/** The cell a column reads from a note, or `null` (a column the user named never reads from a note). */
export function cellFromNote(cells: ReadonlyMap<LiteratureKey, { text: string; pages: number[] }>, column: CompareColumn, ai: boolean): CompareCell | null {
  const c = column.key ? cells.get(column.key) : undefined;
  return c ? { text: c.text, pages: c.pages, source: 'note', ai } : null;
}

/** "Autore 2021": the first author's surname and the year, else the title. */
export function rowLabel(d: { title: string | null; authors: readonly string[]; year: number | null; path: string }): string {
  const first = d.authors[0]?.trim();
  const surname = first ? (first.includes(',') ? first.split(',')[0]! : (first.split(/\s+/).pop() ?? first)) : '';
  const who = surname ? (d.authors.length > 2 ? `${surname} et al.` : surname) : (d.title ?? d.path.split('/').pop() ?? '');
  return `${who}${d.year ? ` ${d.year}` : ''}`.slice(0, 200);
}
