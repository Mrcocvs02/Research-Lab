import type { TaxonomyOp } from '@rl/core';
import { normalizeName } from '../normalize.js';

/**
 * Near-duplicate detector of the tag vocabulary (D-493, §19.1.3): a pure function over the nodes, the tags the documents carry
 * and the pairs the user said are different. Nothing here reads or writes a file; it is loaded on demand (chunk `tag-review`).
 */

export type Confidence = 'sure' | 'likely' | 'maybe';
export type ProposalKind = 'merge' | 'twins' | 'parent' | 'name' | 'metadata' | 'promote';

export interface ReviewNode {
  id: string;
  label: string;
  aliases: readonly string[];
  parents: readonly string[];
  status: string;
  family?: 'one' | 'many' | 'keywords' | undefined;
  group?: string | undefined;
}
export interface ReviewDoc {
  id: string;
  tags: readonly string[];
  /** Authors as the document lists them (`Surname, Given` or `Given Surname`): lets the detector spot author names used as tags. */
  authors?: readonly string[] | undefined;
}
export interface ReviewInput {
  nodes: readonly ReviewNode[];
  docs: readonly ReviewDoc[];
  distinct?: ReadonlyArray<{ a: string; b: string }> | undefined;
  venues?: ReadonlyArray<{ id: string; name: string; aliases: readonly string[] }> | undefined;
}

export interface Evidence {
  /** Documents per tag (id -> count). */
  papers: Record<string, number>;
  shared: number;
  jaccard: number;
}

export interface Proposal {
  /** Deterministic from the kind and the tags: the same finding keeps its id between runs. */
  id: string;
  kind: ProposalKind;
  tags: string[];
  /** The tag that survives (merge, twins merged), or the parent (kind `parent`). */
  keep?: string | undefined;
  /** The label the survivor gets (the naming convention applied, or the built "Extended (ACR)"); absent = unchanged. */
  label?: string | undefined;
  confidence: Confidence;
  /** The rules that fired, e.g. `form`, `plural`, `acronym-in-name`, `acronym-expansion`, `spelling`, `alias`, `twins`, `inclusion`, `cooccurrence`. */
  reason: string;
  /** Twins: what to do by default. */
  action?: 'merge' | 'keywords' | undefined;
  /** Metadata: the field the tag really is. */
  meta?: { field: 'venue' | 'status' | 'author'; value: string } | undefined;
  evidence: Evidence;
}

export const MAX_NAME = 60;

/* ------------------------------------------------------------------ names and keys */

const STOP = new Set('of the and for in on a an to with di del della dei degli delle e per con su da la il lo le gli de des du et y el los las und der die das von für'.split(' '));
const VOWELS = 'aeio';

/** Letters and digits of a name, lower case, accents stripped. */
export const tokensOf = (s: string): string[] => normalizeName(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export const formKey = (s: string): string => tokensOf(s).join('');
/** Number of tokens of a name that are not stop words. */
export const meaningfulCount = (s: string): number => tokensOf(s).filter((t) => !STOP.has(t)).length;
const digitsOf = (s: string): string => s.replace(/\D+/g, '');

/** The naming convention (D-493): `_` -> space, spaces collapsed, capital initial, the rest as written, at most 60 characters. */
export function conventionName(label: string): string {
  // A short token with no vowel (`pqr`, `zk`, `kt` in `3-kt`) is a sigla written in lower case: capitals, as the convention wants.
  const t = label
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<![\p{L}\p{N}])[b-df-hj-np-tv-xz]{2,5}(?![\p{L}\p{N}])/giu, (m) => m.toUpperCase());
  const out = t.charAt(0).toUpperCase() + t.slice(1);
  return out.length > MAX_NAME ? out.slice(0, MAX_NAME).trim() : out;
}

const ACRO_PAREN = /^(.*\S)\s*\(([\p{L}\p{N}]{2,8})\)\s*$/u;
/** "Name (ACR)" -> its two parts. */
export function splitAcronymName(label: string): { name: string; acro: string } | null {
  const m = ACRO_PAREN.exec(label.trim());
  return m ? { name: m[1] as string, acro: m[2] as string } : null;
}
/** A sigla: one token of 2-8 letters or digits, all capitals as written. */
export const isSigla = (label: string): boolean => /^[\p{Lu}\p{N}]{2,8}$/u.test(label.trim()) && /\p{Lu}/u.test(label);
/** A sigla as old keyword lists write it: one lower-case token of 2-5 letters (`abc`, `xy`); weaker evidence than capitals. */
const isLowerSigla = (label: string): boolean => /^\p{Ll}{2,5}$/u.test(label.trim());
/** A capital sigla with a plural `s` ("GNUs"): the sigla without the `s`. */
const pluralSigla = (label: string): string | null => {
  const m = /^([\p{Lu}\p{N}]{2,8})s$/u.exec(label.trim());
  return m && /\p{Lu}/u.test(m[1] as string) ? (m[1] as string) : null;
};

