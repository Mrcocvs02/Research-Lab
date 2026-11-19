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

  // Documents with their known tags.
  const rows = docs.map((d) => {
    const w = new Map<string, number>();
    for (const t of d.tags) if (live.has(t.id)) w.set(t.id, Math.max(w.get(t.id) ?? 0, Math.min(1, Math.max(0, t.w))));
    return { id: d.id, w };
  });
  const withTags = rows.filter((r) => r.w.size > 0);
  const cover = (a: string): number => withTags.reduce((n, r) => n + ([...r.w.keys()].some((t) => anc(t).has(a)) ? 1 : 0), 0);

  // 1. Areas: the roots; a root that covers 80 % of the tagged documents gives way to its children (at most twice).
  let set = [...live.keys()].filter((id) => parentsOf(id).length === 0).sort(cmp);
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
  const areaSet = new Set(set);
  const branchOf = (area: string, x: string): string => (x === area ? '' : (kids.get(area) ?? []).find((c) => anc(x).has(c)) ?? '');

  // 2-3. Leaves of each document and the contributions to areas and branches.
  interface Row {
    id: string;
    m: Map<string, number>;
    br: Map<string, Map<string, number>>;
  }
  const per: Row[] = [];
  const areaDocs = new Map<string, number>();
  const branchDocs = new Map<string, Map<string, number>>();
  for (const r of withTags) {
    const ids = [...r.w.keys()];
    const ancestorOfOther = new Set<string>();
    for (const t of ids) for (const a of anc(t)) if (a !== t) ancestorOfOther.add(a);
    const row: Row = { id: r.id, m: new Map(), br: new Map() };
    for (const x of ids) {
      if (ancestorOfOther.has(x)) continue;
      const mine = [...anc(x)].filter((a) => areaSet.has(a));
      if (mine.length === 0) continue;
      const c = r.w.get(x)! / mine.length;
      for (const a of mine) {
        row.m.set(a, (row.m.get(a) ?? 0) + c);
        const b = branchOf(a, x);
        const bm = row.br.get(a) ?? row.br.set(a, new Map()).get(a)!;
        bm.set(b, (bm.get(b) ?? 0) + c);
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
    out.set(row.id, { ar: pack(entries), az: Math.round(Math.min(1, Math.max(...row.m.values()) / Z_FULL) * 100) });
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
