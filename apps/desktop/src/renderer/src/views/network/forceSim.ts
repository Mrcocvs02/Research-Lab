import { hash01 } from './geometry';

/** The expandable network: nodes, edges and a tiny incremental force simulation (no graph library). */
export type NodeKind = 'doc' | 'folder' | 'tag';
export type EdgeKind = 'similar' | 'cites' | 'tagged' | 'contains';

export interface NetNode {
  /** Unique key `kind:id`. */
  key: string;
  kind: NodeKind;
  id: string;
  label: string;
  count?: number | undefined;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0..1: how far the simulation may move the node. New nodes are free, the nodes already there almost stay. */
  mobility: number;
  expanded: boolean;
  /** Key of the node whose expansion brought this one (null for a start node). */
  via: string | null;
  /** Held by the pointer. */
  pinned: boolean;
}

export interface NetEdge {
  a: string;
  b: string;
  kind: EdgeKind;
  weight: number;
}

export interface RawNode {
  kind: NodeKind;
  id: string;
  label: string;
  count?: number | undefined;
}
export interface RawEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
}

export const MAX_NET_NODES = 800;
const REST = 70;
const OLD_MOBILITY = 0.04;

export const keyOf = (kind: NodeKind, id: string): string => `${kind}:${id}`;

const makeNode = (r: RawNode, via: string | null): NetNode => ({ key: keyOf(r.kind, r.id), kind: r.kind, id: r.id, label: r.label, count: r.count, x: 0, y: 0, vx: 0, vy: 0, mobility: 1, expanded: false, via, pinned: false });