/** English plural of one token to its singular, or the token itself. */
function enSingular(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && /(s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !/[sui]$/.test(t.slice(0, -1))) return t.slice(0, -1);
  return t;
}
const romStem = (t: string): string => (t.length >= 5 && VOWELS.includes(t.at(-1) as string) ? t.slice(0, -1) : t);
export const stemToken = (t: string): string => romStem(enSingular(t));

/** 2 = a plural/singular pair of the same word, 1 = differs only in the ending, 0 = different words. */
export function tokenRelation(x: string, y: string): 0 | 1 | 2 {
  if (x === y) return 2;
  if (/\d/.test(x) || /\d/.test(y)) return 0;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (enSingular(l) === s && s.length >= 2 && l !== s) return 2;
  if (l.length > 4 && l.endsWith('ies') && `${l.slice(0, -3)}y` === s) return 2;
  if (x.length >= 5 && y.length >= 5 && x.slice(0, -1) === y.slice(0, -1) && VOWELS.includes(x.at(-1) as string) && VOWELS.includes(y.at(-1) as string)) {
    const ends = [x.at(-1), y.at(-1)].sort().join('');
    return ['io', 'ae', 'ei'].includes(ends) ? 2 : 1;
  }
  return 0;
}

/** Initials of the significant tokens of a name with at least two of them. */
export function acroOf(label: string): string | null {
  const sig = tokensOf(label).filter((t) => !STOP.has(t));
  return sig.length >= 2 ? sig.map((t) => t.charAt(0)).join('') : null;
}

const REGIONAL: Array<[RegExp, string]> = [
  [/isation/g, 'ization'],
  [/ise\b/g, 'ize'],
  [/yse\b/g, 'yze'],
  [/our/g, 'or'],
  [/tre\b/g, 'ter'],
  [/ll/g, 'l'],
];
const regional = (s: string): string => REGIONAL.reduce((acc, [re, to]) => acc.replace(re, to), s);

/** Damerau-Levenshtein (optimal string alignment) with an early bound. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2[j - 2] as number) + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n] as number;
}

/** cyrb53: a short stable id from a string. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const proposalId = (kind: string, tags: readonly string[]): string => `${kind}:${hash([...tags].sort().join('\u0000'))}`;

/* ------------------------------------------------------------------ the index */

export interface Index {
  nodes: ReviewNode[];
  byId: Map<string, ReviewNode>;
  /** tag -> documents (indexes into `docs`) carrying it directly. */
  docsOf: Map<string, Set<number>>;
  /** Roots (family or not) of every node. */
  rootOf: Map<string, string>;
  keywordIds: Set<string>;
  /** Id of each document, in the order `docsOf` indexes them. */
  docIds: string[];
}

export function buildIndex(input: ReviewInput): Index {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const docsOf = new Map<string, Set<number>>();
  input.docs.forEach((d, i) => {
    for (const t of new Set(d.tags)) {
      let s = docsOf.get(t);
      if (!s) docsOf.set(t, (s = new Set()));
      s.add(i);
    }
  });
  const rootOf = new Map<string, string>();
  const rootFor = (id: string): string => {
    const known = rootOf.get(id);
    if (known !== undefined) return known;
    let cur = id;
    const path: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const k = rootOf.get(cur);
      if (k !== undefined) {
        cur = k;
        break;
      }
      path.push(cur);
      const p = byId.get(cur)?.parents.find((x) => byId.has(x));
      if (p === undefined) break;
      cur = p;
    }
    for (const x of path) rootOf.set(x, cur);
    return cur;
  };
  for (const n of input.nodes) rootFor(n.id);
  const keywordIds = new Set<string>();
  for (const n of input.nodes) if (byId.get(rootOf.get(n.id) as string)?.family === 'keywords') keywordIds.add(n.id);
  return { nodes: [...input.nodes], byId, docsOf, rootOf, keywordIds, docIds: input.docs.map((d) => d.id) };
}

const countOf = (ix: Index, id: string): number => ix.docsOf.get(id)?.size ?? 0;

function overlap(ix: Index, a: string, b: string): { shared: number; jaccard: number } {
  const sa = ix.docsOf.get(a);
  const sb = ix.docsOf.get(b);
  if (!sa || !sb) return { shared: 0, jaccard: 0 };
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  let shared = 0;
  for (const d of small) if (big.has(d)) shared++;
  return { shared, jaccard: shared / (sa.size + sb.size - shared) };
}

const evidenceOf = (ix: Index, tags: readonly string[]): Evidence => {
  const papers: Record<string, number> = {};
  for (const t of tags) papers[t] = countOf(ix, t);
  let common: Set<number> | undefined;
  const union = new Set<number>();
  for (const t of tags) {
    const s = ix.docsOf.get(t) ?? new Set<number>();
    for (const d of s) union.add(d);
    const prev: Set<number> | undefined = common;
    common = prev === undefined ? new Set(s) : new Set([...prev].filter((d) => s.has(d)));
  }
  const shared = common?.size ?? 0;
  return { papers, shared, jaccard: union.size === 0 ? 0 : shared / union.size };
};

/* ------------------------------------------------------------------ pair rules */

export interface Pair {
  a: string;
  b: string;
  rule: string;
  confidence: Confidence;
}

