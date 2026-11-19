import type { EntityEdge, EntityMode, EntityNode } from './entityTypes';

/** The playful parts that need no DOM: a seeded random generator, the shortest path, and the "Sorprendimi" choice per mode. */

/** Small seeded generator (mulberry32): "Mescola" and "Sorprendimi" are random but a test can fix the seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortest path (BFS) from `a` to `b` over `neighbors`; the keys from `a` to `b` included, or null when they are not connected. */
export function bfsPath(neighbors: (key: string) => Iterable<string>, a: string, b: string, limit = 5000): string[] | null {
  if (a === b) return [a];
  const prev = new Map<string, string>([[a, a]]);
  let frontier = [a];
  while (frontier.length > 0 && prev.size < limit) {
    const next: string[] = [];
    for (const k of frontier) {
      for (const m of neighbors(k)) {
        if (prev.has(m)) continue;
        prev.set(m, k);
        if (m === b) {
          const path = [b];
          for (let c = b; c !== a; ) {
            c = prev.get(c)!;
            path.push(c);
          }
          return path.reverse();
        }
        next.push(m);
      }
    }
    frontier = next;
  }
  return null;
}

/** What "Sorprendimi" found in an entity network: the two nodes and the numbers of the sentence. */
export interface Surprise {
  a: string;
  b: string;
  /** i18n key suffix and the numbers to say. */
  kind: EntityMode;
  n: number;
  extra?: number;
}

/** Same topic, never wrote together, many co-authors in common: "they might know each other". */
export function pickSurprise(nodes: readonly EntityNode[], edges: readonly EntityEdge[], rand: () => number): Surprise | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, new Set()).get(e.a)!).add(e.b);
    (adj.get(e.b) ?? adj.set(e.b, new Set()).get(e.b)!).add(e.a);
  }
  const scored: Array<{ s: number; v: Surprise }> = [];
  const linked = new Set(edges.map((e) => `${e.a}|${e.b}`));
  for (const [id, nb] of adj) {
    for (const other of nodes) {
      if (other.id <= id || linked.has(`${id}|${other.id}`) || linked.has(`${other.id}|${id}`)) continue;
      const a = byId.get(id);
      if (!a || a.colorKey !== other.colorKey) continue;
      const common = [...(adj.get(other.id) ?? [])].filter((x) => nb.has(x)).length;
      if (common >= 1) scored.push({ s: common, v: { a: id, b: other.id, kind: 'author', n: common } });
    }
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => y.s - x.s || (x.v.a < y.v.a ? -1 : 1));
  const top = scored.slice(0, Math.min(5, scored.length));
  return top[Math.floor(rand() * top.length)]!.v;
}
