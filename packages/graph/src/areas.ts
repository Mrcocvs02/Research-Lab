/**
 * Macro-areas of the taxonomy and the share of each document in them (§18.3.4, D-483). Pure: no files, no Electron.
 * The Map colours its nodes by area; the main process runs this once per library state and ships integer triples.
 */

export interface AreaNode {
  id: string;
  label: string;
  parents: readonly string[];
  status?: string | undefined;
  /** The colour the user gave to the node (`#rrggbb`): it wins over the tint of the area (§18.3.4). */
  color?: string | undefined;
  /** Family of a root (`many`, `one`, `keywords`): a root with `many` is the Topic of the Map, whose level-1 children are the areas (D-572). */
  family?: string | undefined;
}
export interface AreaDoc {
  id: string;
  /** Tags of the document with their weight 0-1 (D-447; 1 for a tag without score, 0.9 / 0.5 for a pinned main / secondary). */
  tags: ReadonlyArray<{ id: string; w: number }>;
}
/** `[area index, branch index (-1: the tag is the area itself), share x 100]`. */
export type AreaTriple = [number, number, number];
export interface AreaShare {
  /** At most 3 triples, shares summing to 100. */
  ar: AreaTriple[];
  /** Centrality x 100. */
  az: number;
  /**
   * What the choice of the main area of the paper reads (D-569), for every area the paper reaches: `[area index, tag weight, depth of the deepest
   * tag, number of tags]`. The tag weight counts a tag that is the area itself (a generic tag) at half. Documents only: not shipped to the renderer.
   */
  rk?: Array<[number, number, number, number]>;
}
export interface AreaSummary {
  id: string;
  label: string;
  count: number;
  branches: Array<{ id: string; count: number }>;
  /** The user's colour of the area node, when it has one. */
  color?: string;
}
export interface AreaModel {
  areas: AreaSummary[];
  /** Documents with at least one area (the others have no entry). */
  docs: Map<string, AreaShare>;
  /** Documents with a known tag, and all documents given. */
  tagged: number;
  total: number;
  /** Share of a group of nodes (a topic, an author, a folder): see `groupShare`. */
  groupShare(docIds: Iterable<string>): AreaShare | null;
  /** Share of a tag node: its areas in equal parts, centrality 1. */
  tagShare(tagId: string): AreaShare | null;
}

const DESCENTS = 2;
const COVER = 0.8;
const Z_FULL = 1.2;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Top three shares rounded to integers that sum to 100 (largest remainder). */
function pack(entries: Array<{ a: number; b: number; p: number }>): AreaTriple[] {
  const top = entries.sort((x, y) => y.p - x.p || x.a - y.a).slice(0, 3);
  const sum = top.reduce((s, e) => s + e.p, 0);
  if (top.length === 0 || sum <= 0) return [];
  const raw = top.map((e) => (e.p / sum) * 100);
  const out = raw.map((v) => Math.floor(v));
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]![1]]!++;
  return top.map((e, i) => [e.a, e.b, out[i]!]);
}

