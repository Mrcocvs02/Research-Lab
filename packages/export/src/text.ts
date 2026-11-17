import { createHash } from 'node:crypto';

/** Lowercase ASCII form of a text: accents removed, ligatures expanded; callers filter whatever else they do not want. */
export function foldAscii(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase();
}

/** File-name slug: `[a-z0-9-]`, at most `max` characters, never empty. */
export function slugify(s: string, max = 60, fallback = 'untitled'): string {
  const out = foldAscii(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return out || fallback;
}

/** Rough token count for an agent (characters / 4), the same rule as the rest of the app. */
export const approxTokens = (chars: number): number => Math.ceil(chars / 4);

export const sha256 = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

/** A YAML scalar: plain when safe, else a double-quoted JSON string (valid YAML). */
export function yamlScalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  const plain = /^[A-Za-z][A-Za-z0-9 _.,()/+-]*$/.test(v) && !/^(true|false|null|yes|no|on|off)$/i.test(v) && !v.endsWith(' ');
  // JSON allows U+2028/2029 raw; YAML 1.1 reads them as line breaks.
  return plain ? v : JSON.stringify(v).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

/** Single-line text for a list item. */
export const oneLine = (s: string, max = 300): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Text taken from a PDF, a web page or an AI, rendered as plain Markdown text: no link, image, wikilink, HTML tag or
 * comment (a backslash escapes the characters \ [ ] < and the backtick), and no heading, quote, list, rule or front
 * matter at the start of a line. A reader or an agent sees the characters, never the structure the text tried to forge.
 */
export const mdText = (s: string): string =>
  s
    .replace(/[\\[\]<`]/g, (c) => `\\${c}`)
    .split('\n')
    .map((l) => l.replace(/^(\s*)([#>+=|~-]|\d+[.)])/, '$1\\$2'))
    .join('\n');

/** `oneLine` of untrusted text, neutralised (cut first, so an escape is never split). */
export const safeLine = (s: string, max = 300): string => mdText(oneLine(s, max));

/** Removes what could close or fake one of our markers inside user or document text. */
export const stripMarkers = (s: string): string => s.replace(/rl:(begin|end)/g, 'rl-$1');
