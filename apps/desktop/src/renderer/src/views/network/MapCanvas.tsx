import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { isDarkTheme } from '../../lib/theme';
import { reducedMotion } from './camera';
import { withAlpha, haloSprite, readTheme, type MapTheme } from './colors';
import { toScreenX, toScreenY, toWorldX, toWorldY } from './geometry';
import { DocCard, HoverCard, useRestingHover } from './HoverCard';
import { centroidOf, hullShape, inPolygon, type Pt } from './hulls';
import { pickLabels, shortLabel, type LabelCandidate } from './labelsLod';
import { firstNode, mapAction, nearestInDirection } from './mapKeyboard';
import { clusterHulls, clusterText, pointsInView, stepPoint, type PreparedMap } from './mapModel';
import { MiniMap } from './MiniMap';
import { useCanvasView } from './useCanvasView';
import { safeText } from '../library/safeText';
import { useDocTitle } from '../chat/useLabels';

export interface MapHandle {
  /** Centres the view on a cluster (zooming in when the view is wide). */
  focusCluster(id: string): void;
  fit(): void;
  /** "Mescola": the points appear again from the centre of their topic. */
  shuffle(): void;
  /** Flies to two documents and draws a dashed arc between them ("Sorprendimi"); null clears it. */
  surprise(a: string, b: string): void;
  clearSurprise(): void;
  /** Flies to a document and pulses it (the search field). */
  flyToDoc(docId: string): void;
}

interface Props {
  map: PreparedMap;
  level: number;
  selected: string | null;
  onSelect(docId: string | null): void;
  /** Shift+Enter on a point: read the document. */
  onRead?(docId: string): void;
  /** `L`: open Explore. */
  onExplore?(): void;
  aiBadge: string;
  label: string;
  /** Changes when the view must be fitted again (another scope). */
  fitKey: string;
  handle?: Ref<MapHandle>;
  /** Stable tint index (0..9) of each topic of the level and whether its outline is dashed (more than ten topics touching). */
  tints: { tint: number[]; dashed: boolean[] };
  /** Documents that pass the filters (null: all); the others fade and shrink. */
  allow: ReadonlySet<string> | null;
  minimap: boolean;
}

const MAX_LABELS = 400;
const OPEN_MAX = 600;

/** Names the point the keyboard cursor is on for screen readers (the canvas itself has no children to focus). */
function Announce({ docId, topic }: { docId: string; topic: string }) {
  const { t } = useTranslation();
  const title = useDocTitle(docId);
  return (
    <span className="visually-hidden" aria-live="polite" data-testid="map-focus">
      {t('network.announce.doc', { title: safeText(title ?? docId.slice(0, 8)), topic })}
    </span>
  );
}

/**
 * The Panorama on a canvas: one batched path per colour, culled to the viewport; hit testing through a grid; hulls of the
 * topics (convex hull, 16 px, two Chaikin passes) with their labels; a card on hover; the minimap; the camera of useCanvasView.
 * Double click on a hull opens the topic (its points spread out), Esc or a double click on the background closes it. Arrows go
 * to the nearest point that way, `]` and `[` walk through the points in view, Enter selects, Shift+Enter reads, `L` opens Explore.
 * React renders only when the hovered or focused point changes, never per frame; nothing runs at rest.
 */
