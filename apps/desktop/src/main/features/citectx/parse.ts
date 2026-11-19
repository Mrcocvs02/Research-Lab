import { CITECTX_LIMITS } from '@rl/core';

/**
 * Context of the citations (feature 11): in the text of a citing paper, the sentences that cite one work. A numbered entry is
 * cited as `[12]`, `[3, 12]` or `[10-14]`; an author-year entry as `Surname ... 2021` close together. Pure; the bibliography at
 * the end of the paper is left out (a mention there is the entry itself).
 */
export interface Mention {
  n: number | null;
  surname: string | null;
  year: number | null;
}
export interface Page {
  page: number;
  text: string;
}

const HEADING = /^\s*(?:\d+[.)]?\s+)?(references|bibliography|literature cited|works cited|bibliografia|riferimenti(?: bibliografici)?)\s*:?\s*$/i;

/** The pages up to the last "References" heading (the heading's own page cut at it). */
export function bodyPages(pages: readonly Page[]): Page[] {
  let cutPage = -1;
  let cutLine = -1;
  pages.forEach((p, pi) => p.text.split(/\r?\n/).forEach((l, li) => HEADING.test(l) && ((cutPage = pi), (cutLine = li))));
  if (cutPage < 0) return [...pages];
  return pages.slice(0, cutPage + 1).map((p, i) => (i === cutPage ? { page: p.page, text: p.text.split(/\r?\n/).slice(0, cutLine).join('\n') } : p));
}

/** Does a bracket's content name entry `n`? ("3, 12", "10-14", "10–14"); any non-numeric part makes it not a citation. */
export function bracketHas(inner: string, n: number): boolean {
  let hit = false;
  for (const part of inner.split(/[,;]/)) {
    const m = /^\s*(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*$/.exec(part);
    if (!m) return false;
    const x = Number(m[1]);
    const y = m[2] ? Number(m[2]) : x;
    if (n >= Math.min(x, y) && n <= Math.max(x, y)) hit = true;
  }
  return hit;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cites(sentence: string, m: Mention): boolean {
  if (m.n !== null) for (const b of sentence.matchAll(/\[([^\]]{1,40})\]/g)) if (bracketHas(b[1]!, m.n)) return true;
  if (m.surname && m.year) return new RegExp(`${escapeRe(m.surname)}(?:\\s+et\\s+al\\.)?[^.;]{0,50}?${m.year}`, 'iu').test(sentence);
  return false;
}

const sentencesOf = (text: string): string[] =>
  text
    .replace(/-\r?\n(?=\p{Ll})/gu, '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])(?<!\bal\.)\s+(?=[\p{Lu}\[(])/u)
    .map((x) => x.trim())
    .filter((x) => x.length >= 20);

/** At most three sentences of the body that cite the work, each with its page. */
export function mentionSentences(pages: readonly Page[], m: Mention): Array<{ page: number; text: string }> {
  const out: Array<{ page: number; text: string }> = [];
  for (const p of bodyPages(pages)) {
    for (const s of sentencesOf(p.text)) {
      if (!cites(s, m)) continue;
      out.push({ page: p.page, text: s.slice(0, CITECTX_LIMITS.sentenceChars) });
      if (out.length >= CITECTX_LIMITS.sentences) return out;
    }
  }
  return out;
}
