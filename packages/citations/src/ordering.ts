import type { CitationLink } from '@rl/core';
import { lastName, linkKeys, titleKey } from './match.js';

/** A top-level section of the citing work (reference list excluded): its heading and its text. */
export interface TextSection {
  title: string;
  text: string;
}

export interface RankInput {
  refs: readonly CitationLink[];
  sections: readonly TextSection[];
  /** For each work key (`linkKeys`) the number of OTHER library documents whose reference list holds the work (co-citation). */
  libraryCounts: ReadonlyMap<string, number>;
  /** The literature note of the citing work, for the similarity signal (optional). */
  noteText?: string | undefined;
}

export interface RankedRef {
  link: CitationLink;
  /** 0-1. */
  relevance: number;
  signals: { mentions: number; sectionWeight: number; cocited: number; similarity: number; inLibrary: boolean };
}

/** Weight of the section a mention sits in: the work's own method, results and discussion count more than an opening survey. */
const SECTION_WEIGHT: Array<[RegExp, number]> = [
  [/\b(?:method|methodology|approach|model|theory|framework|setup|metodo|modello)/i, 1],
  [/\b(?:result|discussion|analysis|experiment|risultat|discussione)/i, 1],
  [/\b(?:conclusion|outlook|conclusioni)/i, 0.7],
  [/\b(?:introduction|background|related|preliminar|introduzione)/i, 0.5],
];
const sectionWeight = (title: string): number => SECTION_WEIGHT.find(([re]) => re.test(title))?.[1] ?? 0.6;

const RANK_WEIGHTS = { mentions: 0.4, cocited: 0.25, similarity: 0.25, library: 0.1 } as const;
const MAX_TEXT = 3_000_000;

/** Ways a reference is cited in the text: `Smith (2020)`, `Smith et al., 2020`, `Smith and Jones 2020` (surname of the first author + year). */
function mentionPatterns(l: CitationLink): RegExp | null {
  const first = lastName(l.authors[0]);
  if (!first || first.length < 2 || !l.year) return null;
  const surname = first.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').join('\\s+');
  return new RegExp(`\\b${surname}\\b[^.\\n]{0,60}?\\(?\\b${l.year}[a-z]?\\b`, 'giu');
}

const tokens = (t: string) => new Set(titleKey(t).split(' ').filter((w) => w.length > 3));

/**
 * References ordered by relevance to the citing work (D-446 g). Signals: how often and WHERE the work is mentioned in the text
 * (author-year mentions weighted by section), co-citation with the library (other library documents that cite it), similarity of its
 * title with the literature note, and whether it is already in the library. Pure; the order of equal scores is the original order.
 */
export function rankReferences(input: RankInput): RankedRef[] {
  const text = input.sections.map((s) => ({ w: sectionWeight(s.title), text: s.text.slice(0, MAX_TEXT) }));
  const noteTok = input.noteText ? tokens(input.noteText) : new Set<string>();
  const rows = input.refs.map((link) => {
    const re = mentionPatterns(link);
    let mentions = 0;
    let weighted = 0;
    if (re)
      for (const s of text) {
        const n = Math.min(20, s.text.match(re)?.length ?? 0);
        mentions += n;
        weighted += n * s.w;
      }
    const cocited = Math.max(0, ...linkKeys(link).map((k) => input.libraryCounts.get(k) ?? 0));
    const tt = tokens(link.title ?? '');
    let hit = 0;
    for (const w of tt) if (noteTok.has(w)) hit++;
    const similarity = tt.size > 0 ? hit / tt.size : 0;
    return { link, mentions, weighted, cocited, similarity };
  });
  const maxW = Math.max(1, ...rows.map((r) => r.weighted));
  const maxC = Math.max(1, ...rows.map((r) => r.cocited));
  return rows
    .map((r, i) => {
      const mention = Math.min(1, Math.log1p(r.weighted) / Math.log1p(maxW));
      const co = Math.log1p(r.cocited) / Math.log1p(maxC);
      const inLibrary = r.link.matchedDocId !== null;
      const relevance = RANK_WEIGHTS.mentions * mention + RANK_WEIGHTS.cocited * co + RANK_WEIGHTS.similarity * r.similarity + RANK_WEIGHTS.library * (inLibrary ? 1 : 0);
      return { i, v: { link: r.link, relevance: Math.round(relevance * 1000) / 1000, signals: { mentions: r.mentions, sectionWeight: r.mentions ? r.weighted / r.mentions : 0, cocited: r.cocited, similarity: Math.round(r.similarity * 1000) / 1000, inLibrary } } };
    })
    .sort((a, b) => b.v.relevance - a.v.relevance || a.i - b.i)
    .map((x) => x.v);
}

/** Counts, per work key, in how many of the given reference lists the work appears (each list counts once). */
export function libraryCocitation(lists: Iterable<readonly CitationLink[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const l of list) for (const k of linkKeys(l)) seen.add(k);
    for (const k of seen) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
