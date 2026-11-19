/**
 * Grouping families of the Map (D-489, section 18.3.7). A family is a set of tags of one kind (the topic macro-areas, the nodes of one
 * level such as "method", a taxonomy group hint, an id prefix such as `grp:` for research groups) or the communities found in the
 * network itself ("auto"). Its clusters are the top-level values; the biggest `FAMILY_TOP` (7, one per palette tint) are kept, the rest become one "other"
 * cluster. The result has the shape of `AreaModel`, so colours, legend and hover cards reuse the macro-area machinery. Pure.
 */
import { computeAreas, type AreaDoc, type AreaModel, type AreaNode } from './areas.js';
import { louvain, symmetrize } from './cluster.js';
import type { Edge } from './types.js';

export const FAMILY_TOP = 7;
/** Id of the cluster that gathers the clusters beyond the biggest eight. */
export const OTHER_CLUSTER = '__other';

export type FamilyKind = 'topic' | 'level' | 'group' | 'prefix' | 'auto';
export interface FamilyRef {
  kind: FamilyKind;
  value: string;
}
/** `topic`, `auto`, `level:method`, `group:extra:x`, `prefix:grp:`. Unknown text is the topic family. */
export function parseFamily(id: string): FamilyRef {
  if (id === 'auto') return { kind: 'auto', value: '' };
  for (const k of ['level', 'group', 'prefix'] as const) if (id.startsWith(`${k}:`) && id.length > k.length + 1) return { kind: k, value: id.slice(k.length + 1) };
  return { kind: 'topic', value: '' };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Cluster ids with their labels and the weighted membership of each document (documents with none are absent). */
export interface Memberships {
  labels: Map<string, string>;
  docs: Map<string, Array<{ cluster: string; w: number }>>;
}
export type FamilyNode = AreaNode & { level?: string | undefined; group?: string | undefined };

/** Memberships of a tag family: `level:x` (nodes of that level), `group:x` (nodes with that group hint), `prefix:p` (tag ids starting with p, label = the rest). */
export function tagMemberships(ref: FamilyRef, nodes: readonly FamilyNode[], docs: readonly AreaDoc[]): Memberships {
  const live = new Map<string, FamilyNode>();
  for (const n of nodes) if (n.status !== 'deprecated') live.set(n.id, n);
  const prefix = ref.kind === 'prefix';
  const member = (id: string): boolean => (prefix ? id.startsWith(ref.value) : ref.kind === 'level' ? live.get(id)?.level === ref.value : live.get(id)?.group === ref.value);
  const parentsOf = (id: string): string[] => (prefix ? [] : (live.get(id)?.parents ?? []).filter((p) => live.has(p) && p !== id));
  /** Members among the ancestors of `id` (itself included). */
  const above = (id: string): string[] => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...parentsOf(x));
    }
    return [...seen].filter(member);
  };
  const memo = new Map<string, string[]>();
  /** The top-level members of a tag: those with no member above them. */
  const topsOf = (id: string): string[] => {
    let r = memo.get(id);
    if (!r) {
      const ms = above(id);
      r = ms.filter((m) => above(m).length === 1).sort(cmp);
      // A cycle of members has no top: the smallest id stands for it.
      if (r.length === 0 && ms.length > 0) r = [ms.sort(cmp)[0]!];
      memo.set(id, r);
    }
    return r;
  };
  const labels = new Map<string, string>();
  const out = new Map<string, Array<{ cluster: string; w: number }>>();
  for (const d of docs) {
    const acc = new Map<string, number>();
    for (const t of d.tags) {
      if (!prefix && !live.has(t.id)) continue;
      const own = topsOf(t.id);
      for (const c of own) acc.set(c, Math.min(1, (acc.get(c) ?? 0) + t.w / own.length));
    }
    if (acc.size === 0) continue;
    for (const c of acc.keys()) if (!labels.has(c)) labels.set(c, prefix ? c.slice(ref.value.length) : (live.get(c)?.label ?? c));
    out.set(d.id, [...acc].map(([cluster, w]) => ({ cluster, w })));
  }
  return { labels, docs: out };
}

