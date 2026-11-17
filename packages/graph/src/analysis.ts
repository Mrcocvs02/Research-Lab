import { buildPostings, buildVectors, countTerms, cosine, makeScratch, nearest, sharedTerms, type Postings, type Scratch, type Vocabulary } from './tfidf.js';
import { checkpoint, type GraphDoc, type RunContext, type SparseVec } from './types.js';

/** Weights of the three signals in the combined closeness of two documents. */
export const WEIGHTS = { text: 0.7, citations: 0.2, tags: 0.1 } as const;
/** Neighbours kept per document (the clustering graph uses the first `GRAPH_K`). */
export const STORE_K = 20;
export const GRAPH_K = 10;
/** A document is "close by text" to another from this cosine on (the reason `text` is given). */
export const TEXT_REASON_MIN = 0.1;
/** Pairs below this combined score are not neighbours at all. */
const MIN_SCORE = 0.03;
/** A citation key shared by more documents than this, or a tag shared by more than `TAG_CAP`, does not make candidates. */
const KEY_CAP = 300;
const TAG_CAP = 25;

export type Reason = 'text' | 'citations' | 'tags';

export interface Neighbor {
  j: number;
  /** Combined score, 0..1. */
  score: number;
  text: number;
  /** Citation closeness 0..1 (a direct link counts at least 0.8). */
  cit: number;
  /** Number of shared cited/citing works. */
  citShared: number;
  direct: boolean;
  tag: number;
  tagShared: number;
  sameFolder: boolean;
}

export const combine = (text: number, cit: number, tag: number): number => WEIGHTS.text * text + WEIGHTS.citations * cit + WEIGHTS.tags * tag;

export function reasonsOf(n: Pick<Neighbor, 'text' | 'citShared' | 'direct' | 'tagShared'>): Reason[] {
  const out: Reason[] = [];
  if (n.text >= TEXT_REASON_MIN) out.push('text');
  if (n.direct || n.citShared > 0) out.push('citations');
  if (n.tagShared > 0) out.push('tags');
  return out;
}

const push = (m: Map<string, number[]>, key: string, v: number) => {
  const l = m.get(key);
  if (l) l.push(v);
  else m.set(key, [v]);
};

export interface Analysis {
  docs: readonly GraphDoc[];
  vocab: Vocabulary;
  vectors: SparseVec[];
  neighborsOf(i: number, k: number): Neighbor[];
}

/**
 * TF-IDF vectors plus the signals of citations and tags of a set of documents, ready to answer "who is close to
 * document i". Used for the whole library at build time and, on the fly, for one document.
 */
export async function analyze(docs: readonly GraphDoc[], ctx?: RunContext): Promise<Analysis> {
  const n = docs.length;
  const counts = [];
  for (let i = 0; i < n; i++) {
    counts.push(countTerms(docs[i] as GraphDoc));
    if (i % 100 === 99) {
      ctx?.onProgress?.('vectors', i + 1, n);
      await checkpoint(ctx);
    }
  }
  const { vocab, vectors } = buildVectors(counts);
  ctx?.onProgress?.('vectors', n, n);
  return makeAnalysis(docs, vocab, vectors);
}

export function makeAnalysis(docs: readonly GraphDoc[], vocab: Vocabulary, vectors: SparseVec[]): Analysis {
  const n = docs.length;
  const post: Postings = buildPostings(vectors, vocab.terms.length);
  const scratch: Scratch = makeScratch(n);
  const indexOf = new Map(docs.map((d, i) => [d.id, i]));
  const byTag = new Map<string, number[]>();
  const byKey = new Map<string, number[]>();
  const refSets = docs.map((d) => new Set(d.refs));
  const tagSets = docs.map((d) => new Set(d.tags));
  const direct = docs.map((d) => new Set<number>());
  docs.forEach((d, i) => {
    for (const t of tagSets[i] as Set<string>) push(byTag, t, i);
    for (const k of refSets[i] as Set<string>) push(byKey, k, i);
    for (const id of d.cites) {
      const j = indexOf.get(id);
      if (j !== undefined && j !== i) {
        (direct[i] as Set<number>).add(j);
        (direct[j] as Set<number>).add(i);
      }
    }
  });

  const pair = (i: number, j: number): Omit<Neighbor, 'j' | 'score' | 'text'> => {
    const a = refSets[i] as Set<string>;
    const b = refSets[j] as Set<string>;
    let citShared = 0;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    for (const k of small) if (big.has(k)) citShared++;
    const isDirect = (direct[i] as Set<number>).has(j);
    const coupling = citShared === 0 ? 0 : citShared / Math.sqrt(a.size * b.size);
    const ta = tagSets[i] as Set<string>;
    const tb = tagSets[j] as Set<string>;
    let tagShared = 0;
    for (const t of ta) if (tb.has(t)) tagShared++;
    const union = ta.size + tb.size - tagShared;
    return {
      cit: isDirect ? Math.max(0.8, coupling) : coupling,
      citShared,
      direct: isDirect,
      tag: union === 0 ? 0 : tagShared / union,
      tagShared,
      sameFolder: (docs[i] as GraphDoc).folder === (docs[j] as GraphDoc).folder,
    };
  };

  return {
    docs,
    vocab,
    vectors,
    neighborsOf(i, k) {
      const v = vectors[i] as SparseVec;
      const cand = new Map<number, number>();
      for (const h of nearest(post, v, i, k * 2, 0.02, scratch)) cand.set(h.j, h.s);
      const wide = (l: number[] | undefined, cap: number) => {
        if (l && l.length <= cap) for (const j of l) if (j !== i && !cand.has(j)) cand.set(j, cosine(v, vectors[j] as SparseVec));
      };
      for (const key of refSets[i] as Set<string>) wide(byKey.get(key), KEY_CAP);
      for (const t of tagSets[i] as Set<string>) wide(byTag.get(t), TAG_CAP);
      for (const j of direct[i] as Set<number>) if (!cand.has(j)) cand.set(j, cosine(v, vectors[j] as SparseVec));
      const out: Neighbor[] = [];
      for (const [j, text] of cand) {
        const p = pair(i, j);
        const score = combine(text, p.cit, p.tag);
        if (score >= MIN_SCORE) out.push({ j, score, text, ...p });
      }
      out.sort((p, q) => q.score - p.score || p.j - q.j);
      return out.slice(0, k);
    },
  };
}

/** Closeness of one document to the others, with what they share (terms in `shared`). */
export function similarTo(a: Analysis, i: number, limit: number): Array<Neighbor & { reasons: Reason[]; terms: string[] }> {
  return a.neighborsOf(i, limit).map((n) => ({
    ...n,
    reasons: reasonsOf(n),
    terms: sharedTerms(a.vectors[i] as SparseVec, a.vectors[n.j] as SparseVec, a.vocab.terms, 8),
  }));
}
