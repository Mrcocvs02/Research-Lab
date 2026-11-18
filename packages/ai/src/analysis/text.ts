/** Small text helpers of the analysis pipeline (D-446): tokens, light stemming, one-line cleaning. Pure. */
const STOP = new Set(
  'the and for with that this from are was were been into onto over under between within their there which while using use used based via per not but can has have had its our also such than then these those each other more most some any all one two new di del della dei delle degli che con per una uno gli nel nella sono come anche alla alle dal dalla non più tra fra'.split(' '),
);

/** Lowercase word tokens of 3+ letters, stop words dropped, plural `s` removed from longer words. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  }
  return out;
}

/** The text in a single line with the prompt delimiters removed (it goes into a delimited block). */
export const oneLine = (t: string): string => t.replace(/[\r\n|]+/g, ' ').replace(/<<<|>>>/g, ' ').replace(/\s+/g, ' ').trim();

export const clip = (t: string, n: number): string => (t.length > n ? t.slice(0, n).trimEnd() : t);

/** Normal form for comparing labels: accents and case removed, stop words and punctuation dropped. */
export const norm = (t: string): string => tokenize(t).join(' ') || t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