const forms = (n: ReviewNode): string[] => [n.label, ...n.aliases];
const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Rules R1-R6 over the buckets of keys: only nodes that share a bucket are ever compared. */
export function namePairs(ix: Index, active: ReviewNode[], excluded: (a: string, b: string) => boolean): Pair[] {
  const out = new Map<string, Pair>();
  const rank: Record<Confidence, number> = { sure: 3, likely: 2, maybe: 1 };
  const put = (a: string, b: string, rule: string, confidence: Confidence): void => {
    if (a === b || excluded(a, b)) return;
    const k = pairKey(a, b);
    const old = out.get(k);
    if (!old || rank[confidence] > rank[old.confidence]) out.set(k, { a, b, rule, confidence });
  };
  const buckets = (keyOf: (n: ReviewNode) => string[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const n of active) for (const k of new Set(keyOf(n))) if (k) (m.get(k) ?? m.set(k, []).get(k) ?? []).push(n.id);
    return m;
  };
  const eachPair = (m: Map<string, string[]>, fn: (a: ReviewNode, b: ReviewNode) => void): void => {
    for (const ids of m.values()) {
      if (ids.length < 2 || ids.length > 300) continue;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) fn(ix.byId.get(ids[i] as string) as ReviewNode, ix.byId.get(ids[j] as string) as ReviewNode);
    }
  };
  const sameDigits = (a: ReviewNode, b: ReviewNode, fa: string, fb: string): boolean => digitsOf(fa) === digitsOf(fb) || a.id === b.id;

  // R6 alias collision and R1 form: bucket by the form key of every label and alias.
  const normLabel = new Map<string, string>();
  for (const n of active) normLabel.set(normalizeName(n.label), n.id);
  for (const n of active) {
    for (const al of n.aliases) {
      const owner = normLabel.get(normalizeName(al));
      if (owner !== undefined && owner !== n.id) put(owner, n.id, 'alias', 'sure');
    }
  }
  eachPair(
    buckets((n) => forms(n).map(formKey)),
    (a, b) => put(a.id, b.id, 'form', 'sure'),
  );

  // R2 plural: bucket by the stems; same number of tokens, each pair of tokens related.
  eachPair(
    buckets((n) => forms(n).map((f) => tokensOf(f).map(stemToken).join(' '))),
    (a, b) => {
      for (const fa of forms(a)) {
        for (const fb of forms(b)) {
          const ta = tokensOf(fa);
          const tb = tokensOf(fb);
          if (ta.length !== tb.length || formKey(fa) === formKey(fb)) continue;
          const rel = ta.map((t, i) => tokenRelation(t, tb[i] as string));
          if (rel.some((r) => r === 0)) continue;
          put(a.id, b.id, 'plural', rel.every((r) => r === 2) ? 'sure' : 'likely');
        }
      }
    },
  );

  // R2b joined stems ("pre-trained model" / "pretrained models", "data_set" / "datasets": the same letters once the plurals go) are
  // sure; the same words in another order or with other stop words ("transfer learning" / "learning transfer", "analysis of variance"
  // / "variance analysis", "A and B" / "A & B") are likely.
  const singular = (f: string): string[] => tokensOf(f).map(enSingular);
  const bag = (f: string): string => singular(f).filter((t) => !STOP.has(t)).sort().join(' ');
  eachPair(
    buckets((n) => forms(n).map((f) => singular(f).join(''))),
    (a, b) => put(a.id, b.id, 'plural', 'sure'),
  );
  eachPair(
    buckets((n) => forms(n).map(bag).filter((k) => k.includes(' '))),
    (a, b) => {
      for (const fa of forms(a)) for (const fb of forms(b)) if (bag(fa) === bag(fb) && bag(fa).includes(' ') && digitsOf(fa) === digitsOf(fb)) put(a.id, b.id, 'word-order', 'likely');
    },
  );

  // R3 acronym in the name: "X (S)" with another label equal to S or X.
  const byForm = new Map<string, string[]>();
  for (const n of active) for (const f of forms(n)) (byForm.get(formKey(f)) ?? byForm.set(formKey(f), []).get(formKey(f)) ?? []).push(n.id);
  for (const n of active) {
    for (const f of forms(n)) {
      const sp = splitAcronymName(f);
      if (!sp) continue;
      for (const k of [formKey(sp.acro), formKey(sp.name)]) for (const other of byForm.get(k) ?? []) put(n.id, other, 'acronym-in-name', 'sure');
    }
  }

  // R4 sigla <-> expansion: the initials of an expanded name equal a sigla. Only a node whose LABEL is the sigla (capitals, or one
  // short lower-case token as old keyword lists write them) is the sigla itself. A sigla met only as an alias, or as the "(S)" of
  // a node already named by another expansion, means two expansions that share an acronym ("Alpha learning" with the alias AL
  // against "ancient lore"): a maybe, never ticked (D-505).
  const siglas = new Map<string, Array<{ id: string; own: 'upper' | 'lower' | 'borrowed' }>>();
  const addSigla = (key: string, id: string, own: 'upper' | 'lower' | 'borrowed'): void => {
    (siglas.get(key) ?? siglas.set(key, []).get(key) ?? []).push({ id, own });
  };
  for (const n of active) {
    if (isSigla(n.label)) addSigla(formKey(n.label), n.id, 'upper');
    else if (pluralSigla(n.label)) addSigla(formKey(pluralSigla(n.label) as string), n.id, 'upper');
    else if (isLowerSigla(n.label)) addSigla(formKey(n.label), n.id, 'lower');
    else {
      for (const f of forms(n)) {
        const sp = splitAcronymName(f);
        if (isSigla(f)) addSigla(formKey(f), n.id, 'borrowed');
        else if (sp) addSigla(formKey(sp.acro), n.id, 'borrowed');
      }
    }
  }
  // A sigla whose initials fit two or more different expansions ("xy": two names with the initials x, y) is ambiguous: a maybe.
  // Expansions are told apart by their stemmed words, so "Delta zeta" and "Delta zetas (DZ)" are one expansion, not two.
  const expansions = new Map<string, Set<string>>();
  for (const n of active) {
    for (const f of forms(n)) {
      const base = splitAcronymName(f)?.name ?? f;
      const acro = acroOf(base);
      if (acro && acro.length >= 2) (expansions.get(acro) ?? expansions.set(acro, new Set()).get(acro))?.add(tokensOf(base).map(stemToken).join(' '));
    }
  }
  for (const n of active) {
    for (const f of forms(n)) {
      const base = splitAcronymName(f)?.name ?? f;
      const acro = acroOf(base);
      if (!acro || acro.length < 2) continue;
      const ambiguous = (expansions.get(acro)?.size ?? 0) >= 2;
      for (const { id: other, own } of siglas.get(acro) ?? []) {
        if (other === n.id) continue;
        if (ambiguous) {
          put(n.id, other, 'acronym-expansion', 'maybe');
          continue;
        }
        const o = ix.byId.get(other) as ReviewNode;
        const linked = overlap(ix, n.id, other).shared >= 1 || o.aliases.some((x) => normalizeName(x) === normalizeName(n.label)) || n.aliases.some((x) => normalizeName(x) === normalizeName(o.label));
        if (own === 'upper') put(n.id, other, 'acronym-expansion', linked ? 'sure' : 'likely');
        else if (own === 'lower') put(n.id, other, 'acronym-expansion', linked ? 'likely' : 'maybe');
        else put(n.id, other, 'acronym-expansion', 'maybe');
      }
    }
  }

  // R5 spelling: edit distance on the form key, inside the bucket of the first 3 letters, comparing only keys whose length differs by at most 2.
  const spell = new Map<string, Array<{ id: string; f: string }>>();
  for (const n of active) {
    for (const f of new Set(forms(n).map(formKey))) {
      if (f.length >= 6) (spell.get(f.slice(0, 3)) ?? spell.set(f.slice(0, 3), []).get(f.slice(0, 3)) ?? []).push({ id: n.id, f });
    }
  }
  for (const entries of spell.values()) {
    if (entries.length < 2) continue;
    entries.sort((x, y) => x.f.length - y.f.length || (x.f < y.f ? -1 : 1));
    for (let i = 0; i < entries.length; i++) {
      const { id: ia, f: fa } = entries[i] as { id: string; f: string };
      for (let j = i + 1, tried = 0; j < entries.length && tried < 400; j++, tried++) {
        const { id: ib, f: fb } = entries[j] as { id: string; f: string };
        if (fb.length - fa.length > 2) break;
        if (ia === ib || fa === fb) continue;
        const a = ix.byId.get(ia) as ReviewNode;
        const b = ix.byId.get(ib) as ReviewNode;
        if (!sameDigits(a, b, fa, fb)) continue;
        const max = Math.min(fa.length, fb.length) >= 12 ? 2 : 1;
        const regionalSame = regional(fa) === regional(fb);
        if (distance(fa, fb, max) > max && !regionalSame) continue;
        // One short token that differs ("model a" / "model b") is a different thing, not a misspelling.
        const ta = tokensOf(a.label);
        const tb = tokensOf(b.label);
        if (!regionalSame && ta.length === tb.length) {
          const at = ta.findIndex((t, x) => t !== tb[x]);
          const diff = ta.filter((t, x) => t !== tb[x]);
          if (diff.length === 1 && Math.max(diff[0]?.length ?? 0, (tb[at] ?? '').length) <= 2) continue;
        }
        // A long word with one letter off ("reinforcment") or a long one-word regional spelling ("modelling") is a likely slip even
        // with no paper in common; the rest wait for evidence.
        const oneWord = ta.length === 1 && tb.length === 1 && Math.min(fa.length, fb.length) >= 8;
        const diffs = ta.map((t, x) => [t, tb[x] ?? ''] as const).filter(([t, u]) => t !== u);
        const slip = !regionalSame && ta.length === tb.length && diffs.length === 1 && Math.min((diffs[0] as readonly [string, string])[0].length, (diffs[0] as readonly [string, string])[1].length) >= 8 && distance(fa, fb, 1) <= 1;
        put(ia, ib, 'spelling', overlap(ix, ia, ib).jaccard >= 0.5 || slip || (regionalSame && oneWord) ? 'likely' : 'maybe');
      }
    }
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ concepts */

interface Concept {
  members: string[];
  rules: Set<string>;
  confidence: Confidence;
}

function concepts(pairs: Pair[]): { concepts: Concept[]; loose: Pair[] } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  const strong = pairs.filter((p) => p.confidence !== 'maybe');
  for (const p of strong) {
    if (!parent.has(p.a)) parent.set(p.a, p.a);
    if (!parent.has(p.b)) parent.set(p.b, p.b);
    parent.set(find(p.a), find(p.b));
  }
  const groups = new Map<string, Concept>();
  for (const p of strong) {
    const r = find(p.a);
    const g = groups.get(r) ?? groups.set(r, { members: [], rules: new Set(), confidence: 'sure' }).get(r);
    if (!g) continue;
    for (const m of [p.a, p.b]) if (!g.members.includes(m)) g.members.push(m);
    g.rules.add(p.rule);
    if (p.confidence === 'likely') g.confidence = 'likely';
  }
  const inGroup = (x: string): string | undefined => (parent.has(x) ? find(x) : undefined);
  const loose = pairs.filter((p) => p.confidence === 'maybe' && !(inGroup(p.a) !== undefined && inGroup(p.a) === inGroup(p.b)));
  return { concepts: [...groups.values()], loose };
}

