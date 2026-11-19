import { combine, cosine, pairSignals, sharedTerms, type SparseVec } from '@rl/graph';
import type { LinkReasons } from './schema.js';

/**
 * The score of a pair of documents for "Find links" (§18.2): the signals the Map already has, combined with the weights it
 * uses, and a rule of evidence so that nothing is added on a weak coincidence. Pure: no files, no library.
 */
export interface DocFeatures {
  id: string;
  /** TF-IDF vector of the model (null: no text signal for this document). */
  vec: SparseVec | null;
  /** Citation keys (`r:`, `c:`). */
  refs: ReadonlySet<string>;
  /** Library documents this one cites, and the ones citing it. */
  cites: ReadonlySet<string>;
  citedBy: ReadonlySet<string>;
  /** Tag id -> weight (accepted score, 1 for a tag set by hand). */
  tags: ReadonlyMap<string, number>;
  /** Author key -> written form (consortia left out). */
  authors: ReadonlyMap<string, string>;
}

export interface ScoreContext {
  /** Terms of the model's vocabulary, to name the shared words. */
  terms: readonly string[];
  /** Citation keys shared by more documents than this are ignored. */
  keyCap: (key: string) => boolean;
  /** Tags that say nothing: roots and those on more than 30 % of the library. */
  skipTag: (tag: string) => boolean;
  tagLabel: (tag: string) => string;
}

export const KEY_CAP = 300;
export const TEXT_EVIDENCE = 0.15;
export const MAIN_TAG = 0.6;

export interface Scored {
  /** The score S, 0..1. */
  score: number;
  /** A strong proof exists (text, direct citation, enough shared references or a main tag). */
  evidence: boolean;
  reasons: LinkReasons;
}

/** Sum of the weights of the tags that count. */
const mass = (m: ReadonlyMap<string, number>, skip: (t: string) => boolean): number => {
  let s = 0;
  for (const [t, w] of m) if (!skip(t)) s += w;
  return s;
};

export function scorePair(s: DocFeatures, t: DocFeatures, ctx: ScoreContext): Scored {
  const text = s.vec && t.vec ? cosine(s.vec, t.vec) : 0;
  const to = s.cites.has(t.id) || t.citedBy.has(s.id);
  const from = t.cites.has(s.id) || s.citedBy.has(t.id);
  const direct = to || from;
  const c = pairSignals(s.refs, t.refs, direct, ctx.keyCap);
  const cit = direct ? 1 : c.cit;

  const shared: string[] = [];
  let num = 0;
  let mainTag = false;
  for (const [tag, ws] of s.tags) {
    const wt = t.tags.get(tag);
    if (wt === undefined || ctx.skipTag(tag)) continue;
    shared.push(tag);
    num += Math.min(ws, wt);
    if (ws >= MAIN_TAG && wt >= MAIN_TAG) mainTag = true;
  }
  const den = Math.min(mass(s.tags, ctx.skipTag), mass(t.tags, ctx.skipTag));
  const tag = den > 0 ? Math.min(1, num / den) : 0;

  const authors: string[] = [];
  for (const [k, name] of s.authors) if (t.authors.has(k)) authors.push(name);
  const author = Math.min(1, authors.length / 2);

  let score = 0.9 * combine(text, cit, tag) + 0.1 * author;
  if (direct) score = Math.max(score, 0.5);
  score = Math.min(1, Math.max(0, score));

  const evidence = text >= TEXT_EVIDENCE || direct || (cit >= 0.2 && c.citShared >= 3) || mainTag;

  const reasons: LinkReasons = {};
  if (s.vec && t.vec && text > 0) {
    const terms = sharedTerms(s.vec, t.vec, ctx.terms, 5);
    if (terms.length > 0) reasons.terms = terms;
  }
  if (direct) reasons.cites = to && from ? 'both' : to ? 'to' : 'from';
  else if (c.citShared > 0) reasons.shared = c.citShared;
  if (shared.length > 0) reasons.tags = shared.slice(0, 3).map(ctx.tagLabel);
  if (authors.length > 0) reasons.authors = authors.slice(0, 3);
  return { score, evidence, reasons };
}

export type Strictness = 'strict' | 'normal' | 'wide';

/** The normal threshold: the median score of the neighbours the Map draws, kept in [0.15, 0.40]; 0.25 without a model. */
export function normalThreshold(neighbourScores: readonly number[]): number {
  if (neighbourScores.length === 0) return 0.25;
  const v = [...neighbourScores].sort((x, y) => x - y);
  const mid = v.length >> 1;
  const median = v.length % 2 === 1 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
  return Math.min(0.4, Math.max(0.15, median));
}

export function thresholdFor(tau: number, strictness: Strictness): number {
  const r = (x: number) => Math.round(x * 100) / 100;
  if (strictness === 'strict') return r(Math.min(tau + 0.1, 0.5));
  if (strictness === 'wide') return r(Math.max(tau - 0.07, 0.1));
  return r(tau);
}

/** Whether a pair is added by the search: above the threshold and with a strong proof. */
export const passes = (s: Scored, threshold: number): boolean => s.score >= threshold && s.evidence;

