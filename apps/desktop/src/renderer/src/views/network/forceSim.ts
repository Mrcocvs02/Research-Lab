import type { EntityNode } from './entityTypes';
import { hash01 } from './geometry';
import { QuadTree } from './quadtree';

/** The expandable network: nodes, edges and a tiny incremental force simulation (no graph library). */
export type NodeKind = 'doc' | 'folder' | 'tag' | 'entity';
export type EdgeKind = 'similar' | 'cites' | 'linked' | 'tagged' | 'contains' | 'link' | 'implies' | 'theme';

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
  /** Left where the user dropped it (the pin): the simulation does not move it until it is released. */
  fixed: boolean;
  /** Entity networks: the data of the node, its colour group and radius in pixels. */
  entity?: EntityNode | undefined;
  group?: string | undefined;
  r?: number | undefined;
  /** Macro-area shares and centrality of the node (D-483). */
  ar?: ReadonlyArray<ReadonlyArray<number>> | undefined;
  az?: number | undefined;
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
  /** Entity networks: starting position, data, group and radius. */
  x?: number;
  y?: number;
  entity?: EntityNode;
  group?: string;
  r?: number;
  ar?: ReadonlyArray<ReadonlyArray<number>> | undefined;
  az?: number | undefined;
}
export interface RawEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
}

export const MAX_NET_NODES = 800;
export const REST = 70;
const OLD_MOBILITY = 0.04;
const THETA = 0.9;
const REPEL = REST * REST * 0.9;
/** Rest length of an edge: `rho_i + rho_j + L_MIN + (L_MAX - L_MIN) * (1 - w)^1.5` (section 18.3.1). */
const L_MIN = 0.45 * REST;
const L_MAX = 1.7 * REST;
/** Nothing pushes beyond this distance (far pieces do not fly off). */
const REPEL_RANGE = 6 * REST;
const GAP = 4;
const DOC_RADIUS = 6;
const GRAVITY = 0.02;
const GROUP_PULL = 0.012;
const MIN_GROUP = 3;
const COLLIDE = 0.8;
/** Weight of the edges that carry none (a tag or a folder holding a document). */
const FLAT_WEIGHT = 0.3;
const DAMP = 0.6;
const MAX_SPEED = 40;
/** The temperature decays from 1 to this in about 300 steps. */
export const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);

interface Sim {
  version: number;
  n: number;
  list: NetNode[];
  ei: Int32Array;
  ej: Int32Array;
  /** Rest length, stiffness and the share of the move that falls on `i` (0..2; `j` takes `2 - share`). */
  el: Float64Array;
  ek: Float64Array;
  es: Float64Array;
  rad: Float64Array;
  rmax: number;
  xs: Float64Array;
  ys: Float64Array;
  fx: Float64Array;
  fy: Float64Array;
  tree: QuadTree;
}

/** The weight of an edge as the springs see it. */
export const springWeight = (e: { kind: EdgeKind; weight: number }): number => (e.kind === 'tagged' || e.kind === 'contains' ? FLAT_WEIGHT : Math.min(Math.max(e.weight, 0), 1));

/** Rest length of an edge of weight `w` between nodes of radius `ri` and `rj`: strong edges are short, weak ones long. */
export const restLength = (w: number, ri: number, rj: number): number => ri + rj + L_MIN + (L_MAX - L_MIN) * Math.pow(1 - w, 1.5);

export const keyOf = (kind: NodeKind, id: string): string => `${kind}:${id}`;

const makeNode = (r: RawNode, via: string | null): NetNode => ({ key: keyOf(r.kind, r.id), kind: r.kind, id: r.id, label: r.label, count: r.count, x: r.x ?? 0, y: r.y ?? 0, vx: 0, vy: 0, mobility: 1, expanded: false, via, pinned: false, fixed: false, entity: r.entity, group: r.group, r: r.r, ar: r.ar, az: r.az });

export class Network {
  nodes = new Map<string, NetNode>();
  edges: NetEdge[] = [];
  private edgeSet = new Set<string>();
  /** Bumps when nodes or edges change. */
  version = 0;
  /** Temperature of the simulation: 1 when hot, it decays to `ALPHA_MIN` and then the simulation stops. */
  alpha = 0;
  /** Mean squared speed of the last step. */
  energy = 0;
  private cache: Sim | null = null;
  private adj: { version: number; map: Map<string, string[]> } | null = null;

