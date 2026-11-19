/**
 * A quadtree over points in flat arrays (no object per node) with the centre of mass of every cell: the structure behind
 * the Barnes-Hut repulsion of the force simulation and the range queries. Coincident points stop splitting at a depth limit.
 */
const MAX_DEPTH = 30;

export class QuadTree {
  private cap = 0;
  private count = 0;
  private mass = new Float64Array(0);
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  private size = new Float64Array(0);
  private child = new Int32Array(0);
  /** The point of a leaf, -1 for an inner cell, -2 for a leaf of coincident points. */
  private body = new Int32Array(0);
  private xs: ArrayLike<number> = [];
  private ys: ArrayLike<number> = [];

  private grow(min: number): void {
    const cap = Math.max(min, this.cap * 2, 64);
    const f = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.mass = f(this.mass);
    this.sx = f(this.sx);
    this.sy = f(this.sy);
    this.x0 = f(this.x0);
    this.y0 = f(this.y0);
    this.size = f(this.size);
    const c = new Int32Array(cap * 4);
    c.set(this.child);
    this.child = c;
    const b = new Int32Array(cap);
    b.set(this.body);
    this.body = b;
    this.cap = cap;
  }

  private make(x0: number, y0: number, size: number): number {
    if (this.count >= this.cap) this.grow(this.count + 1);
    const n = this.count++;
    this.mass[n] = 0;
    this.sx[n] = 0;
    this.sy[n] = 0;
    this.x0[n] = x0;
    this.y0[n] = y0;
    this.size[n] = size;
    this.body[n] = -1;
    this.child.fill(-1, n * 4, n * 4 + 4);
    return n;
  }

  private quadrant(n: number, x: number, y: number): number {
    const h = this.size[n]! / 2;
    return (x >= this.x0[n]! + h ? 1 : 0) + (y >= this.y0[n]! + h ? 2 : 0);
  }

  private sub(n: number, q: number): number {
    const h = this.size[n]! / 2;
    return this.make(this.x0[n]! + (q & 1 ? h : 0), this.y0[n]! + (q & 2 ? h : 0), h);
  }

  private isLeaf(n: number): boolean {
    const c = this.child;
    return c[n * 4]! < 0 && c[n * 4 + 1]! < 0 && c[n * 4 + 2]! < 0 && c[n * 4 + 3]! < 0;
  }

  /** Builds the tree over the first `n` points. */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): this {
    this.xs = xs;
    this.ys = ys;
    this.count = 0;
    if (n === 0) return this;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const y = ys[i]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.make(minX, minY, Math.max(maxX - minX, maxY - minY, 1e-6) * 1.0001);
    for (let i = 0; i < n; i++) this.insert(i);
    return this;
  }

  private insert(i: number): void {
    const x = this.xs[i]!;
    const y = this.ys[i]!;
    let n = 0;
    for (let depth = 0; ; depth++) {
      const leaf = this.isLeaf(n);
      if (leaf && this.mass[n] === 0) {
        this.body[n] = i;
        this.mass[n] = 1;
        this.sx[n] = x;
        this.sy[n] = y;
        return;
      }
      this.mass[n]!++;
      this.sx[n]! += x;
      this.sy[n]! += y;
      if (leaf) {
        if (depth >= MAX_DEPTH) {
          this.body[n] = -2;
          return;
        }
        const o = this.body[n]!;
        this.body[n] = -1;
        if (o >= 0) {
          const q = this.quadrant(n, this.xs[o]!, this.ys[o]!);
          const c = this.sub(n, q);
          this.body[c] = o;
          this.mass[c] = 1;
          this.sx[c] = this.xs[o]!;
          this.sy[c] = this.ys[o]!;
          this.child[n * 4 + q] = c;
        }
      }
      const q = this.quadrant(n, x, y);
      let c = this.child[n * 4 + q]!;
      if (c < 0) {
        c = this.sub(n, q);
        this.child[n * 4 + q] = c;
      }
      n = c;
    }
  }

  /**
   * The repulsion on the point `self` at (x, y): every other point pushes with `strength / d^2`; a cell far enough
   * (`size / d < theta`) counts as one body at its centre of mass. Returns the sum in `out`.
   */
  repulse(self: number, x: number, y: number, theta: number, strength: number, out: { x: number; y: number }, jitter = 0.01): void {
    out.x = 0;
    out.y = 0;
    if (this.count === 0) return;
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    const t2 = theta * theta;
    while (top > 0) {
      const n = stack[--top]!;
      const m = this.mass[n]!;
      if (m === 0) continue;
      const leaf = this.isLeaf(n);
      if (leaf && this.body[n] === self) continue;
      let dx = x - this.sx[n]! / m;
      let dy = y - this.sy[n]! / m;
      let d2 = dx * dx + dy * dy;
      const s = this.size[n]!;
      if (leaf || s * s < t2 * d2) {
        if (d2 < jitter) {
          dx = ((self * 7919) % 13) / 13 - 0.5 + 0.01;
          dy = ((self * 104729) % 17) / 17 - 0.5 + 0.01;
          d2 = dx * dx + dy * dy + jitter;
        }
        const f = (strength * m) / (d2 * Math.sqrt(d2));
        out.x += dx * f;
        out.y += dy * f;
      } else {
        for (let q = 0; q < 4; q++) {
          const c = this.child[n * 4 + q]!;
          if (c >= 0) stack[top++] = c;
        }
      }
    }
  }

  private stack = new Int32Array(4096);

  /** Calls `fn(i)` for the points in the rectangle. */
  query(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    if (this.count === 0) return;
    const stack: number[] = [0];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (this.mass[n] === 0) continue;
      const s = this.size[n]!;
      if (this.x0[n]! > x1 || this.y0[n]! > y1 || this.x0[n]! + s < x0 || this.y0[n]! + s < y0) continue;
      if (this.isLeaf(n)) {
        const b = this.body[n]!;
        if (b >= 0 && this.xs[b]! >= x0 && this.xs[b]! <= x1 && this.ys[b]! >= y0 && this.ys[b]! <= y1) fn(b);
      } else {
        for (let q = 0; q < 4; q++) {
          const c = this.child[n * 4 + q]!;
          if (c >= 0) stack.push(c);
        }
      }
    }
  }

  get cells(): number {
    return this.count;
  }
}

/**
 * Collision pass between points (§4.22): two points closer than `dmin` are pushed apart (half each); `passes` times, the tree is
 * rebuilt every pass. Changes the arrays in place. The caller skips it above 5000 points.
 */
export function collidePoints(xs: Float32Array, ys: Float32Array, n: number, dmin: number, passes = 2): void {
  if (n < 2 || dmin <= 0) return;
  const tree = new QuadTree();
  for (let pass = 0; pass < passes; pass++) {
    tree.build(xs, ys, n);
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const y = ys[i]!;
      tree.query(x - dmin, y - dmin, x + dmin, y + dmin, (j) => {
        if (j <= i) return;
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let d = Math.hypot(dx, dy);
        if (d >= dmin) return;
        if (d < 1e-9) {
          dx = Math.cos(i * 2.4 + j);
          dy = Math.sin(i * 2.4 + j);
          d = 1;
        }
        const push = (dmin - Math.min(d, dmin)) / 2 / d;
        xs[i]! -= dx * push;
        ys[i]! -= dy * push;
        xs[j]! += dx * push;
        ys[j]! += dy * push;
      });
    }
  }
}