export class Network {
  nodes = new Map<string, NetNode>();
  edges: NetEdge[] = [];
  private edgeSet = new Set<string>();
  /** Bumps when nodes or edges change. */
  version = 0;
  /** Remaining simulation ticks; 0 when settled. */
  heat = 0;

  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.edgeSet.clear();
    this.heat = 0;
    this.version++;
  }

  get size(): number {
    return this.nodes.size;
  }

  private add(n: NetNode): void {
    this.nodes.set(n.key, n);
  }

  /** A start node (the first one, or another one next to those already there). */
  seed(raw: RawNode): NetNode {
    const existing = this.nodes.get(keyOf(raw.kind, raw.id));
    if (existing) return existing;
    const n = makeNode(raw, null);
    if (this.nodes.size > 0) {
      const a = hash01(n.key) * Math.PI * 2;
      n.x = Math.cos(a) * REST * 3;
      n.y = Math.sin(a) * REST * 3;
    }
    this.add(n);
    this.version++;
    this.heat = Math.max(this.heat, 60);
    return n;
  }

  /**
   * Adds what the expansion of `from` returned. New nodes are placed on an arc around `from`, opening away from the rest
   * of the network; the nodes already there keep their place (they only give way a little while the new ones settle).
   * Nodes past `MAX_NET_NODES` are not added.
   */
  expand(from: NetNode, rawNodes: readonly RawNode[], rawEdges: readonly RawEdge[]): { added: number; capped: boolean } {
    from.expanded = true;
    const fresh: NetNode[] = [];
    let capped = false;
    for (const r of rawNodes) {
      if (this.nodes.has(keyOf(r.kind, r.id))) continue;
      if (this.nodes.size + fresh.length >= MAX_NET_NODES) {
        capped = true;
        break;
      }
      fresh.push(makeNode(r, from.key));
    }
    let gx = 0;
    let gy = 0;
    for (const n of this.nodes.values()) {
      gx += n.x;
      gy += n.y;
    }
    const m = Math.max(this.nodes.size, 1);
    const lone = this.nodes.size <= 1 || (Math.abs(from.x - gx / m) < 1 && Math.abs(from.y - gy / m) < 1);
    const base = lone ? hash01(from.key) * Math.PI * 2 : Math.atan2(from.y - gy / m, from.x - gx / m);
    const radius = REST * (1 + Math.min(fresh.length, 60) / 40);
    fresh.forEach((n, i) => {
      const a = lone ? base + (i / fresh.length) * Math.PI * 2 : base + (fresh.length === 1 ? 0 : i / fresh.length - 0.5) * Math.PI * 1.4;
      n.x = from.x + Math.cos(a) * radius;
      n.y = from.y + Math.sin(a) * radius;
      this.add(n);
    });
    for (const e of rawEdges) {
      // Edge ends are node keys `<kind>:<id>` (contract of graph:neighbors).
      const a = this.nodes.get(e.from);
      const b = this.nodes.get(e.to);
      if (!a || !b || a === b) continue;
      const k = `${a.key}|${b.key}|${e.kind}`;
      if (this.edgeSet.has(k)) continue;
      this.edgeSet.add(k);
      this.edges.push({ a: a.key, b: b.key, kind: e.kind, weight: e.weight });
    }
    const freshSet = new Set(fresh);
    for (const n of this.nodes.values()) n.mobility = freshSet.has(n) ? 1 : OLD_MOBILITY;
    this.version++;
    this.heat = fresh.length > 0 ? 90 : 0;
    return { added: fresh.length, capped };
  }

  private removeKeys(keys: Set<string>): void {
    for (const k of keys) {
      this.nodes.delete(k);
    }
    this.edges = this.edges.filter((e) => !keys.has(e.a) && !keys.has(e.b));
    this.edgeSet = new Set(this.edges.map((e) => `${e.a}|${e.b}|${e.kind}`));
    this.version++;
  }

  /** Removes what the expansion of `key` brought (recursively) and marks the node as not expanded. */
  collapse(key: string): number {
    const root = this.nodes.get(key);
    if (!root) return 0;
    const doomed = new Set<string>();
    const queue = [key];
    while (queue.length > 0) {
      const k = queue.pop()!;
      for (const n of this.nodes.values()) {
        if (n.via === k && n.key !== key && !doomed.has(n.key)) {
          doomed.add(n.key);
          queue.push(n.key);
        }
      }
    }
    root.expanded = false;
    this.removeKeys(doomed);
    return doomed.size;
  }

  /** Removes one node and its edges; nodes left without any edge go too (a lone start node stays). */
  remove(key: string): void {
    this.removeKeys(new Set([key]));
    const linked = new Set<string>();
    for (const e of this.edges) {
      linked.add(e.a);
      linked.add(e.b);
    }
    const orphans = new Set<string>();
    if (this.nodes.size > 1) for (const n of this.nodes.values()) if (!linked.has(n.key)) orphans.add(n.key);
    if (orphans.size > 0) this.removeKeys(orphans);
    for (const n of this.nodes.values()) if (n.via !== null && !this.nodes.has(n.via)) n.via = null;
  }

  /**
   * One simulation tick: springs along the edges (stronger edges are shorter), repulsion between near nodes (a grid keeps
   * it cheap), displacement scaled by each node's mobility. Returns true if it ran (the view redraws).
   */
  tick(): boolean {
    if (this.heat <= 0) return false;
    const nodes = [...this.nodes.values()];
    const n = nodes.length;
    const index = new Map<string, number>();
    nodes.forEach((nd, i) => index.set(nd.key, i));
    const R = REST * 1.8;
    const grid = new Map<string, number[]>();
    const keyAt = (cx: number, cy: number) => `${cx},${cy}`;
    nodes.forEach((nd, i) => {
      const k = keyAt(Math.floor(nd.x / R), Math.floor(nd.y / R));
      const l = grid.get(k);
      if (l) l.push(i);
      else grid.set(k, [i]);
    });
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      const cx = Math.floor(a.x / R);
      const cy = Math.floor(a.y / R);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const l = grid.get(keyAt(cx + dx, cy + dy));
          if (!l) continue;
          for (const j of l) {
            if (j <= i) continue;
            const b = nodes[j]!;
            let ex = a.x - b.x;
            let ey = a.y - b.y;
            let d2 = ex * ex + ey * ey;
            if (d2 > R * R) continue;
            if (d2 < 0.01) {
              ex = hash01(a.key) - 0.5;
              ey = hash01(b.key) - 0.5;
              d2 = ex * ex + ey * ey + 0.01;
            }
            const d = Math.sqrt(d2);
            const f = (REST * REST * 0.9) / d2;
            fx[i]! += (ex / d) * f;
            fy[i]! += (ey / d) * f;
            fx[j]! -= (ex / d) * f;
            fy[j]! -= (ey / d) * f;
          }
        }
      }
    }
    for (const e of this.edges) {
      const i = index.get(e.a);
      const j = index.get(e.b);
      if (i === undefined || j === undefined) continue;
      const a = nodes[i]!;
      const b = nodes[j]!;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = (d - REST * (1.3 - 0.5 * e.weight)) * 0.08;
      fx[i]! += (ex / d) * f;
      fy[i]! += (ey / d) * f;
      fx[j]! -= (ex / d) * f;
      fy[j]! -= (ey / d) * f;
    }
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      if (a.pinned) {
        a.vx = 0;
        a.vy = 0;
        continue;
      }
      a.vx = (a.vx + fx[i]! * a.mobility) * 0.82;
      a.vy = (a.vy + fy[i]! * a.mobility) * 0.82;
      const sp = Math.hypot(a.vx, a.vy);
      if (sp > 30) {
        a.vx *= 30 / sp;
        a.vy *= 30 / sp;
      }
      a.x += a.vx;
      a.y += a.vy;
      energy += a.vx * a.vx + a.vy * a.vy;
    }
    this.heat--;
    if (energy / Math.max(n, 1) < 0.002) this.heat = 0;
    return true;
  }

  /** Lets the network move again for a while (a node was dragged). */
  warm(ticks = 30): void {
    this.heat = Math.max(this.heat, ticks);
    for (const n of this.nodes.values()) n.mobility = Math.max(n.mobility, 0.35);
  }
}
