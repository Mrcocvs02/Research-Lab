import { foldAscii } from './text.js';

const STOP = new Set(
  (
    'a an the of on in at to for from with without by and or as is are be been this that these those its into onto via using use towards toward ' +
    'il lo la le gli un una uno di del della dei delle degli da con su per tra fra e ed o che come sul sulla nel nella alla al ai ' +
    'les des du de et une pour sur dans par der die das und ein eine fur von mit zu el los las y en por para'
  ).split(' '),
);

const clean = (s: string) => foldAscii(s).replace(/[^a-z0-9]/g, '');

/** Family name of "Family, Given" or "Given Family". */
export function familyName(author: string): string {
  const a = author.trim();
  if (a === '') return '';
  const comma = a.indexOf(',');
  if (comma > 0) return clean(a.slice(0, comma));
  const parts = a.split(/\s+/);
  return clean(parts[parts.length - 1] as string);
}

/** First word of the title that is not a stop word (at least three letters or digits), folded to ASCII. */
export function significantWord(title: string): string {
  const words = foldAscii(title)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const pick = words.find((w) => w.length >= 3 && !STOP.has(w)) ?? words.find((w) => !STOP.has(w)) ?? '';
  return pick.slice(0, 24);
}

/** `<firstauthorfamily><year><firstsignificanttitleword>`: ASCII, lowercase, never empty. */
export function baseCitekey(doc: { authors: readonly string[]; year: number | null; title: string | null }): string {
  const fam = familyName(doc.authors[0] ?? '').slice(0, 24) || 'anon';
  const year = doc.year === null ? 'nd' : String(doc.year);
  return `${fam}${year}${significantWord(doc.title ?? '') || 'untitled'}`;
}

/** a, b, ... z, then aa, ab, ... */
function suffix(n: number): string {
  let s = '';
  let k = n;
  do {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return s;
}

export interface CitekeyInput {
  id: string;
  authors: readonly string[];
  year: number | null;
  title: string | null;
}

/**
 * Citekeys of `docs`: the ones in `known` (a previous export) are kept as they are, the rest are derived and made unique
 * against every key in use (old exports included) with a, b, c... Documents are processed in id order so that the result
 * does not depend on the order of the selection. Returns the full map (known entries included).
 */
export function assignCitekeys(docs: readonly CitekeyInput[], known: Readonly<Record<string, string>> = {}): Record<string, string> {
  const out: Record<string, string> = { ...known };
  const used = new Set(Object.values(out));
  for (const d of [...docs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (out[d.id] !== undefined) continue;
    const base = baseCitekey(d);
    let key = base;
    for (let n = 0; used.has(key); n++) key = `${base}${suffix(n)}`;
    used.add(key);
    out[d.id] = key;
  }
  return out;
}
