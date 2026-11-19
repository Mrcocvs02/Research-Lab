import { baseCitekey, familyName } from '@rl/export';

/** `base`, or `base` + a, b, ... z, aa ... when taken. */
export function freeKey(base: string, used: ReadonlySet<string>): string {
  let key = base;
  for (let n = 0; used.has(key); n++) {
    let suffix = '';
    for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) suffix = String.fromCharCode(97 + (k % 26)) + suffix;
    key = base + suffix;
  }
  return key;
}

/** The key a document gets when it has none: `smith2020` (author-year) or `smith2020attention` (author-year-title). */
export function newKey(d: { authors: readonly string[]; year: number | null; title: string | null }, schema: 'author-year' | 'author-year-title'): string {
  if (schema === 'author-year-title') return baseCitekey(d);
  const fam = familyName(d.authors[0] ?? '').slice(0, 24) || 'anon';
  return `${fam}${d.year === null ? 'nd' : String(d.year)}`;
}
