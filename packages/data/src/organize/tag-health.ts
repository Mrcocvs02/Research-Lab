import { buildIndex, reviewTags, splitAcronymName, type Index, type Proposal, type ReviewInput } from './tag-review.js';

export type HealthKind = 'singletons' | 'dupes' | 'twins' | 'generic' | 'orphans' | 'multiparent' | 'onevalue' | 'styles' | 'metadata' | 'unused' | 'depth';

export interface HealthItem {
  kind: HealthKind;
  count: number;
  /** Past the threshold of §19.1.4 ("da guardare"); below it the chip is neutral. */
  flagged: boolean;
  /** The tags (or, for `onevalue`, the documents) behind the count, at most 200, so a click can filter the list. */
  ids: string[];
}

export interface HealthStats {
  tags: number;
  singletons: number;
  dupeConcepts: number;
  orphans: number;
  maxDepth: number;
}

const CAP = 200;
export const GENERIC_MIN_DOCS = 10;

/** One naming style per tag: underscore, "Name (ACR)", lower case, capitalised, other. */
export function nameStyle(label: string): string {
  if (label.includes('_')) return 'underscore';
  if (splitAcronymName(label)) return 'acronym';
  const c = label.charAt(0);
  if (c !== c.toUpperCase() && c === c.toLowerCase() && /\p{L}/u.test(c)) return 'lower';
  if (c !== c.toLowerCase()) return 'capitalized';
  return 'other';
}

function depthMap(ix: Index): Map<string, number> {
  const memo = new Map<string, number>();
  const go = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, 0); // cycle guard
    const ps = (ix.byId.get(id)?.parents ?? []).filter((p) => ix.byId.has(p));
    const d = ps.length === 0 ? 0 : 1 + Math.max(...ps.map(go));
    memo.set(id, d);
    return d;
  };
  for (const n of ix.nodes) go(n.id);
  return memo;
}

/** The ten-odd checks of the vocabulary health strip (§19.1.4). Pure. `proposals` may be passed to avoid a second detection. */
export function tagHealth(input: ReviewInput, proposals?: readonly Proposal[]): HealthItem[] {
  const ix = buildIndex(input);
  const props = proposals ?? reviewTags(input).proposals;
  const live = ix.nodes.filter((n) => n.status !== 'deprecated' && !n.id.startsWith('grp:'));
  const plain = live.filter((n) => n.family === undefined && !ix.keywordIds.has(n.id));
  const nDocs = input.docs.length;
  const direct = (id: string): number => ix.docsOf.get(id)?.size ?? 0;
  const out: HealthItem[] = [];
  const add = (kind: HealthKind, ids: string[], flagged: boolean, count = ids.length): void => void out.push({ kind, count, flagged, ids: ids.slice(0, CAP) });

  const single = plain.filter((n) => direct(n.id) === 1).map((n) => n.id);
  add('singletons', single, plain.length > 0 && single.length / plain.length > 0.25);

  const merges = props.filter((p) => p.kind === 'merge' && p.confidence !== 'maybe');
  add('dupes', merges.map((p) => p.id), merges.length > 0);

  const twins = props.filter((p) => p.kind === 'twins' && !p.tags.some((t) => ix.keywordIds.has(t)));
  add('twins', twins.map((p) => p.id), twins.length > 0);

  const generic = nDocs >= GENERIC_MIN_DOCS ? plain.filter((n) => direct(n.id) / nDocs > 0.5).map((n) => n.id) : [];
  add('generic', generic, generic.length > 0);

  const orphans = plain.filter((n) => ix.byId.get(ix.rootOf.get(n.id) as string)?.family === undefined).map((n) => n.id);
  add('orphans', orphans, orphans.length > 0);

  const multi = live.filter((n) => n.parents.length >= 2).map((n) => n.id);
  add('multiparent', multi, multi.length > 0);

  // Documents with two or more values (level-1 nodes) of one family that takes a single value.
  const depth = depthMap(ix);
  const valueOf = (id: string): string | undefined => {
    let cur = id;
    for (let i = 0; i < 1000; i++) {
      if ((depth.get(cur) ?? 0) <= 1) return cur;
      const p = ix.byId.get(cur)?.parents.find((x) => ix.byId.has(x));
      if (p === undefined) return cur;
      cur = p;
    }
    return cur;
  };
  const bad = new Set<string>();
  for (const d of input.docs) {
    const perFamily = new Map<string, Set<string>>();
    for (const t of d.tags) {
      const root = ix.rootOf.get(t);
      if (root === undefined || root === t || ix.byId.get(root)?.family !== 'one') continue;
      const v = valueOf(t);
      if (v !== undefined) (perFamily.get(root) ?? perFamily.set(root, new Set()).get(root))?.add(v);
    }
    if ([...perFamily.values()].some((s) => s.size >= 2)) bad.add(d.id);
  }
  add('onevalue', [...bad], bad.size > 0);

  // "Extended name (ACR)" with a capital initial is the convention itself (§19.1.1), not a second style (D-505).
  const styles = new Set(plain.map((n) => (nameStyle(n.label) === 'acronym' && /^\p{Lu}/u.test(n.label) ? 'capitalized' : nameStyle(n.label))));
  add('styles', [...styles], styles.size > 1, styles.size);

  const meta = props.filter((p) => p.kind === 'metadata').map((p) => p.tags[0] as string);
  add('metadata', meta, meta.length > 0);

  const hasChild = new Set(ix.nodes.flatMap((n) => n.parents));
  const implied = new Set<string>();
  for (const n of input.nodes as ReadonlyArray<{ implies?: readonly string[] }>) for (const i of n.implies ?? []) implied.add(i);
  const unused = live.filter((n) => n.family === undefined && direct(n.id) === 0 && !hasChild.has(n.id) && !implied.has(n.id)).map((n) => n.id);
  add('unused', unused, unused.length > 0);

  // The largest `many` family: its deepest level against its size.
  let best: { size: number; depth: number } | null = null;
  for (const r of live.filter((n) => n.family === 'many')) {
    const members = live.filter((n) => ix.rootOf.get(n.id) === r.id && n.id !== r.id);
    const d = Math.max(0, ...members.map((n) => depth.get(n.id) ?? 0));
    if (!best || members.length > best.size) best = { size: members.length, depth: d };
  }
  add('depth', [], best !== null && best.depth < 2 && best.size > 12, best?.depth ?? 0);
  return out;
}

/** Before/after figures of the cleanup summary. */
export function tagStats(input: ReviewInput): HealthStats {
  const h = tagHealth(input);
  const get = (k: HealthKind): HealthItem => h.find((x) => x.kind === k) as HealthItem;
  const ix = buildIndex(input);
  const depth = depthMap(ix);
  return {
    tags: input.nodes.filter((n) => n.status !== 'deprecated' && !n.id.startsWith('grp:') && n.family === undefined).length,
    singletons: get('singletons').count,
    dupeConcepts: get('dupes').count,
    orphans: get('orphans').count,
    maxDepth: Math.max(0, ...[...depth.values()]),
  };
}