export function MapCanvas({ map, level, selected, onSelect, onRead, onExplore, aiBadge, label, fitKey, handle, tints, allow, minimap }: Props) {
  const { t } = useTranslation();
  const [hover, setHover] = useRestingHover<{ idx: number; x: number; y: number }>();
  const [focused, setFocused] = useState<number | null>(null);
  const hoverIdx = useRef(-1);
  /** The point the keyboard cursor is on (-1: none). */
  const cursor = useRef(-1);
  const selIdx = selected !== null ? (map.indexOf.get(selected) ?? -1) : -1;
  const selRef = useRef(selIdx);
  selRef.current = selIdx;
  const lastLabel = useRef<string>('');
  const theme = useRef<MapTheme | null>(null);
  const hulls = useMemo(() => clusterHulls(map, level), [map, level]);
  const tintRef = useRef(tints);
  tintRef.current = tints;
  const allowRef = useRef(allow);
  const faded = useRef({ t: 1, from: allow });
  /** Entry animation: 0 → 1 over 400 ms (points come out of the centre of their topic). */
  const appear = useRef({ t: reducedMotion() || map.n > 20000 ? 1 : 0, at: 0 });
  const open = useRef<{ cluster: number; dx: Map<number, [number, number]>; t: number; at: number } | null>(null);
  const surprise = useRef<{ a: number; b: number } | null>(null);
  const pulse = useRef<{ idx: number; at: number } | null>(null);

  useEffect(() => {
    faded.current = { t: reducedMotion() ? 1 : 0, from: allowRef.current };
    allowRef.current = allow;
    view.requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allow]);

  const view = useCanvasView<number>({
    draw(ctx, w, h, v) {
      const dark = isDarkTheme();
      if (theme.current?.dark !== dark) theme.current = readTheme(ctx.canvas, dark);
      const th = theme.current!;
      const now = performance.now();
      const g = map.groups[level];
      const clusters = map.levels[level] ?? [];
      const small = map.n < 30;
      const size = small ? 14 : Math.min(5, Math.max(2, 1.2 + Math.sqrt(v.k / Math.max(map.n, 1)) * 40));
      const half = size / 2;
      let animating = false;
      // Entry animation.
      if (appear.current.t < 1) {
        if (appear.current.at === 0) appear.current.at = now;
        appear.current.t = Math.min(1, (now - appear.current.at) / 400);
        animating = true;
      }
      const ap = appear.current.t;
      const ease = ap * ap * (3 - 2 * ap);
      const f = faded.current;
      if (f.t < 1) {
        f.t = Math.min(1, f.t + 16 / 240);
        animating = true;
      }
      // Hulls and their labels first: behind the points.
      const labels: LabelCandidate[] = [];
      const texts: Array<{ text: string; ai: boolean; c: number }> = [];
      const dpx = (c: number) => ({ x: toScreenX(v, clusters[c]!.centroid.x, w), y: toScreenY(v, clusters[c]!.centroid.y, h) });
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      clusters.forEach((c, s) => {
        const hull = hulls[s];
        if (!hull || hull.length === 0) return;
        const screen = hull.map((p) => [toScreenX(v, p[0], w), toScreenY(v, p[1], h)] as Pt);
        const minX = Math.min(...screen.map((p) => p[0]));
        const maxX = Math.max(...screen.map((p) => p[0]));
        const minY = Math.min(...screen.map((p) => p[1]));
        const maxY = Math.max(...screen.map((p) => p[1]));
        const tint = th.tints[tintRef.current.tint[s] ?? 0] ?? th.muted;
        if (maxX > -40 && minX < w + 40 && maxY > -40 && minY < h + 40) {
          const shape = hullShape(screen, 16);
          if (shape.length > 2) {
            ctx.beginPath();
            ctx.moveTo(shape[0]![0], shape[0]![1]);
            for (let i = 1; i < shape.length; i++) ctx.lineTo(shape[i]![0], shape[i]![1]);
            ctx.closePath();
            ctx.globalAlpha = ease;
            ctx.fillStyle = withAlpha(tint, dark ? 0.12 : 0.07);
            ctx.fill();
            ctx.strokeStyle = withAlpha(tint, dark ? 0.35 : 0.25);
            ctx.lineWidth = 1;
            ctx.setLineDash(tintRef.current.dashed[s] ? [5, 4] : []);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        }
        const text = clusterText(c);
        const label = shortLabel(text.text);
        if (label === '') return;
        const ctr = centroidOf(screen);
        const tw = ctx.measureText(label).width + (text.ai ? ctx.measureText(aiBadge).width + 16 : 0) + 10;
        texts.push({ text: label, ai: text.ai, c: s });
        labels.push({ id: texts.length - 1, x: ctr[0], y: ctr[1], w: tw, size: c.size });
      });
      // Points: one path per colour, culled to the viewport.
      const groups = g ? clusters.length + 1 : 1;
      const al = allowRef.current;
      const op = open.current;
      let count = 0;
      for (let s = 0; s < groups; s++) {
        const from = g ? g.starts[s]! : 0;
        const to = g ? g.starts[s + 1]! : map.n;
        if (from === to) continue;
        const color = g && s < clusters.length ? (th.tints[tintRef.current.tint[s] ?? 0] ?? th.muted) : th.muted;
        const c0 = g && s < clusters.length ? clusters[s]!.centroid : null;
        for (const pass of al ? [true, false] : [true]) {
          ctx.fillStyle = color;
          ctx.globalAlpha = pass ? Math.max(ease, 0.001) : 0.08 + 0.92 * (1 - f.t);
          ctx.beginPath();
          for (let j = from; j < to; j++) {
            const i = g ? g.order[j]! : j;
            if (al && al.has(map.ids[i]!) !== pass) continue;
            if (op && op.cluster === s) continue;
            let x = map.xs[i]!;
            let y = map.ys[i]!;
            if (c0 && ease < 1) {
              x = c0.x + (x - c0.x) * ease;
              y = c0.y + (y - c0.y) * ease;
            }
            const sx = (x - v.cx) * v.k + w / 2;
            const sy = (y - v.cy) * v.k + h / 2;
            if (sx < -size || sy < -size || sx > w + size || sy > h + size) continue;
            const hs = pass ? half : half * (0.5 + 0.5 * (1 - f.t));
            ctx.rect(sx - hs, sy - hs, hs * 2, hs * 2);
            count++;
          }
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      // An open topic: its points spread out (collision), drawn as small circles.
      if (op) {
        if (op.t < 1) {
          op.t = Math.min(1, (now - op.at) / 300);
          animating = true;
        }
        const ts = th.tints[tintRef.current.tint[op.cluster] ?? 0] ?? th.muted;
        ctx.fillStyle = ts;
        ctx.beginPath();
        for (const [i, [dx, dy]] of op.dx) {
          const x = toScreenX(v, map.xs[i]! + dx * op.t, w);
          const y = toScreenY(v, map.ys[i]! + dy * op.t, h);
          ctx.moveTo(x + 4, y);
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          count++;
        }
        ctx.fill();
      }
      if (ctx.canvas.dataset['drawn'] !== String(count)) ctx.canvas.dataset['drawn'] = String(count);
      // Hover halo (additive in the dark theme), selected and cursor rings.
      const hi = hoverIdx.current;
      if (hi >= 0) {
        const sprite = haloSprite(th.tints[tintRef.current.tint[clusterIndexOf(hi)] ?? 0] ?? th.accent);
        const hx = toScreenX(v, map.xs[hi]!, w);
        const hy = toScreenY(v, map.ys[hi]!, h);
        if (sprite) {
          ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
          ctx.drawImage(sprite, hx - 24, hy - 24, 48, 48);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = th.text;
        ctx.beginPath();
        ctx.arc(hx, hy, half * 1.25 + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const [idx, width, dash] of [[selRef.current, 2, false], [cursor.current, 1.5, true]] as const) {
        if (idx < 0) continue;
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = width;
        ctx.setLineDash(dash ? [3, 3] : []);
        ctx.beginPath();
        ctx.arc(toScreenX(v, map.xs[idx]!, w), toScreenY(v, map.ys[idx]!, h), size + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const pl = pulse.current;
      if (pl) {
        const age = (now - pl.at) / 1000;
        if (age < 1.2) {
          animating = true;
          const r = size + 4 + Math.abs(Math.sin(age * Math.PI * 2)) * 8;
          ctx.strokeStyle = th.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(toScreenX(v, map.xs[pl.idx]!, w), toScreenY(v, map.ys[pl.idx]!, h), r, 0, Math.PI * 2);
          ctx.stroke();
        } else pulse.current = null;
      }
      const sr = surprise.current;
      if (sr) {
        const ax = toScreenX(v, map.xs[sr.a]!, w);
        const ay = toScreenY(v, map.ys[sr.a]!, h);
        const bx = toScreenX(v, map.xs[sr.b]!, w);
        const by = toScreenY(v, map.ys[sr.b]!, h);
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2 + (by - ay) * 0.2, (ay + by) / 2 - (bx - ax) * 0.2, bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const i of [sr.a, sr.b]) {
          ctx.beginPath();
          ctx.arc(toScreenX(v, map.xs[i]!, w), toScreenY(v, map.ys[i]!, h), size + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Labels of the topics: the biggest first, none over another.
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      let shown = 0;
      for (const i of pickLabels(labels, w, h, MAX_LABELS)) {
        const l = labels[i]!;
        const tx = texts[l.id]!;
        shown++;
        ctx.lineWidth = 3;
        ctx.strokeStyle = th.bg;
        if (tx.ai) {
          const bw = ctx.measureText(aiBadge).width;
          ctx.textAlign = 'left';
          const left = l.x - l.w / 2 + 5;
          ctx.strokeText(aiBadge, left, l.y);
          ctx.fillStyle = (getComputedStyle(ctx.canvas).getPropertyValue('--ai').trim() || '#7a3fd0') as string;
          ctx.fillText(aiBadge, left, l.y);
          ctx.strokeText(tx.text, left + bw + 6, l.y);
          ctx.fillStyle = th.text;
          ctx.fillText(tx.text, left + bw + 6, l.y);
          ctx.textAlign = 'center';
        } else {
          ctx.strokeText(tx.text, l.x, l.y);
          ctx.fillStyle = th.text;
          ctx.fillText(tx.text, l.x, l.y);
        }
      }
      ctx.textAlign = 'left';
      const sig = `${shown}`;
      if (lastLabel.current !== sig) {
        lastLabel.current = sig;
        ctx.canvas.dataset['labels'] = sig;
      }
      if (animating) view.requestDraw();
    },
    hit(sx, sy, v, w, h) {
      // A point is hit within a few pixels of the pointer.
      return map.grid.nearest(toWorldX(v, sx, w), toWorldY(v, sy, h), 7 / v.k);
    },
    onHover(idx, sx, sy) {
      const i = idx ?? -1;
      if (i === hoverIdx.current) return;
      hoverIdx.current = i;
      setHover(i < 0 ? null : { idx: i, x: sx, y: sy });
      view.requestDraw();
    },
    onClick(idx) {
      onSelect(idx !== null && idx >= 0 ? map.ids[idx]! : null);
    },
    onDoubleClick(idx) {
      if (idx !== null && idx >= 0) return false;
      // A double click on a hull opens the topic; on the background it closes an open one (else the camera zooms in).
      const v = view.view.current;
      const { w, h } = view.size.current;
      const pt = lastPointer.current;
      const s = clusterAt(pt.x, pt.y, v, w, h);
      if (s >= 0) {
        openTopic(s);
        return true;
      }
      if (open.current) {
        open.current = null;
        view.requestDraw();
        return true;
      }
      return false;
    },
    bounds: () => (map.n > 0 ? map.bounds : null),
    // A small library is not blown up: the whole content spans at most about 500 px.
    maxFit: () => (map.n < 30 ? 500 / Math.max(map.bounds.maxX - map.bounds.minX, map.bounds.maxY - map.bounds.minY, 1e-9) : Infinity),
  });

  const lastPointer = useRef({ x: 0, y: 0 });

  /** The cluster whose hull contains the screen point (the smallest wins), or -1. */
  function clusterAt(px: number, py: number, v = view.view.current, w = view.size.current.w, h = view.size.current.h): number {
    let best = -1;
    let bestSize = Infinity;
    (map.levels[level] ?? []).forEach((c, s) => {
      const hull = hulls[s];
      if (!hull || hull.length === 0 || c.size >= bestSize) return;
      const shape = hullShape(hull.map((p) => [toScreenX(v, p[0], w), toScreenY(v, p[1], h)] as Pt), 16);
      if (shape.length > 2 && inPolygon(px, py, shape)) {
        best = s;
        bestSize = c.size;
      }
    });
    return best;
  }

  /** Opens a topic: its points spread out with a collision pass, so they can be picked one by one (D-379). */
  function openTopic(s: number): void {
    const g = map.groups[level];
    if (!g) return;
    const idx: number[] = [];
    for (let j = g.starts[s]!; j < g.starts[s + 1]! && idx.length < OPEN_MAX; j++) idx.push(g.order[j]!);
    const k = view.view.current.k;
    const rad = 9 / k;
    const px = idx.map((i) => map.xs[i]!);
    const py = idx.map((i) => map.ys[i]!);
    for (let pass = 0; pass < 40; pass++) {
      for (let a = 0; a < idx.length; a++) {
        for (let b = a + 1; b < idx.length; b++) {
          let dx = px[b]! - px[a]!;
          let dy = py[b]! - py[a]!;
          let d = Math.hypot(dx, dy);
          if (d >= rad) continue;
          if (d < 1e-9) {
            dx = Math.cos(a * 2.4 + b);
            dy = Math.sin(a * 2.4 + b);
            d = 1;
          }
          const push = (rad - Math.min(d, rad)) / 2 / d;
          px[a]! -= dx * push;
          py[a]! -= dy * push;
          px[b]! += dx * push;
          py[b]! += dy * push;
        }
      }
    }
    const dx = new Map<number, [number, number]>();
    idx.forEach((i, n) => dx.set(i, [px[n]! - map.xs[i]!, py[n]! - map.ys[i]!]));
    open.current = { cluster: s, dx, t: reducedMotion() ? 1 : 0, at: performance.now() };
    const c = map.levels[level]![s]!;
    view.flyTo(c.centroid.x, c.centroid.y, Math.max(view.view.current.k, k * 1.4));
    view.requestDraw();
  }

  /** The cluster index (at the current level) a point belongs to; the last (no topic) when it has none. */
  function clusterIndexOf(i: number): number {
    const g = map.groups[level];
    if (!g) return 0;
    const cl = map.levels[level] ?? [];
    for (let s = 0; s <= cl.length; s++) {
      // Binary search is not needed: the hover is one point.
      for (let j = g.starts[s]!; j < g.starts[s + 1]!; j++) if (g.order[j] === i) return s;
    }
    return 0;
  }

  const announceFor = (i: number): string => {
    const c = map.levels[level]?.[clusterIndexOf(i)];
    return c ? clusterText(c).text : '';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const v = view.view.current;
    const { w, h } = view.size.current;
    const inView = () => pointsInView(map, level, v, w, h);
    const setCursor = (next: number) => {
      cursor.current = next;
      hoverIdx.current = next;
      setHover(null);
      setFocused(next);
      view.requestDraw();
    };
    if (e.key === ']' || e.key === '[') {
      const next = stepPoint(inView(), cursor.current >= 0 ? cursor.current : selRef.current, e.key === ']');
      if (next < 0) return;
      setCursor(next);
      return e.preventDefault();
    }
    const a = mapAction(e);
    if (!a) return view.handlers.onKeyDown(e);
    switch (a.type) {
      case 'move': {
        const list = inView();
        const from = cursor.current >= 0 ? cursor.current : selRef.current;
        const sx = new Float64Array(map.n);
        const sy = new Float64Array(map.n);
        for (const i of list) {
          sx[i] = toScreenX(v, map.xs[i]!, w);
          sy[i] = toScreenY(v, map.ys[i]!, h);
        }
        const next = from < 0 || !list.includes(from) ? firstNode(sx, sy, list) : nearestInDirection(sx, sy, from, a.dir, list);
        if (next < 0) return;
        setCursor(next);
        break;
      }
      case 'open':
        if (cursor.current < 0) return;
        onSelect(map.ids[cursor.current]!);
        break;
      case 'read':
        if (cursor.current >= 0) onRead?.(map.ids[cursor.current]!);
        break;
      case 'zoom':
        view.zoom(a.factor);
        break;
      case 'fit':
        view.fit(true);
        break;
      case 'search':
        document.querySelector<HTMLInputElement>('[data-testid="map-search"]')?.focus();
        break;
      case 'escape':
        cursor.current = -1;
        setFocused(null);
        surprise.current = null;
        if (open.current) open.current = null;
        view.requestDraw();
        return view.handlers.onKeyDown(e);
      case 'explore':
        return onExplore?.();
      default:
        return;
    }
    e.preventDefault();
  };

  useImperativeHandle(
    handle,
    () => ({
      fit: () => view.fit(true),
      focusCluster(id) {
        const c = map.clusterById.get(id);
        if (!c) return;
        const v = view.view.current;
        view.flyTo(c.centroid.x, c.centroid.y, Math.max(v.k, v.k * 1.5));
      },
      shuffle() {
        appear.current = { t: reducedMotion() ? 1 : 0, at: 0 };
        open.current = null;
        view.requestDraw();
      },
      surprise(a, b) {
        const ia = map.indexOf.get(a);
        const ib = map.indexOf.get(b);
        if (ia === undefined || ib === undefined) return;
        surprise.current = { a: ia, b: ib };
        const { w, h } = view.size.current;
        const bx = Math.abs(map.xs[ia]! - map.xs[ib]!);
        const by = Math.abs(map.ys[ia]! - map.ys[ib]!);
        view.flyTo((map.xs[ia]! + map.xs[ib]!) / 2, (map.ys[ia]! + map.ys[ib]!) / 2, Math.min(Math.min(w, h) / Math.max(bx * 1.5, by * 1.5, 1e-9), view.view.current.k * 4));
        pulse.current = { idx: ia, at: performance.now() };
        view.requestDraw();
      },
      clearSurprise() {
        surprise.current = null;
        view.requestDraw();
      },
      flyToDoc(docId) {
        const i = map.indexOf.get(docId);
        if (i === undefined) return;
        view.flyTo(map.xs[i]!, map.ys[i]!, Math.max(view.view.current.k, 1) * 3);
        pulse.current = { idx: i, at: performance.now() };
        view.requestDraw();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, view, level],
  );

  // Another scope shows other points: fit again. A reload of the same scope (a new document placed) keeps the view.
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) firstFit.current = false;
    else view.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useEffect(() => {
    hoverIdx.current = -1;
    cursor.current = -1;
    open.current = null;
    surprise.current = null;
    setFocused(null);
    setHover(null);
    view.requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, level, selIdx, tints]);

  const paintMini = useCallback(
    (ctx: CanvasRenderingContext2D, to: (x: number, y: number) => [number, number]) => {
      const th = theme.current;
      (map.levels[level] ?? []).forEach((c, s) => {
        const [x, y] = to(c.centroid.x, c.centroid.y);
        ctx.fillStyle = th?.tints[tintRef.current.tint[s] ?? 0] ?? '#888';
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(x, y, 2 + Math.sqrt(c.size / Math.max(map.n, 1)) * 14, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    },
    [map, level],
  );

  const hoverTopic = hover ? announceFor(hover.idx) : '';
  return (
    <div className="map-wrap">
      <canvas
        ref={view.canvas}
        className="map-canvas"
        tabIndex={0}
        role="application"
        aria-roledescription={t('network.roleMap')}
        aria-label={label}
        data-testid="map-canvas"
        data-points={map.n}
        data-level={level}
        {...view.handlers}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          lastPointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          view.handlers.onPointerMove(e);
        }}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          lastPointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          view.handlers.onDoubleClick(e);
        }}
        onKeyDown={onKeyDown}
      />
      {focused !== null && <Announce docId={map.ids[focused]!} topic={announceFor(focused)} />}
      {hover && (
        <HoverCard x={hover.x} y={hover.y} width={view.size.current.w} height={view.size.current.h} testId="map-tooltip">
          <DocCard docId={map.ids[hover.idx]!} topic={hoverTopic} />
        </HoverCard>
      )}
      {minimap && map.n > 0 && <MiniMap bounds={map.bounds} view={view.view} size={view.size} hooks={view.hooks} paint={paintMini} onMove={(x, y) => view.jump({ ...view.view.current, cx: x, cy: y })} label={t('network.minimapLabel')} version={`${level}:${map.n}:${tints.tint.join(',')}`} />}
    </div>
  );
}