export function computeAreas(nodes: readonly AreaNode[], docs: readonly AreaDoc[]): AreaModel {
  const live = new Map<string, AreaNode>();
  for (const n of nodes) if (n.status !== 'deprecated') live.set(n.id, n);
  const parentsOf = (id: string): string[] => (live.get(id)?.parents ?? []).filter((p) => live.has(p) && p !== id);
  const kids = new Map<string, string[]>();
  for (const n of live.values()) for (const p of parentsOf(n.id)) (kids.get(p) ?? kids.set(p, []).get(p)!).push(n.id);
  for (const k of kids.values()) k.sort(cmp);

  // Ancestors including the node itself (memoised; a cycle in a synced file ends where it repeats).
  const ancMemo = new Map<string, Set<string>>();
  const anc = (id: string): Set<string> => {
    let s = ancMemo.get(id);
    if (s) return s;
    s = new Set([id]);
    ancMemo.set(id, s);
    const stack = [...parentsOf(id)];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (s.has(p)) continue;
      s.add(p);
      stack.push(...parentsOf(p));
    }
    return s;
  };

  /** Depth of a node in the tree: 0 for a root, else 1 + the deepest parent (a cycle ends where it repeats). */
  const depthMemo = new Map<string, number>();
  const depth = (id: string, guard = 0): number => {
    const known = depthMemo.get(id);
    if (known !== undefined) return known;
    depthMemo.set(id, 0);
    const d = guard > 30 ? 0 : Math.max(-1, ...parentsOf(id).map((p) => depth(p, guard + 1))) + 1;
    depthMemo.set(id, d);
    return d;
  };

  // Documents with their known tags.
  const rows = docs.map((d) => {
    const w = new Map<string, number>();
    for (const t of d.tags) if (live.has(t.id)) w.set(t.id, Math.max(w.get(t.id) ?? 0, Math.min(1, Math.max(0, t.w))));
    return { id: d.id, w };
  });
  const withTags = rows.filter((r) => r.w.size > 0);
  const cover = (a: string): number => withTags.reduce((n, r) => n + ([...r.w.keys()].some((t) => anc(t).has(a)) ? 1 : 0), 0);

  // 1. Areas. With a Topic family root (a root with `family: 'many'`, §19.1.1) the areas are exactly its level-1 children that cover at least one
  // paper, whatever their coverage: a macro-area of the field is never replaced by its sub-areas (D-572); the other roots are loose tags (D-490).
  // Without one: the roots; a root that covers 80 % of the tagged documents gives way to its children (at most twice). When the taxonomy has a
  // hierarchy (two roots or more with children), a root without children is a loose tag, not an area: it colours a document only when none of
  // the document's tags reaches a real area (audit on real data, D-490).
  const roots = [...live.keys()].filter((id) => parentsOf(id).length === 0).sort(cmp);
  const topicRoot = roots
    .filter((id) => live.get(id)?.family === 'many')
    .sort((a, b) => (kids.get(b)?.length ?? 0) - (kids.get(a)?.length ?? 0) || cmp(a, b))
    .find((id) => (kids.get(id) ?? []).some((k) => cover(k) > 0));
  let loose: Set<string>;
  let set: string[];
  if (topicRoot !== undefined) {
    set = (kids.get(topicRoot) ?? []).filter((k) => cover(k) > 0);
    loose = new Set(roots.filter((id) => id !== topicRoot));
  } else {
    loose = new Set(roots.filter((id) => kids.has(id)).length >= 2 ? roots.filter((id) => !kids.has(id)) : []);
    set = roots.filter((id) => !loose.has(id));
    for (let round = 0; round < DESCENTS && withTags.length > 0; round++) {
      const next: string[] = [];
      let changed = false;
      for (const a of set) {
        const sub = (kids.get(a) ?? []).filter((k) => cover(k) > 0);
        if (sub.length >= 2 && (kids.get(a)?.length ?? 0) >= 2 && cover(a) / withTags.length >= COVER) {
          next.push(...sub);
          changed = true;
        } else next.push(a);
      }
      set = [...new Set(next)];
      if (!changed) break;
    }
  }
  const areaSet = new Set([...set, ...loose]);
  const branchOf = (area: string, x: string): string => (x === area ? '' : (kids.get(area) ?? []).find((c) => anc(x).has(c)) ?? '');

  // 2-3. Leaves of each document and the contributions to areas and branches.
  interface Row {
    id: string;
    m: Map<string, number>;
    br: Map<string, Map<string, number>>;
    /** Tag weight with a generic tag (the area itself) at half, depth of the deepest tag and number of tags, per area (D-569). */
    mw: Map<string, number>;
    dp: Map<string, number>;
    nt: Map<string, number>;
  }
  const per: Row[] = [];
  const areaDocs = new Map<string, number>();
  const branchDocs = new Map<string, Map<string, number>>();
  for (const r of withTags) {
    const ids = [...r.w.keys()];
    const ancestorOfOther = new Set<string>();
    for (const t of ids) for (const a of anc(t)) if (a !== t) ancestorOfOther.add(a);
    const row: Row = { id: r.id, m: new Map(), br: new Map(), mw: new Map(), dp: new Map(), nt: new Map() };
    // First the real areas; the loose roots only for a document that reaches none.
    for (const fallback of [false, true]) {
      if (fallback && (row.m.size > 0 || loose.size === 0)) break;
      for (const x of ids) {
        if (ancestorOfOther.has(x)) continue;
        const mine = [...anc(x)].filter((a) => areaSet.has(a) && loose.has(a) === fallback);
        if (mine.length === 0) continue;
        const c = r.w.get(x)! / mine.length;
        for (const a of mine) {
          row.m.set(a, (row.m.get(a) ?? 0) + c);
          row.mw.set(a, (row.mw.get(a) ?? 0) + (x === a ? c / 2 : c));
          row.dp.set(a, Math.max(row.dp.get(a) ?? 0, depth(x)));
          row.nt.set(a, (row.nt.get(a) ?? 0) + 1);
          const b = branchOf(a, x);
          const bm = row.br.get(a) ?? row.br.set(a, new Map()).get(a)!;
          bm.set(b, (bm.get(b) ?? 0) + c);
        }
      }
    }
    if (row.m.size === 0) continue;
    per.push(row);
    for (const a of row.m.keys()) {
      areaDocs.set(a, (areaDocs.get(a) ?? 0) + 1);
      const bd = branchDocs.get(a) ?? branchDocs.set(a, new Map()).get(a)!;
      for (const b of row.br.get(a)!.keys()) bd.set(b, (bd.get(b) ?? 0) + 1);
    }
  }
  const ordered = [...areaSet].filter((a) => areaDocs.has(a)).sort((a, b) => areaDocs.get(b)! - areaDocs.get(a)! || cmp(a, b));
  const areaIndex = new Map(ordered.map((a, i) => [a, i]));
  const branchIndex = new Map<string, Map<string, number>>();
  const areas: AreaSummary[] = ordered.map((a) => {
    const bd = [...(branchDocs.get(a) ?? [])].filter(([b]) => b !== '').sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]));
    branchIndex.set(a, new Map(bd.map(([b], i) => [b, i])));
    const color = live.get(a)?.color;
    return { id: a, label: live.get(a)?.label ?? a, count: areaDocs.get(a)!, branches: bd.map(([id, count]) => ({ id, count })), ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}) };
  });

  // 4-5. Shares, purity and centrality of every document.
  const out = new Map<string, AreaShare>();
  for (const row of per) {
    const M = [...row.m.values()].reduce((s, v) => s + v, 0);
    const entries = [...row.m].map(([a, m]) => {
      let best = '';
      let bv = -1;
      for (const [b, v] of row.br.get(a)!) if (v > bv || (v === bv && cmp(b, best) < 0)) (best = b, (bv = v));
      return { a: areaIndex.get(a)!, b: best === '' ? -1 : (branchIndex.get(a)!.get(best) ?? -1), p: m / M };
    });
    const rk = [...row.m.keys()].sort(cmp).map((a): [number, number, number, number] => [areaIndex.get(a)!, row.mw.get(a)!, row.dp.get(a)!, row.nt.get(a)!]);
    out.set(row.id, { ar: pack(entries), az: Math.round(Math.min(1, Math.max(...row.m.values()) / Z_FULL) * 100), rk });
  }

  const mean = (ids: Iterable<string>): AreaShare | null => {
    const acc = new Map<string, { a: number; b: number; p: number; votes: Map<number, number> }>();
    let n = 0;
    let z = 0;
    let all = 0;
    for (const id of ids) {
      all++;
      const s = out.get(id);
      if (!s) continue;
      n++;
      z += s.az;
      for (const [a, b, q] of s.ar) {
        const e = acc.get(String(a)) ?? acc.set(String(a), { a, b, p: 0, votes: new Map() }).get(String(a))!;
        e.p += q / 100;
        e.votes.set(b, (e.votes.get(b) ?? 0) + q);
      }
    }
    if (n === 0 || all === 0 || n / all < 0.3) return null;
    const entries = [...acc.values()].map((e) => {
      let b = e.b;
      let bv = -1;
      for (const [k, v] of e.votes) if (v > bv || (v === bv && k < b)) (b = k, (bv = v));
      return { a: e.a, b, p: e.p / n };
    });
    return { ar: pack(entries), az: Math.round((z / n) * (n / all)) };
  };

  return {
    areas,
    docs: out,
    tagged: withTags.length,
    total: docs.length,
    groupShare: mean,
    tagShare(tagId) {
      if (!live.has(tagId)) return null;
      const mine = [...anc(tagId)].filter((a) => areaIndex.has(a));
      if (mine.length === 0) return null;
      return { ar: pack(mine.map((a) => ({ a: areaIndex.get(a)!, b: branchIndex.get(a)!.get(branchOf(a, tagId)) ?? -1, p: 1 / mine.length }))), az: 100 };
    },
  };
}