  /** 1 while the simulation still has to run, 0 when settled. */
  get heat(): number {
    return this.alpha > ALPHA_MIN ? 1 : 0;
  }

  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.edgeSet.clear();
    this.alpha = 0;
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
    this.alpha = Math.max(this.alpha, 0.8);
    return n;
  }

  /**
   * Adds what the expansion of `from` returned. New nodes are placed on an arc around `from`, opening away from the rest
   * of the network; the nodes already there keep their place (they only give way a little while the new ones settle).
   * Nodes past `MAX_NET_NODES` are not added.
   */
  expand(from: NetNode, rawNodes: readonly RawNode[], rawEdges: readonly RawEdge[]): { added: number; capped: boolean; omitted: number } {
    from.expanded = true;
    const fresh: NetNode[] = [];
    let omitted = 0;
    for (const r of rawNodes) {
      if (this.nodes.has(keyOf(r.kind, r.id))) continue;
      if (this.nodes.size + fresh.length >= MAX_NET_NODES) omitted++;
      else fresh.push(makeNode(r, from.key));
    }
    const capped = omitted > 0;
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
    this.alpha = fresh.length > 0 ? 0.7 : this.alpha;
    return { added: fresh.length, capped, omitted };
  }

  private removeKeys(keys: Set<string>): void {
    for (const k of keys) {
      this.nodes.delete(k);
    }
    this.edges = this.edges.filter((e) => !keys.has(e.a) && !keys.has(e.b));
    this.edgeSet = new Set(this.edges.map((e) => `${e.a}|${e.b}|${e.kind}`));
    this.version++;
  }

  /** Replaces one node by new ones placed at its position (a topic that splits into its sub-topics); the others stay. Returns how many were added. */
  replace(key: string, rawNodes: readonly RawNode[], rawEdges: readonly RawEdge[]): number {
    const from = this.nodes.get(key);
    if (!from) return 0;
    const placed = rawNodes.map((r, i) => ({ ...r, x: from.x + Math.cos((i / Math.max(rawNodes.length, 1)) * Math.PI * 2) * 12, y: from.y + Math.sin((i / Math.max(rawNodes.length, 1)) * Math.PI * 2) * 12 }));
    for (const r of placed) {
      const n = makeNode(r, null);
      if (!this.nodes.has(n.key)) this.add(n);
    }
    for (const e of rawEdges) {
      const a = this.nodes.get(e.from);
      const b = this.nodes.get(e.to);
      if (!a || !b || a === b) continue;
      const k = `${a.key}|${b.key}|${e.kind}`;
      if (this.edgeSet.has(k)) continue;
      this.edgeSet.add(k);
      this.edges.push({ a: a.key, b: b.key, kind: e.kind, weight: e.weight });
    }
    this.removeKeys(new Set([key]));
    this.version++;
    this.alpha = Math.max(this.alpha, 0.6);
    return placed.length;
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
   * One simulation step (a few when the network is big and still hot): Barnes-Hut repulsion on a quadtree (theta 0.9),
   * springs along the edges (stronger edges are shorter), a pull towards the group of a node and towards the centre,
   * all scaled by the temperature `alpha`, which decays from 1 to `ALPHA_MIN` in about 300 steps: then the simulation
   * stops (nothing runs at rest). Displacement is scaled by each node's mobility. Returns true if it ran (the view redraws).
   */
  tick(): boolean {
    if (this.alpha <= ALPHA_MIN) {
      this.alpha = 0;
      return false;
    }
    const reps = this.nodes.size > 400 && this.alpha > 0.3 ? 3 : 1;
    for (let r = 0; r < reps && this.alpha > ALPHA_MIN; r++) this.step();
    return true;
  }

  private sync(): Sim {
    let c = this.cache;
    if (c && c.version === this.version && c.n === this.nodes.size) return c;
    const list = [...this.nodes.values()];
    const n = list.length;
    const index = new Map<string, number>();
    list.forEach((nd, i) => index.set(nd.key, i));
    const ei: number[] = [];
    const ej: number[] = [];
    const ew: number[] = [];
    const deg = new Int32Array(n);
    for (const e of this.edges) {
      const i = index.get(e.a);
      const j = index.get(e.b);
      if (i === undefined || j === undefined) continue;
      ei.push(i);
      ej.push(j);
      ew.push(springWeight(e));
      deg[i]!++;
      deg[j]!++;
    }
    const m = ei.length;
    const rad = new Float64Array(n);
    let rmax = 0;
    for (let i = 0; i < n; i++) {
      rad[i] = list[i]!.r ?? DOC_RADIUS;
      if (rad[i]! > rmax) rmax = rad[i]!;
    }
    const el = new Float64Array(m);
    const ek = new Float64Array(m);
    const es = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const i = ei[k]!;
      const j = ej[k]!;
      el[k] = restLength(ew[k]!, rad[i]!, rad[j]!);
      ek[k] = (0.02 + 0.1 * ew[k]!) / Math.min(deg[i]!, deg[j]!);
      es[k] = (2 * deg[j]!) / (deg[i]! + deg[j]!);
    }
    c = { version: this.version, n, list, ei: Int32Array.from(ei), ej: Int32Array.from(ej), el, ek, es, rad, rmax, xs: new Float64Array(n), ys: new Float64Array(n), fx: new Float64Array(n), fy: new Float64Array(n), tree: c?.tree ?? new QuadTree() };
    this.cache = c;
    return c;
  }

  private step(): void {
    const c = this.sync();
    const { list, xs, ys, fx, fy, n, rad } = c;
    for (let i = 0; i < n; i++) {
      xs[i] = list[i]!.x;
      ys[i] = list[i]!.y;
      fx[i] = 0;
      fy[i] = 0;
    }
    c.tree.build(xs, ys, n);
    const out = { x: 0, y: 0 };
    const maxD2 = REPEL_RANGE * REPEL_RANGE;
    let cx = 0;
    let cy = 0;
    let rsum = 0;
    for (let i = 0; i < n; i++) rsum += rad[i]!;
    const mean = rsum / Math.max(n, 1);
    for (let i = 0; i < n; i++) {
      const dmin = rad[i]! + mean + GAP;
      c.tree.repulse(i, xs[i]!, ys[i]!, THETA, REPEL, out, 0.01, dmin * dmin, maxD2);
      fx[i]! += out.x;
      fy[i]! += out.y;
      cx += xs[i]!;
      cy += ys[i]!;
    }
    // Springs: the force k (d - l) along the edge, shared by the degrees (a hub moves little and does not drag everything in).
    for (let k = 0; k < c.ei.length; k++) {
      const i = c.ei[k]!;
      const j = c.ej[k]!;
      const ex = xs[j]! - xs[i]!;
      const ey = ys[j]! - ys[i]!;
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = (d - c.el[k]!) * c.ek[k]!;
      fx[i]! += (ex / d) * f * c.es[k]!;
      fy[i]! += (ey / d) * f * c.es[k]!;
      fx[j]! -= (ex / d) * f * (2 - c.es[k]!);
      fy[j]! -= (ey / d) * f * (2 - c.es[k]!);
    }
    // Gravity only outside a free zone around the centre of mass, and the pull of a group of at least three nodes.
    cx /= Math.max(n, 1);
    cy /= Math.max(n, 1);
    const free = 0.6 * REST * Math.sqrt(n);
    const groups = new Map<string, [number, number, number]>();
    for (let i = 0; i < n; i++) {
      const g = list[i]!.group;
      if (g === undefined) continue;
      const a = groups.get(g) ?? [0, 0, 0];
      a[0] += xs[i]!;
      a[1] += ys[i]!;
      a[2]++;
      groups.set(g, a);
    }
    let energy = 0;
    const a = this.alpha;
    for (let i = 0; i < n; i++) {
      const nd = list[i]!;
      let gx = 0;
      let gy = 0;
      const dist = Math.hypot(cx - xs[i]!, cy - ys[i]!);
      if (dist > free) {
        const pull = (GRAVITY * (dist - free)) / dist;
        gx = (cx - xs[i]!) * pull;
        gy = (cy - ys[i]!) * pull;
      }
      const g = nd.group !== undefined ? groups.get(nd.group) : undefined;
      if (g && g[2] >= MIN_GROUP) {
        gx += (g[0] / g[2] - xs[i]!) * GROUP_PULL;
        gy += (g[1] / g[2] - ys[i]!) * GROUP_PULL;
      }
      if (nd.pinned || nd.fixed) {
        nd.vx = 0;
        nd.vy = 0;
        continue;
      }
      nd.vx = (nd.vx + (fx[i]! + gx) * a * nd.mobility) * DAMP;
      nd.vy = (nd.vy + (fy[i]! + gy) * a * nd.mobility) * DAMP;
      const sp = Math.hypot(nd.vx, nd.vy);
      if (sp > MAX_SPEED) {
        nd.vx *= MAX_SPEED / sp;
        nd.vy *= MAX_SPEED / sp;
      }
      nd.x += nd.vx;
      nd.y += nd.vy;
      energy += nd.vx * nd.vx + nd.vy * nd.vy;
    }
    this.collide(c);
    this.energy = energy / Math.max(n, 1);
    this.alpha *= 1 - ALPHA_DECAY;
  }

  /** The collision pass: two nodes closer than `rho_i + rho_j + 4` are pushed apart by 0.8 of the missing distance (a fixed node does not move, the other takes it all). */
  private collide(c: Sim): void {
    const { list, xs, ys, n, rad, tree } = c;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      xs[i] = list[i]!.x;
      ys[i] = list[i]!.y;
    }
    tree.build(xs, ys, n);
    const reach = c.rmax * 2 + GAP;
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const y = ys[i]!;
      tree.query(x - reach, y - reach, x + reach, y + reach, (j) => {
        if (j <= i) return;
        const need = rad[i]! + rad[j]! + GAP;
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let d = Math.hypot(dx, dy);
        if (d >= need) return;
        if (d < 1e-9) {
          const h = hash01(`${list[i]!.key}|${list[j]!.key}`) * Math.PI * 2;
          dx = Math.cos(h);
          dy = Math.sin(h);
          d = 1;
        }
        const a = list[i]!;
        const b = list[j]!;
        const lockA = a.pinned || a.fixed;
        const lockB = b.pinned || b.fixed;
        if (lockA && lockB) return;
        const push = (COLLIDE * (need - d)) / d;
        const wa = lockA ? 0 : lockB ? 1 : 0.5;
        const wb = lockB ? 0 : lockA ? 1 : 0.5;
        a.x -= dx * push * wa;
        a.y -= dy * push * wa;
        b.x += dx * push * wb;
        b.y += dy * push * wb;
        xs[i] = a.x;
        ys[i] = a.y;
        xs[j] = b.x;
        ys[j] = b.y;
      });
    }
  }

  /** Lets the network move again for a while (a node was dragged): a gentle temperature, so the neighbours follow like elastics. */
  warm(alpha = 0.3): void {
    this.alpha = Math.max(this.alpha, alpha);
    for (const n of this.nodes.values()) n.mobility = Math.max(n.mobility, 0.35);
  }

  /** Replaces everything with an entity network (nodes already placed), capped at `MAX_NET_NODES`. Returns how many nodes were left out. */
  load(raws: readonly RawNode[], edges: ReadonlyArray<{ a: string; b: string; kind: EdgeKind; weight: number }>, alpha = 0.5): number {
    this.clear();
    const keep = raws.slice(0, MAX_NET_NODES);
    for (const r of keep) this.add(makeNode(r, null));
    for (const e of edges) {
      const a = this.nodes.get(e.a);
      const b = this.nodes.get(e.b);
      if (!a || !b || a === b) continue;
      const k = `${a.key}|${b.key}|${e.kind}`;
      if (this.edgeSet.has(k)) continue;
      this.edgeSet.add(k);
      this.edges.push({ a: a.key, b: b.key, kind: e.kind, weight: e.weight });
    }
    this.version++;
    this.alpha = alpha;
    return raws.length - keep.length;
  }

  /** Random positions (a seeded disc) and a hot simulation: "Mescola". Pinned nodes stay where they are. */
  shuffle(rand: () => number): void {
    const radius = REST * Math.sqrt(Math.max(this.nodes.size, 1)) * 0.9;
    for (const n of this.nodes.values()) {
      n.mobility = 1;
      if (n.fixed) continue;
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * radius;
      n.x = Math.cos(a) * d;
      n.y = Math.sin(a) * d;
      n.vx = 0;
      n.vy = 0;
    }
    this.alpha = 1;
  }

  /** Keys of the nodes linked to `key` (either direction). */
  neighbors(key: string): readonly string[] {
    if (!this.adj || this.adj.version !== this.version) {
      const map = new Map<string, string[]>();
      for (const e of this.edges) {
        (map.get(e.a) ?? map.set(e.a, []).get(e.a)!).push(e.b);
        (map.get(e.b) ?? map.set(e.b, []).get(e.b)!).push(e.a);
      }
      this.adj = { version: this.version, map };
    }
    return this.adj.map.get(key) ?? [];
  }
}