/** The survivor of a group of variants and the label it should end with (§19.1.3 "Concetti"). */
export function chooseCanonical(ix: Index, members: readonly string[]): { keep: string; label?: string } {
  const nodes = members.map((m) => ix.byId.get(m) as ReviewNode);
  const sigla = nodes.filter((n) => isSigla(n.label));
  const named = nodes.filter((n) => splitAcronymName(n.label) !== null);
  const plain = nodes.filter((n) => !isSigla(n.label) && splitAcronymName(n.label) === null);
  const pluralish = (n: ReviewNode): number => {
    const last = tokensOf(n.label).at(-1) ?? '';
    return /(?:[^su]s|[^i]i)$/.test(last) && last.length > 3 ? 1 : 0;
  };
  const order = (a: ReviewNode, b: ReviewNode): number =>
    countOf(ix, b.id) - countOf(ix, a.id) ||
    pluralish(a) - pluralish(b) ||
    tokensOf(b.label).length - tokensOf(a.label).length ||
    Number(a.label.includes('_')) - Number(b.label.includes('_')) ||
    (a.id < b.id ? -1 : 1);
  if (sigla.length > 0 || named.length > 0) {
    const acro = (named[0] ? splitAcronymName(named[0].label)?.acro : undefined) ?? sigla[0]?.label ?? '';
    const full = [...named].sort(order)[0];
    if (full) return { keep: full.id, ...(conventionName(full.label) !== full.label ? { label: conventionName(full.label) } : {}) };
    const ext = [...plain].filter((n) => tokensOf(n.label).length >= 2).sort(order)[0];
    if (ext) return { keep: ext.id, label: `${conventionName(ext.label)} (${acro.toUpperCase()})` };
  }
  const best = [...(plain.length > 0 ? plain : nodes)].sort(order)[0] as ReviewNode;
  return { keep: best.id, ...(conventionName(best.label) !== best.label ? { label: conventionName(best.label) } : {}) };
}