/** The nodes without the keywords family (§19.1.1: keywords never reach the Map), D-505. */
export function withoutKeywords<T extends { id: string; parents: readonly string[]; family?: string | undefined }>(nodes: readonly T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, boolean>();
  const inKeywords = (id: string, depth = 0): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const n = byId.get(id);
    memo.set(id, false); // cycle guard
    const r = !!n && depth < 50 && (n.family === 'keywords' || n.parents.some((p) => inKeywords(p, depth + 1)));
    memo.set(id, r);
    return r;
  };
  return nodes.filter((n) => !inKeywords(n.id));
}

/**
 * The nodes the Topic areas are made of. Without families of the controlled vocabulary: every node but the keywords. With them:
 * only the biggest family that takes several values (the Topic of the cleanup); the other families (a generic value made a family of
 * its own, Method, ...) are offered by themselves in "Group by" and must not come back as areas of Topic (D-509).
 */
export function topicNodes<T extends { id: string; parents: readonly string[]; family?: string | undefined }>(nodes: readonly T[]): T[] {
  const kept = withoutKeywords(nodes);
  const roots = kept.filter((n) => n.parents.length === 0 && (n.family === 'many' || n.family === 'one'));
  if (roots.length < 2) return kept;
  const byId = new Map(kept.map((n) => [n.id, n]));
  const rootOf = (id: string): string | undefined => {
    let cur = byId.get(id);
    for (let i = 0; cur && cur.parents.length > 0 && i < 50; i++) cur = byId.get(cur.parents[0]!);
    return cur?.id;
  };
  const size = new Map<string, number>();
  for (const n of kept) {
    const r = rootOf(n.id);
    if (r !== undefined) size.set(r, (size.get(r) ?? 0) + 1);
  }
  const many = roots.filter((r) => r.family === 'many').sort((a, b) => (size.get(b.id) ?? 0) - (size.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1));
  const topic = many[0];
  if (!topic) return kept;
  const others = new Set(roots.filter((r) => r.id !== topic.id).map((r) => r.id));
  return kept.filter((n) => !others.has(rootOf(n.id) ?? ''));
}

/**
 * The values of a paper in the Topic as the blocks, the test and the preview read them: its areas with their share (`w`) and what the choice of the
 * main one reads (D-569: `mw`, `d`, `n`). `null` for a paper with no area. One definition for the Map and for `measureFamily`.
 */
export function areaValues(m: AreaModel, docId: string): Array<{ v: string; w: number; mw?: number; d?: number; n?: number }> | null {
  const sh = m.docs.get(docId);
  if (!sh || sh.ar.length === 0) return null;
  const rk = new Map((sh.rk ?? []).map((e) => [e[0], e]));
  return sh.ar.map(([a, , q]) => {
    const r = rk.get(a);
    return { v: m.areas[a]!.id, w: q, ...(r ? { mw: r[1], d: r[2], n: r[3] } : {}) };
  });
}
