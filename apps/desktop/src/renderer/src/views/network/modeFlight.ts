import type { Network } from './forceSim';

/**
 * The flight between the Panorama and a network (§4.20): the nodes leave the places of their topics in the Panorama and arrive,
 * in 300 ms, where the simulation settles them. The layout is settled first (within a time budget, off screen), then only the
 * positions are interpolated: no simulation runs during the flight. With reduced motion the caller settles and shows the result.
 */
export const MODE_FLIGHT_MS = 300;

export interface ModeFlight {
  from: Map<string, { x: number; y: number }>;
  to: Map<string, { x: number; y: number }>;
  /** Elapsed milliseconds. */
  t: number;
  last: number;
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * Starts a flight for the nodes just loaded at their Panorama places: settles the layout for at most `budgetMs`. The nodes are
 * left at the END (so the camera can be fitted to them); `stepModeFlight` then puts them back at the start and moves them.
 */
export function beginModeFlight(net: Network, now: number, budgetMs = 120): ModeFlight {
  const from = new Map<string, { x: number; y: number }>();
  for (const n of net.nodes.values()) from.set(n.key, { x: n.x, y: n.y });
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  while (net.tick() && net.heat > 0 && (typeof performance === 'undefined' || performance.now() - t0 < budgetMs));
  const to = new Map<string, { x: number; y: number }>();
  for (const n of net.nodes.values()) to.set(n.key, { x: n.x, y: n.y });
  return { from, to, t: 0, last: now };
}

/** Moves the nodes to the point of the flight at `now`; true while it goes on. Nodes added meanwhile are left alone. */
export function stepModeFlight(net: Network, f: ModeFlight, now: number, ms = MODE_FLIGHT_MS): boolean {
  f.t += Math.min(Math.max(now - f.last, 0), 50);
  f.last = now;
  const u = Math.min(f.t / ms, 1);
  const e = smooth(u);
  for (const n of net.nodes.values()) {
    const a = f.from.get(n.key);
    const b = f.to.get(n.key);
    if (!a || !b) continue;
    n.x = a.x + (b.x - a.x) * e;
    n.y = a.y + (b.y - a.y) * e;
    n.vx = 0;
    n.vy = 0;
  }
  return u < 1;
}
