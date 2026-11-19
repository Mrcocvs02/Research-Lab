import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rl } from '../../lib/rl';
import { takeTimelineIntent } from '../../lib/timelineIntent';
import { reducedMotion } from './camera';
import { boundsOf, PointGrid } from './geometry';
import type { PreparedMap } from './mapModel';

/**
 * "Disponi per anno" (feature 19, §17.4.20): the documents of the Map on a horizontal axis of years, with a flight from the
 * map layout (none with reduced motion). Documents without a year are collected at the right ("Senza anno"). No data of its own:
 * the years come from the library index. Exit with the same command or Esc.
 */

/** Rows of one year column before it grows a second column of dots. */
const ROWS = 18;
/** Frames of the flight, at most this many points (a larger map jumps). */
const FLIGHT_MS = 450;
const FLIGHT_MAX_POINTS = 20_000;

/** The same map with every point moved to its year; the order inside a year follows the vertical order of the map layout. */
export function yearLayout(map: PreparedMap, yearOf: (docId: string) => number | null): { map: PreparedMap; withoutYear: number } {
  const b = map.bounds;
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const byYear = new Map<number, number[]>();
  const none: number[] = [];
  for (let i = 0; i < map.n; i++) {
    const y = yearOf(map.ids[i]!);
    if (y === null) none.push(i);
    else byYear.set(y, [...(byYear.get(y) ?? []), i]);
  }
  const years = [...byYear.keys()].sort((a, c) => a - c);
  const first = years[0] ?? 0;
  const span = Math.max((years[years.length - 1] ?? 0) - first, 1);
  // The axis is a straight line of years; the "no year" column sits after it, one tenth of the width away.
  const axis = w * 0.9;
  const step = axis / span;
  const xs = new Float32Array(map.n);
  const ys = new Float32Array(map.n);
  const place = (list: number[], cx: number) => {
    const sorted = [...list].sort((p, q) => map.ys[p]! - map.ys[q]! || p - q);
    const cols = Math.max(1, Math.ceil(sorted.length / ROWS));
    const rows = Math.min(sorted.length, ROWS);
    const dy = h / Math.max(ROWS, 1);
    const dx = cols > 1 ? Math.min(step * 0.8, w / 40) : 0;
    sorted.forEach((idx, k) => {
      const col = Math.floor(k / ROWS);
      const row = k % ROWS;
      xs[idx] = b.minX + cx + (col - (cols - 1) / 2) * dx;
      ys[idx] = b.minY + h / 2 + (row - (rows - 1) / 2) * dy;
    });
  };
  for (const y of years) place(byYear.get(y)!, (y - first) * step);
  if (none.length > 0) place(none, axis + w * 0.1 + (none.length > ROWS ? w / 40 : 0));
  const nb = boundsOf(xs, ys, map.n);
  return { map: { ...map, xs, ys, bounds: nb, grid: new PointGrid(xs, ys, map.n, nb) }, withoutYear: none.length };
}

/** A map between two layouts of the same points (`t` from 0 to 1). */
export function between(a: PreparedMap, b: PreparedMap, t: number): PreparedMap {
  const xs = new Float32Array(a.n);
  const ys = new Float32Array(a.n);
  for (let i = 0; i < a.n; i++) {
    xs[i] = a.xs[i]! + (b.xs[i]! - a.xs[i]!) * t;
    ys[i] = a.ys[i]! + (b.ys[i]! - a.ys[i]!) * t;
  }
  const nb = boundsOf(xs, ys, a.n);
  return { ...b, xs, ys, bounds: nb, grid: new PointGrid(xs, ys, a.n, nb) };
}

const ease = (t: number) => 1 - (1 - t) ** 3;

/** The years of the documents on the map, read from the library index (only while the timeline is on). */
async function loadYears(ids: ReadonlySet<string>): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (let offset = 0; out.size < ids.size && offset < 200_000; ) {
    const r = await rl.invoke('documents:list', { limit: 500, offset });
    for (const d of r.items) if (ids.has(d.docId)) out.set(d.docId, d.year);
    offset += r.items.length;
    if (r.items.length === 0 || offset >= r.total) break;
  }
  return out;
}

export interface Timeline {
  /** The map to draw (the layout by year while it is on). */
  map: PreparedMap | null;
  /** When the timeline was opened with a selection: the only documents to show. */
  only: ReadonlySet<string> | null;
  active: boolean;
  /** Documents without a year while it is on. */
  withoutYear: number;
  toggle(): void;
}

/**
 * The Map's timeline: `active` switches the layout, `toggle` is the menu entry and the same command to leave (Esc too). A selection
 * left by the Library's "Linea del tempo" is taken once, when the Map first has something to show.
 */
export function useTimeline(map: PreparedMap | null): Timeline {
  const [active, setActive] = useState(false);
  const [only, setOnly] = useState<ReadonlySet<string> | null>(null);
  const [years, setYears] = useState<Map<string, number | null> | null>(null);
  const [shown, setShown] = useState<PreparedMap | null>(map);
  const flip = useRef(false);
  const mapRef = useRef(map);
  mapRef.current = map;

  // A selection from the Library opens the timeline on those documents only.
  useEffect(() => {
    const ids = takeTimelineIntent();
    if (ids && ids.length > 0) {
      setOnly(new Set(ids));
      setActive(true);
      flip.current = true;
    }
  }, []);

  useEffect(() => {
    if (!active || !map) return;
    let live = true;
    void loadYears(new Set(map.ids)).then((y) => live && setYears(y), () => live && setActive(false));
    return () => {
      live = false;
    };
  }, [active, map]);

  const laid = useMemo(() => (active && map && years ? yearLayout(map, (id) => years.get(id) ?? null) : null), [active, map, years]);
  const target = active ? laid?.map ?? map : map;

  useEffect(() => {
    if (!target) {
      setShown(null);
      return;
    }
    const from = shown;
    const animate = flip.current && from !== null && from !== target && from.n === target.n && target.n <= FLIGHT_MAX_POINTS && !reducedMotion();
    flip.current = false;
    if (!animate || !from) {
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FLIGHT_MS);
      setShown(t >= 1 ? target : between(from, target, ease(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // The flight starts when the target changes, from wherever the points are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const toggle = useCallback(() => {
    flip.current = true;
    setActive((a) => !a);
    setOnly((o) => (active ? null : o));
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      flip.current = true;
      setActive(false);
      setOnly(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return { map: shown ?? map, only: active ? only : null, active, withoutYear: active ? (laid?.withoutYear ?? 0) : 0, toggle };
}