/* ------------------------------------------------------------------ merge operations */

/** Operations that merge `members` into `keep` and leave it with the label `label` and every old name as an alias. */
export function mergeOps(nodes: ReadonlyArray<Pick<ReviewNode, 'id' | 'label' | 'aliases'>>, members: readonly string[], keep: string, label?: string): TaxonomyOp[] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const ops: TaxonomyOp[] = [];
  const names: string[] = [];
  for (const m of members) {
    const n = by.get(m);
    if (n) names.push(n.label, ...n.aliases);
  }
  for (const m of members) if (m !== keep) ops.push({ op: 'merge', from: m, into: keep });
  const target = label ?? by.get(keep)?.label ?? '';
  if (label !== undefined && label !== by.get(keep)?.label) ops.push({ op: 'rename', id: keep, label });
  const aliases = [...new Set(names)].filter((a) => normalizeName(a) !== normalizeName(target));
  if (aliases.length > 0) ops.push({ op: 'setAliases', id: keep, aliases: aliases.slice(0, 200) });
  return ops;
}

/* ------------------------------------------------------------------ author names used as tags */

/** `surname initial` keys of the authors of each document, normalised: "Doe, Jane Q." and "Jane Q. Doe" give `doe j` and `doe jq`. */
function authorKeysOf(docs: readonly ReviewDoc[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const d of docs) {
    const keys = new Set<string>();
    for (const a of d.authors ?? []) {
      const comma = a.indexOf(',');
      const words = a.trim().split(/\s+/);
      // "Surname I. J." (initials after the surname, as many metadata sources write it): the surname comes first (D-509).
      const initialsLast = comma < 0 && words.length >= 2 && words.slice(1).every((w) => /^(\p{L}\.?)(-?\p{L}\.?){0,2}$/u.test(w) && (w.includes('.') || /^\p{Lu}{1,2}$/u.test(w)));
      const surname = comma >= 0 ? a.slice(0, comma) : initialsLast ? (words[0] ?? '') : (words.at(-1) ?? '');
      const given = comma >= 0 ? a.slice(comma + 1) : initialsLast ? words.slice(1).join(' ') : words.slice(0, -1).join(' ');
      const s = tokensOf(surname).join('');
      const initials = tokensOf(given.replace(/-/g, ' ')).map((t) => t.charAt(0));
      if (s.length < 2 || initials.length === 0) continue;
      keys.add(`${s} ${initials[0]}`);
      keys.add(`${s} ${initials.join('')}`);
    }
    out.set(d.id, keys);
  }
  return out;
}

