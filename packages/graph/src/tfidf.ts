import { tokenize } from './text.js';
import type { GraphDoc, SparseVec } from './types.js';

/** Weight of a word by where it appears: titles say the most, then keywords, the abstract and the body. */
const FIELD_WEIGHT = { title: 3, keywords: 2, abstract: 1.5, text: 1 } as const;
/** Characters of body text read per document (the caller already keeps to the first pages). */
const MAX_TEXT_CHARS = 20_000;
/** Memory bounds: vocabulary size and terms kept per document. */
export const MAX_VOCAB = 30_000;
export const MAX_TERMS_PER_DOC = 64;

export interface Vocabulary {
  terms: string[];
  index: Map<string, number>;
  idf: Float32Array;
}

export type TermCounts = Map<string, number>;

/** Weighted word counts of a document. */
export function countTerms(d: Pick<GraphDoc, 'title' | 'abstract' | 'keywords' | 'text'>): TermCounts {
  const counts: TermCounts = new Map();
  const add = (text: string, weight: number) => {
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + weight);
  };
  add(d.title, FIELD_WEIGHT.title);
  add(d.keywords.join(' . '), FIELD_WEIGHT.keywords);
  add(d.abstract, FIELD_WEIGHT.abstract);
  add(d.text.slice(0, MAX_TEXT_CHARS), FIELD_WEIGHT.text);
  return counts;
}

export function makeVocabulary(terms: string[], idf: ArrayLike<number>): Vocabulary {
  return { terms, index: new Map(terms.map((t, i) => [t, i])), idf: Float32Array.from(idf) };
}

/** Counts to a normalised sparse vector over a vocabulary (terms outside it are ignored). */
export function vectorize(counts: TermCounts, vocab: Vocabulary): SparseVec {
  const entries: Array<[number, number]> = [];
  for (const [term, c] of counts) {
    const i = vocab.index.get(term);
    if (i !== undefined) entries.push([i, (1 + Math.log(c)) * (vocab.idf[i] as number)]);
  }
  if (entries.length > MAX_TERMS_PER_DOC) {
    entries.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    entries.length = MAX_TERMS_PER_DOC;
  }
  entries.sort((p, q) => p[0] - q[0]);
  let norm = 0;
  for (const e of entries) norm += e[1] * e[1];
  norm = Math.sqrt(norm) || 1;
  const i: number[] = [];
  const w: number[] = [];
  for (const [idx, weight] of entries) {
    const q = Math.round((weight / norm) * 1000) / 1000;
    if (q > 0) {
      i.push(idx);
      w.push(q);
    }
  }
  return { i: Int32Array.from(i), w: Float32Array.from(w) };
}

/**
 * TF-IDF vectors of a corpus. Words that occur in a single document (they cannot make two documents close) and, in a
 * corpus of 30 or more, in more than 40% of them (they separate nothing) are left out; the vocabulary is capped.
 */
export function buildVectors(counts: TermCounts[]): { vocab: Vocabulary; vectors: SparseVec[] } {
  const n = counts.length;
  const df = new Map<string, number>();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const maxDf = n >= 30 ? Math.floor(n * 0.4) : n;
  const terms = [...df.entries()]
    .filter(([, d]) => d >= 2 && d <= maxDf)
    .sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))
    .slice(0, MAX_VOCAB);
  const vocab = makeVocabulary(
    terms.map(([t]) => t),
    terms.map(([, d]) => Math.log(1 + n / d)),
  );
  return { vocab, vectors: counts.map((c) => vectorize(c, vocab)) };
}

export function cosine(a: SparseVec, b: SparseVec): number {
  let s = 0;
  let p = 0;
  let q = 0;
  while (p < a.i.length && q < b.i.length) {
    const x = a.i[p] as number;
    const y = b.i[q] as number;
    if (x === y) s += (a.w[p++] as number) * (b.w[q++] as number);
    else if (x < y) p++;
    else q++;
  }
  return s;
}

/** The words two vectors share, most characteristic first (the product of their weights). */
export function sharedTerms(a: SparseVec, b: SparseVec, terms: readonly string[], limit: number): string[] {
  const found: Array<[number, number]> = [];
  let p = 0;
  let q = 0;
  while (p < a.i.length && q < b.i.length) {
    const x = a.i[p] as number;
    const y = b.i[q] as number;
    if (x === y) found.push([x, (a.w[p++] as number) * (b.w[q++] as number)]);
    else if (x < y) p++;
    else q++;
  }
  found.sort((u, v) => v[1] - u[1] || u[0] - v[0]);
  return found.slice(0, limit).map(([i]) => terms[i] as string);
}

/** Inverted index of a set of vectors: for each term the documents that have it. */
export interface Postings {
  docs: Int32Array[];
  weights: Float32Array[];
}

export function buildPostings(vectors: readonly SparseVec[], nTerms: number): Postings {
  const sizes = new Int32Array(nTerms);
  for (const v of vectors) for (const t of v.i) sizes[t] = (sizes[t] as number) + 1;
  const docs = Array.from(sizes, (s) => new Int32Array(s));
  const weights = Array.from(sizes, (s) => new Float32Array(s));
  const fill = new Int32Array(nTerms);
  vectors.forEach((v, d) => {
    for (let k = 0; k < v.i.length; k++) {
      const t = v.i[k] as number;
      const at = fill[t] as number;
      fill[t] = at + 1;
      (docs[t] as Int32Array)[at] = d;
      (weights[t] as Float32Array)[at] = v.w[k] as number;
    }
  });
  return { docs, weights };
}

/** Scratch space of `nearest`: reused between calls so that a pass over the corpus allocates nothing. */
export interface Scratch {
  acc: Float32Array;
  touched: Int32Array;
}
export const makeScratch = (n: number): Scratch => ({ acc: new Float32Array(n), touched: new Int32Array(n) });

interface Hit {
  j: number;
  s: number;
}

/** The `k` documents closest to `v` by cosine (excluding `self`), best first, ties by index. Scores at least `min`. */
export function nearest(post: Postings, v: SparseVec, self: number, k: number, min: number, s: Scratch): Hit[] {
  let count = 0;
  for (let t = 0; t < v.i.length; t++) {
    const docs = post.docs[v.i[t] as number] as Int32Array;
    const ws = post.weights[v.i[t] as number] as Float32Array;
    const wv = v.w[t] as number;
    for (let p = 0; p < docs.length; p++) {
      const d = docs[p] as number;
      if (d === self) continue;
      if (s.acc[d] === 0) s.touched[count++] = d;
      s.acc[d] = (s.acc[d] as number) + wv * (ws[p] as number);
    }
  }
  const top: Hit[] = [];
  const worse = (a: Hit, b: Hit) => a.s < b.s || (a.s === b.s && a.j > b.j);
  for (let c = 0; c < count; c++) {
    const d = s.touched[c] as number;
    const hit = { j: d, s: s.acc[d] as number };
    s.acc[d] = 0;
    if (hit.s < min) continue;
    if (top.length === k && worse(hit, top[k - 1] as Hit)) continue;
    let at = top.length;
    while (at > 0 && worse(top[at - 1] as Hit, hit)) at--;
    top.splice(at, 0, hit);
    if (top.length > k) top.pop();
  }
  return top;
}
