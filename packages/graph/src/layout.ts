import { makeRandom } from './random.js';
import { checkpoint, type Edge, type RunContext } from './types.js';

export interface Layout {
  x: Float64Array;
  y: Float64Array;
}

/** Iterations of the force simulation, and how many other points each point is pushed away from per iteration. */
const ITERATIONS = 120;
const SAMPLES = 32;
const FULL_PAIRS_BELOW = 400;

/**
 * Seeded force-directed layout of the neighbour graph, in the square [-1, 1]. Points start around an anchor per top-level
 * cluster (placed on a spiral, large clusters first), so that clusters stay apart; neighbours attract each other,
 * every point is pushed away from a random sample of the others (all of them in a small graph), and a light pull
 * keeps a point near its cluster. Same seed and graph, same positions.
 */
export async function forceLayout(n: number, edges: readonly Edge[], cluster: Int32Array, seed: number, ctx?: RunContext): Promise<Layout> {
  const rnd = makeRandom(seed ^ 0x9e3779b9);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  if (n === 0) return { x, y };
  const count = cluster.reduce((m, c) => Math.max(m, c + 1), 0);
  const sizes = new Int32Array(count);
  for (const c of cluster) sizes[c] = (sizes[c] as number) + 1;
  const ax = new Float64Array(count);
  const ay = new Float64Array(count);
  const order = Array.from({ length: count }, (_, c) => c).sort((p, q) => (sizes[q] as number) - (sizes[p] as number) || p - q);
  order.forEach((c, rank) => {
    const angle = rank * 2.399963229728653;
    const radius = 0.15 + 0.7 * Math.sqrt((rank + 0.5) / count);
    ax[c] = Math.cos(angle) * radius;
    ay[c] = Math.sin(angle) * radius;
  });
  for (let i = 0; i < n; i++) {
    const c = cluster[i] as number;
    const spread = 0.04 + 0.5 * Math.sqrt((sizes[c] as number) / n) * 0.35;
    const angle = rnd() * 2 * Math.PI;
    const r = Math.sqrt(rnd()) * spread;
    x[i] = (ax[c] as number) + Math.cos(angle) * r;
    y[i] = (ay[c] as number) + Math.sin(angle) * r;
  }
  if (n === 1) return { x: new Float64Array([0]), y: new Float64Array([0]) };

  const k = 1.6 / Math.sqrt(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const sample = Math.min(SAMPLES, n - 1);
  const full = n <= FULL_PAIRS_BELOW;
  for (let it = 0; it < ITERATIONS; it++) {
    const temp = 0.12 * (1 - it / ITERATIONS) + 0.003;
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      const pairs = full ? n - 1 : sample;
      const scale = full ? 1 : (n - 1) / sample;
      for (let s = 0; s < pairs; s++) {
        const j = full ? (s < i ? s : s + 1) : Math.floor(rnd() * n);
        if (j === i) continue;
        let ex = (x[i] as number) - (x[j] as number);
        let ey = (y[i] as number) - (y[j] as number);
        let d2 = ex * ex + ey * ey;
        if (d2 < 1e-9) {
          ex = rnd() - 0.5;
          ey = rnd() - 0.5;
          d2 = ex * ex + ey * ey + 1e-9;
        }
        const f = ((k * k) / d2) * scale;
        dx[i] = (dx[i] as number) + ex * f;
        dy[i] = (dy[i] as number) + ey * f;
      }
      const c = cluster[i] as number;
      dx[i] = (dx[i] as number) + ((ax[c] as number) - (x[i] as number)) * 0.4 * k;
      dy[i] = (dy[i] as number) + ((ay[c] as number) - (y[i] as number)) * 0.4 * k;
    }
    for (const e of edges) {
      const ex = (x[e.a] as number) - (x[e.b] as number);
      const ey = (y[e.a] as number) - (y[e.b] as number);
      const d = Math.sqrt(ex * ex + ey * ey) + 1e-9;
      const f = (d / k) * (0.3 + e.w) * 0.5;
      dx[e.a] = (dx[e.a] as number) - (ex / d) * f * d;
      dy[e.a] = (dy[e.a] as number) - (ey / d) * f * d;
      dx[e.b] = (dx[e.b] as number) + (ex / d) * f * d;
      dy[e.b] = (dy[e.b] as number) + (ey / d) * f * d;
    }
    for (let i = 0; i < n; i++) {
      const mx = dx[i] as number;
      const my = dy[i] as number;
      const len = Math.sqrt(mx * mx + my * my) + 1e-12;
      const step = Math.min(len, temp);
      x[i] = (x[i] as number) + (mx / len) * step;
      y[i] = (y[i] as number) + (my / len) * step;
    }
    if (it % 10 === 9) {
      ctx?.onProgress?.('layout', it + 1, ITERATIONS);
      await checkpoint(ctx);
    }
  }
  ctx?.onProgress?.('layout', ITERATIONS, ITERATIONS);
  return normalizeLayout(x, y);
}

/** Centres the points and scales them to fit the square [-1, 1] (aspect ratio kept); positions rounded to 4 decimals. */
export function normalizeLayout(x: Float64Array, y: Float64Array): Layout {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < x.length; i++) {
    minX = Math.min(minX, x[i] as number);
    maxX = Math.max(maxX, x[i] as number);
    minY = Math.min(minY, y[i] as number);
    maxY = Math.max(maxY, y[i] as number);
  }
  const half = Math.max(maxX - minX, maxY - minY, 1e-9) / 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x: x.map((v) => round((v - cx) / half)), y: y.map((v) => round((v - cy) / half)) };
}
