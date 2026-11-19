import type { RefEntry } from '@rl/core';

/** What a reference in the running text points at: a number of the bibliography, or an author and a year. */
export type Mention = { kind: 'num'; n: number; start: number; end: number } | { kind: 'ay'; surname: string; year: number; start: number; end: number };

const NUM = /\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g;
const AUTHOR_YEAR = /([\p{Lu}][\p{L}'’-]+)(?:\s+et\s+al\.?|\s+(?:and|&|e)\s+[\p{Lu}][\p{L}'’-]+)?,?\s*\(?((?:19|20)\d{2})[a-z]?\)?/gu;

/** Every mention in `text` (a piece of the text layer), in order. A group `[3, 5]` gives one mention per number. */
export function mentionsIn(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(NUM)) {
    const base = m.index + 1;
    for (const num of m[1]!.matchAll(/\d{1,3}/g)) out.push({ kind: 'num', n: Number(num[0]), start: base + num.index, end: base + num.index + num[0].length });
  }
  for (const m of text.matchAll(AUTHOR_YEAR)) out.push({ kind: 'ay', surname: m[1]!.toLowerCase(), year: Number(m[2]), start: m.index, end: m.index + m[0].length });
  return out.sort((a, b) => a.start - b.start);
}

/** The mention under character `offset` of `text`, or `null`; in a bracket group without a number under the offset, the first number. */
export function mentionAt(text: string, offset: number): Mention | null {
  const all = mentionsIn(text);
  const exact = all.find((m) => offset >= m.start && offset <= m.end);
  if (exact) return exact;
  for (const g of text.matchAll(NUM)) if (offset >= g.index && offset <= g.index + g[0].length) return all.find((m) => m.kind === 'num' && m.start > g.index && m.start < g.index + g[0].length) ?? null;
  return null;
}

/** The bibliography entry a mention names; an author-year mention needs the first author's surname and the year to agree. */
export function entryFor(m: Mention, items: readonly RefEntry[]): RefEntry | null {
  if (m.kind === 'num') return items.find((e) => e.n === m.n) ?? null;
  return items.find((e) => e.year === m.year && e.surname === m.surname) ?? null;
}