/** The label of a tag that spells an author ("surname_j", "j surname") when most documents carrying it list that author (D-508). */
function authorTag(ix: Index, n: ReviewNode, keys: ReadonlyMap<string, ReadonlySet<string>>): string | null {
  // A surname (one or more words, "mendes-santos") with its initials before or after it ("cao_l_w", "j_doe") (D-509).
  const t = tokensOf(n.label);
  if (keys.size === 0 || t.length < 2 || t.length > 5 || t.some((x) => /\d/.test(x))) return null;
  const isInit = (x: string): boolean => x.length === 1;
  let cut = 0;
  while (cut < t.length && isInit(t[cut] as string)) cut++;
  let end = t.length;
  while (end > cut && isInit(t[end - 1] as string)) end--;
  const lead = t.slice(0, cut);
  const trail = t.slice(end);
  const name = t.slice(cut, end);
  const inits = lead.length > 0 && trail.length === 0 ? lead : trail.length > 0 && lead.length === 0 ? trail : null;
  const cand = inits && name.length > 0 && name.every((x) => !isInit(x)) ? `${name.join('')} ${inits.join('')}` : null;
  const carrying = [...(ix.docsOf.get(n.id) ?? [])];
  if (cand === null || carrying.length === 0) return null;
  const hit = carrying.filter((i) => keys.get(ix.docIds[i] as string)?.has(cand)).length;
  return hit / carrying.length >= 0.5 ? n.label : null;
}

/* ------------------------------------------------------------------ the detector */

const STATUS_WORDS = new Map<string, string>([
  ['preprint', 'preprint'],
  ['arxiv', 'preprint'],
  ['published', 'published'],
  ['in press', 'published'],
  ['accepted', 'published'],
  ['pubblicato', 'published'],
  ['in stampa', 'published'],
  ['accettato', 'published'],
]);

export interface ReviewResult {
  proposals: Proposal[];
  /** Nodes considered (active, not derived, not a family root). */
  considered: number;
  /** The fusion pairs found, for the health checks. */
  concepts: number;
}

