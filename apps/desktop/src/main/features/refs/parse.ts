import { REFS_LIMITS } from '@rl/core';

/** One bibliography entry as read from the text: its number, the raw text and what is needed to match a mention. */
export interface RawEntry {
  n: number;
  text: string;
  surname: string | null;
  year: number | null;
}

const HEADING = /^\s*(?:\d+[.)]?\s+)?(references|bibliography|literature cited|works cited|bibliografia|riferimenti(?: bibliografici)?)\s*:?\s*$/i;
const NUMBERED = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(?=\S)/;
const AUTHOR_START = /^\s*[\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?,\s+(?:[\p{Lu}]\.|[\p{Lu}][\p{Ll}]+)/u;
const YEAR = /\b((?:19|20)\d{2})[a-z]?\b/;

/** The lines of the pages after the last "References" heading; `null` when there is no such heading. */
export function bibliographyLines(pages: ReadonlyArray<{ page: number; text: string }>): string[] | null {
  const lines = pages.flatMap((p) => p.text.split(/\r?\n/));
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADING.test(lines[i]!)) {
      at = i;
      break;
    }
  }
  return at < 0 ? null : lines.slice(at + 1);
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2').trim();

/** Splits the lines into entries: numbered (`[12] …`, `12. …`) when most entries are, else author-year (a new entry starts with `Surname, N.`). */
export function parseBibliography(lines: readonly string[]): RawEntry[] {
  const numbered = lines.filter((l) => NUMBERED.test(l)).length >= 3;
  const chunks: Array<{ n: number | null; text: string }> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    const num = numbered ? NUMBERED.exec(line) : null;
    const startsAuthor = !numbered && AUTHOR_START.test(line) && (chunks.length === 0 || /[.)\d]$/.test(chunks[chunks.length - 1]!.text));
    if (num) chunks.push({ n: Number(num[1] ?? num[2]), text: line.replace(NUMBERED, '') });
    else if (startsAuthor) chunks.push({ n: null, text: line });
    else if (chunks.length > 0) chunks[chunks.length - 1]!.text += ` ${line}`;
  }
  return chunks.slice(0, REFS_LIMITS.entries).map((c, i) => {
    const text = clean(c.text).slice(0, REFS_LIMITS.text);
    const surname = numbered ? (/^\p{Lu}\.?(?:\s?\p{Lu}\.)*\s+([\p{Lu}][\p{L}'’-]+)/u.exec(text)?.[1] ?? /^([\p{Lu}][\p{L}'’-]+),/u.exec(text)?.[1] ?? null) : (/^([\p{Lu}][\p{L}'’-]+)/u.exec(text)?.[1] ?? null);
    return { n: c.n ?? i + 1, text, surname: surname ? surname.toLowerCase() : null, year: Number(YEAR.exec(text)?.[1]) || null };
  });
}