/**
 * Communities of the weighted network (Louvain, seeded) over `ids`, each labelled by its most distinctive recurring tags
 * (TF-IDF: the share of the members that carry the tag times log(N / documents with the tag)). Communities of fewer than two
 * documents are left out; a community with no recurring tag is called "<fallback> k".
 */
export function autoMemberships(ids: readonly string[], edges: ReadonlyArray<{ a: number; b: number; w: number }>, tagsOf: (docIndex: number) => readonly string[], tagLabel: (tag: string) => string, fallback: string, seed = 1): Memberships {
  const n = ids.length;
  const comm = n === 0 ? new Int32Array(0) : louvain(n, symmetrize(edges.filter((e) => e.a !== e.b && e.w > 0).map((e): Edge => ({ a: e.a, b: e.b, w: e.w }))), seed);
  const members = new Map<number, number[]>();
  comm.forEach((c, i) => (members.get(c) ?? members.set(c, []).get(c)!).push(i));
  const df = new Map<string, number>();
  for (let i = 0; i < n; i++) for (const t of new Set(tagsOf(i))) df.set(t, (df.get(t) ?? 0) + 1);
  const big = [...members.values()].filter((m) => m.length >= 2).sort((x, y) => y.length - x.length || x[0]! - y[0]!);
  const labels = new Map<string, string>();
  const docs = new Map<string, Array<{ cluster: string; w: number }>>();
  big.forEach((m, k) => {
    const id = `auto:${k}`;
    const tf = new Map<string, number>();
    for (const i of m) for (const t of new Set(tagsOf(i))) tf.set(t, (tf.get(t) ?? 0) + 1);
    const top = [...tf]
      .filter(([t, c]) => c >= 2 && c / m.length >= 0.3 && (df.get(t) ?? 0) < n)
      .map(([t, c]) => ({ t, s: (c / m.length) * Math.log(n / (df.get(t) ?? 1)) }))
      .sort((x, y) => y.s - x.s || cmp(x.t, y.t))
      .slice(0, 2);
    labels.set(id, top.length > 0 ? top.map((x) => tagLabel(x.t)).join(' · ') : `${fallback} ${k + 1}`);
    for (const i of m) docs.set(ids[i]!, [{ cluster: id, w: 1 }]);
  });
  return { labels, docs };
}

/** The `AreaModel` of a set of memberships: the biggest `FAMILY_TOP` clusters, the rest as `OTHER_CLUSTER` labelled `otherLabel`. `total` counts every document of the scope. */
export function familyModel(m: Memberships, total: number, otherLabel: string, colors?: ReadonlyMap<string, string>): AreaModel {
  const count = new Map<string, number>();
  for (const list of m.docs.values()) for (const e of list) count.set(e.cluster, (count.get(e.cluster) ?? 0) + 1);
  const keep = new Set([...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || cmp(a, b)).slice(0, FAMILY_TOP));
  const nodes: AreaNode[] = [...keep].map((id) => ({ id, label: m.labels.get(id) ?? id, parents: [], color: colors?.get(id) }));
  if (keep.size < count.size) nodes.push({ id: OTHER_CLUSTER, label: otherLabel, parents: [] });
  const docs: AreaDoc[] = [];
  for (const [id, list] of m.docs) {
    const acc = new Map<string, number>();
    for (const e of list) {
      const c = keep.has(e.cluster) ? e.cluster : OTHER_CLUSTER;
      acc.set(c, Math.min(1, (acc.get(c) ?? 0) + e.w));
    }
    docs.push({ id, tags: [...acc].map(([id2, w]) => ({ id: id2, w })) });
  }
  const model = computeAreas(nodes, docs);
  return { ...model, total: Math.max(total, model.total) };
}