export function reviewTags(input: ReviewInput): ReviewResult {
  const ix = buildIndex(input);
  const distinct = new Set((input.distinct ?? []).map((p) => pairKey(p.a, p.b)));
  const live = ix.nodes.filter((n) => n.status !== 'deprecated' && !n.id.startsWith('grp:'));
  const mergeable = live.filter((n) => n.family === undefined && !ix.keywordIds.has(n.id));
  const excluded = (a: string, b: string): boolean => distinct.has(pairKey(a, b));
  const proposals: Proposal[] = [];

  // --- fusions (R1-R6) -> concepts
  const pairs = namePairs(ix, mergeable, excluded);
  const nameLinked = new Set(pairs.map((p) => pairKey(p.a, p.b)));

  // --- R9 co-occurrence (a synonym?), only pairs that no name rule found
  const counts = new Map<string, Map<string, number>>();
  const twinKey = new Map<string, string>();
  for (const n of mergeable) {
    const s = ix.docsOf.get(n.id);
    if (s && s.size >= 2) twinKey.set(n.id, [...s].sort((x, y) => x - y).join(','));
  }
  const cooc = (): void => {
    const ids = new Set(mergeable.map((n) => n.id));
    for (const n of mergeable) {
      const s = ix.docsOf.get(n.id);
      if (!s || s.size < 3) continue;
      const c = new Map<string, number>();
      for (const d of s) for (const t of new Set(input.docs[d]?.tags ?? [])) if (t !== n.id && ids.has(t)) c.set(t, (c.get(t) ?? 0) + 1);
      counts.set(n.id, c);
    }
  };
  cooc();
  const extra: Pair[] = [];
  for (const [a, c] of counts) {
    for (const [b, shared] of c) {
      if (a >= b || shared < 3) continue;
      if (countOf(ix, a) === 0 || countOf(ix, b) === 0) continue;
      if (shared / countOf(ix, a) < 0.8 || shared / countOf(ix, b) < 0.8) continue;
      if (excluded(a, b) || nameLinked.has(pairKey(a, b))) continue;
      if (twinKey.get(a) !== undefined && twinKey.get(a) === twinKey.get(b)) continue; // identical sets are twins (R7)
      extra.push({ a, b, rule: 'cooccurrence', confidence: 'maybe' });
    }
  }
  const { concepts: cs, loose } = concepts([...pairs, ...extra]);
  for (const c of cs) {
    const { keep, label } = chooseCanonical(ix, c.members);
    proposals.push({ id: proposalId('merge', c.members), kind: 'merge', tags: [...c.members].sort(), keep, ...(label ? { label } : {}), confidence: c.confidence, reason: [...c.rules].sort().join(','), evidence: evidenceOf(ix, c.members) });
  }
  for (const p of loose) {
    const { keep, label } = chooseCanonical(ix, [p.a, p.b]);
    const ev = evidenceOf(ix, [p.a, p.b]);
    proposals.push({ id: proposalId('merge', [p.a, p.b]), kind: 'merge', tags: [p.a, p.b].sort(), keep, ...(label ? { label } : {}), confidence: 'maybe', reason: p.rule, evidence: ev });
  }
  const conceptOf = new Map<string, number>();
  cs.forEach((c, i) => c.members.forEach((m) => conceptOf.set(m, i)));

  // --- R7 twins: the same documents (at least two), any tag but a derived one
  const twinGroups = new Map<string, string[]>();
  for (const n of live) {
    if (n.family !== undefined) continue;
    const s = ix.docsOf.get(n.id);
    if (!s || s.size < 2) continue;
    const k = [...s].sort((x, y) => x - y).join(',');
    (twinGroups.get(k) ?? twinGroups.set(k, []).get(k) ?? []).push(n.id);
  }
  for (const ids of twinGroups.values()) {
    if (ids.length < 2) continue;
    const members = ids.filter((id, i) => ids.findIndex((o) => !excluded(o, id)) !== -1 || i === 0);
    const allOne = members.every((m) => conceptOf.get(m) !== undefined && conceptOf.get(m) === conceptOf.get(members[0] as string));
    if (allOne || members.every((m) => ix.keywordIds.has(m))) continue;
    let linked = false;
    for (let i = 0; i < members.length && !linked; i++) for (let j = i + 1; j < members.length; j++) if (nameLinked.has(pairKey(members[i] as string, members[j] as string))) linked = true;
    const action: 'merge' | 'keywords' = members.length >= 4 || !linked ? 'keywords' : 'merge';
    const { keep, label } = chooseCanonical(ix, members);
    proposals.push({ id: proposalId('twins', members), kind: 'twins', tags: [...members].sort(), keep, ...(label ? { label } : {}), confidence: 'likely', reason: 'twins', action, evidence: evidenceOf(ix, members) });
  }

  // --- R8 inclusion: "X" and "X something", or the documents of B are all documents of A
  const tokenIndex = new Map<string, string[]>();
  const stems = new Map<string, string[]>();
  for (const n of mergeable) {
    const st = [...new Set(tokensOf(n.label).map(stemToken))];
    stems.set(n.id, st);
    for (const t of st) (tokenIndex.get(t) ?? tokenIndex.set(t, []).get(t) ?? []).push(n.id);
  }
  const ancestors = (id: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(ix.byId.get(id)?.parents ?? [])];
    while (stack.length > 0) {
      const p = stack.pop() as string;
      if (seen.has(p)) continue;
      seen.add(p);
      stack.push(...(ix.byId.get(p)?.parents ?? []));
    }
    return seen;
  };
  const parentFound = new Map<string, { a: string; b: string; name: boolean; docs: boolean }>();
  const note = (a: string, b: string, key: 'name' | 'docs'): void => {
    const k = `${a}\u0000${b}`;
    const cur = parentFound.get(k) ?? { a, b, name: false, docs: false };
    cur[key] = true;
    parentFound.set(k, cur);
  };
  for (const b of mergeable) {
    const sb = stems.get(b.id) ?? [];
    if (sb.length < 2) continue;
    const seen = new Set<string>();
    for (const t of sb) {
      const cands = tokenIndex.get(t) ?? [];
      if (cands.length > 200) continue;
      for (const aId of cands) {
        if (aId === b.id || seen.has(aId)) continue;
        seen.add(aId);
        const sa = stems.get(aId) ?? [];
        if (sa.length < sb.length && sa.every((x) => sb.includes(x))) note(aId, b.id, 'name');
      }
    }
  }
  for (const b of mergeable) {
    const sbDocs = ix.docsOf.get(b.id);
    if (!sbDocs || sbDocs.size < 2) continue;
    const c = new Map<string, number>();
    for (const d of sbDocs) for (const t of new Set(input.docs[d]?.tags ?? [])) if (t !== b.id) c.set(t, (c.get(t) ?? 0) + 1);
    for (const [aId, n] of c) if (n === sbDocs.size && countOf(ix, aId) > sbDocs.size && ix.byId.has(aId) && mergeable.some((m) => m.id === aId)) note(aId, b.id, 'docs');
  }
  const idsOfMerge = new Set(mergeable.map((n) => n.id));
  for (const f of parentFound.values()) {
    if (!idsOfMerge.has(f.a) || excluded(f.a, f.b) || nameLinked.has(pairKey(f.a, f.b))) continue;
    if (conceptOf.get(f.a) !== undefined && conceptOf.get(f.a) === conceptOf.get(f.b)) continue;
    if (ancestors(f.b).has(f.a) || ancestors(f.a).has(f.b)) continue;
    if (twinKey.get(f.a) !== undefined && twinKey.get(f.a) === twinKey.get(f.b)) continue;
    proposals.push({ id: proposalId('parent', [f.a, f.b]), kind: 'parent', tags: [f.a, f.b], keep: f.a, confidence: f.name && f.docs ? 'likely' : 'maybe', reason: 'inclusion', evidence: evidenceOf(ix, [f.a, f.b]) });
  }

  // --- names that break the convention (not Keywords, not derived)
  for (const n of live) {
    if (n.family !== undefined || ix.keywordIds.has(n.id)) continue;
    const want = conventionName(n.label);
    if (want !== n.label) proposals.push({ id: proposalId('name', [n.id]), kind: 'name', tags: [n.id], keep: n.id, label: want, confidence: 'sure', reason: n.label.includes('_') ? 'underscore' : n.label.length > MAX_NAME ? 'long' : 'case', evidence: evidenceOf(ix, [n.id]) });
  }

  // --- metadata: tags that are a venue or a publication status
  const venueOf = new Map<string, string>();
  for (const v of input.venues ?? []) for (const x of [v.name, ...v.aliases]) venueOf.set(normalizeName(x), v.id);
  const authorKeys = authorKeysOf(input.docs);
  for (const n of live) {
    if (n.family !== undefined) continue;
    const author = authorTag(ix, n, authorKeys);
    if (author !== null) {
      proposals.push({ id: proposalId('metadata', [n.id]), kind: 'metadata', tags: [n.id], keep: n.id, confidence: 'likely', reason: 'author', meta: { field: 'author', value: author }, evidence: evidenceOf(ix, [n.id]) });
      continue;
    }
    for (const f of forms(n)) {
      const k = normalizeName(f);
      const venue = venueOf.get(k);
      const status = STATUS_WORDS.get(k);
      if (venue !== undefined || status !== undefined) {
        proposals.push({ id: proposalId('metadata', [n.id]), kind: 'metadata', tags: [n.id], keep: n.id, confidence: 'likely', reason: venue !== undefined ? 'venue' : 'status', meta: venue !== undefined ? { field: 'venue', value: venue } : { field: 'status', value: status as string }, evidence: evidenceOf(ix, [n.id]) });
        break;
      }
    }
  }

  // --- promotion (D-518): a loose tag ("To sort" or Keywords) used on max(3; 10 %) of the papers earns a place in a many-value family,
  // under the value that holds most of its papers relative to its size (the lift rule of the cleanup, step 4), at level 1-3 of the family.
  const need = Math.max(3, Math.ceil(input.docs.length * 0.1));
  const famRoots = live.filter((n) => n.family === 'many' && n.parents.length === 0);
  if (famRoots.length > 0) {
    const levelOf = (id: string): number => {
      let d = 0;
      for (let cur = id; d < 20; d++) {
        const p = ix.byId.get(cur)?.parents.find((x) => ix.byId.has(x));
        if (p === undefined) break;
        cur = p;
      }
      return d;
    };
    const hasKids = new Set(live.flatMap((n) => n.parents));
    const inFamily = live.filter((n) => n.family === undefined && ix.byId.get(ix.rootOf.get(n.id) as string)?.family === 'many');
    const biggest = [...famRoots].sort((a, b) => inFamily.filter((n) => ix.rootOf.get(n.id) === b.id).length - inFamily.filter((n) => ix.rootOf.get(n.id) === a.id).length || (a.id < b.id ? -1 : 1))[0] as ReviewNode;
    for (const n of live) {
      const root = ix.byId.get(ix.rootOf.get(n.id) as string);
      if (n.family !== undefined || hasKids.has(n.id) || (root?.family !== undefined && root.family !== 'keywords') || countOf(ix, n.id) < need) continue;
      const mine = countOf(ix, n.id);
      let best: { id: string; lift: number; size: number } | undefined;
      for (const c of inFamily) {
        if (levelOf(c.id) > 2) continue;
        const size = countOf(ix, c.id);
        const p = size === 0 ? 0 : overlap(ix, n.id, c.id).shared / mine;
        if (p < 0.5 || size === 0) continue;
        const lift = p / (size / Math.max(1, input.docs.length));
        if (!best || lift > best.lift || (lift === best.lift && (size < best.size || (size === best.size && c.id < best.id)))) best = { id: c.id, lift, size };
      }
      const parent = best?.id ?? biggest.id;
      proposals.push({ id: proposalId('promote', [parent, n.id]), kind: 'promote', tags: [parent, n.id], keep: parent, confidence: 'likely', reason: 'promote', evidence: evidenceOf(ix, [parent, n.id]) });
    }
  }

  const order: Record<Confidence, number> = { sure: 0, likely: 1, maybe: 2 };
  proposals.sort((a, b) => order[a.confidence] - order[b.confidence] || (a.id < b.id ? -1 : 1));
  return { proposals, considered: mergeable.length, concepts: cs.length };
}

/** `true` for the rules the guided cleanup applies in its first step (R1, R2, R3, R6; sure). */
export const isSureMerge = (p: Proposal): boolean => p.kind === 'merge' && p.confidence === 'sure';
