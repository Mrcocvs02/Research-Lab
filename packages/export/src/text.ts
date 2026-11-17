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
  return plain ? v : JSON.stringify(v);
}

/** Single-line text for a list item. */
export const oneLine = (s: string, max = 300): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Removes what could close or fake one of our markers inside user or document text. */
export const stripMarkers = (s: string): string => s.replace(/rl:(begin|end)/g, 'rl-$1');
