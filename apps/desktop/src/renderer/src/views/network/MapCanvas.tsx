import { createPortal } from 'react-dom';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { isDarkTheme } from '../../lib/theme';
import { reducedMotion } from './camera';
import { withAlpha, haloSprite, mix, readTheme, type MapTheme } from './colors';
import { boundsOf, fitView, PointGrid, toScreenX, toScreenY, toWorldX, toWorldY, type View } from './geometry';
import { Menu } from '../../components/Menu';
import type { BridgePath } from './BridgePath';
import { bridgeGeo, bridgeView, drawBridge } from './bridgeLayer';
import { DocCard, HoverCard, useRestingHover } from './HoverCard';
import { coreRadius } from './hulls';
import { areaSummary, shareIn, withUserTints, type AreaDef } from './areaColors';
import { FREE_LABEL_CAP, placeTopicLabels, shortLabel, type TopicLabelItem } from './labelsLod';
import { firstNode, mapAction, nearestInDirection } from './mapKeyboard';
import { clusterText, nodeRadius, paintPoints, pointsInView, stepPoint, type PointPaint, type PreparedMap } from './mapModel';
import { blockView, DOT_X, DOT_Y, dotX, dotY, drawBlocks, hitBlocks, paintLabels, type BlockView } from './blocksDraw';
import { adjacency, bundleEdges, selectEdges, type EdgeMode, type EvEdge } from './edges';
import { centralPapers } from './labelsLod';
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
  /** The canvas (for "copy as image"). */
  canvas(): HTMLCanvasElement | null;
  /** Lights a group (legend hover or focus) or none (null). */
  light(id: string | null): void;
  /** Lights an area of the legend (nodes with less than 20 % in it fade to 25 %) or none. */
  lightArea(area: number | null): void;
  /** Isolates an area (the others fade to 15 %) or releases it. */
  isolateArea(area: number | null): void;
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
  /** Double click or Enter on a paper: its neighbourhood. */
  onVicinity?(docId: string): void;
  aiBadge: string;
  label: string;
  /** Changes when the view must be fitted again (another scope). */
  fitKey: string;
  handle?: Ref<MapHandle>;
  /** Stable tint index (0..9) of each topic of the level and whether its outline is dashed (more than ten topics touching). */
  tints: { tint: number[]; dashed: boolean[] };
  /** Colour by macro-area (D-483): the areas and the tint slot of each; null colours by topic. */
  areas?: { defs: readonly AreaDef[]; slots: readonly number[] } | null;
  /** Documents that pass the filters (null: all); the others fade and shrink. */
  allow: ReadonlySet<string> | null;
  minimap: boolean;
  /** A bridge to draw (A, the work outside the library, B), from Discover. */
  bridge?: BridgePath | null;
  /** "Find a bridge" between two documents of the map (opens Discover). */
  onBridge?(a: string, b: string): void;
  /** "Find links" of the card's menu (section 18.2). */
  onFindLinks?(docId: string): void;
  /** "Export" of the card of a topic label (macro-area colours, section 18.3.6). */
  onTopicExport?(id: string, text: string): void;
  /** Pill, legend: drawn over the canvas (never beside or above it). */
  overlay?: ReactNode;
  /** The blocks of the chosen family (section 19.2.2); null or absent: the free layout of the map. */
  blocks?: BlocksProp | null;
  /** Evidence between papers, already filtered by the chips; which of it is drawn follows `edgeMode`. */
  evidence?: readonly EvEdge[];
  edgeMode?: EdgeMode;
  /** Where the minimap goes (the side column), shown only beyond 150 papers. */
  minimapSlot?: HTMLElement | null;
}
export interface BlocksProp {
  view: BlockView;
}

const OPEN_MAX = 600;

/** The note while the second document of a bridge is being chosen. */
function BridgePick({ docId, onCancel }: { docId: string; onCancel(): void }) {
  const { t } = useTranslation();
  const title = useDocTitle(docId);
  return (
    <p className="surprise-note bridge-note" role="status" data-testid="map-bridge-pick">
      {t('network.bridge.pickSecond', { title: safeText(title ?? docId.slice(0, 8)) })}
      <button type="button" className="link" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </p>
  );
}

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
 * topics (no outline: their labels sit over the core) coloured by macro-area or by topic; a card on hover; the minimap; the camera of useCanvasView.
 * Double click on a label or a point opens the topic (its points spread out), Esc or a double click on the background closes it. Arrows go
 * to the nearest point that way, `]` and `[` walk through the points in view, Enter selects, Shift+Enter reads, `L` opens Explore.
 * React renders only when the hovered or focused point changes, never per frame; nothing runs at rest.
 */
function FreeCanvas({ map, level, selected, onSelect, onRead, onExplore, onVicinity, aiBadge, label, fitKey, handle, tints, areas = null, allow, minimap, bridge = null, onBridge, onFindLinks, onTopicExport, overlay, evidence, minimapSlot }: Props) {
  const { t } = useTranslation();
  const [hover, setHover, holdHover] = useRestingHover<{ idx: number; x: number; y: number }>(150, 250);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [second, setSecond] = useState<number | null>(null);
  const secondRef = useRef<number | null>(null);
  secondRef.current = second;
  const moreBtn = useRef<HTMLButtonElement>(null);
  /** The card of a topic label that was clicked (with colours by macro-area the legend has no topic rows): name and a menu. */
  const [labelCard, setLabelCard] = useState<{ s: number; x: number; y: number } | null>(null);
  const [labelMenu, setLabelMenu] = useState(false);
  const labelBtn = useRef<HTMLButtonElement>(null);
  /** Where the labels of the topics were drawn last (they can be dragged), and the drag in progress. */
  const labelBoxes = useRef<Array<{ s: number; x: number; y: number; w: number }>>([]);
  const drag = useRef<{ kind: 'label'; s: number; wx: number; wy: number } | { kind: 'point'; i: number } | null>(null);
  const geo = useMemo(
    () =>
      bridge
        ? bridgeGeo(bridge, (id) => {
            const i = map.indexOf.get(id);
            return i === undefined ? null : [map.xs[i]!, map.ys[i]!];
          })
        : null,
    [bridge, map],
  );
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [focused, setFocused] = useState<number | null>(null);
  const hoverIdx = useRef(-1);
  /** The point the keyboard cursor is on (-1: none). */
  const cursor = useRef(-1);
  const selIdx = selected !== null ? (map.indexOf.get(selected) ?? -1) : -1;
  const selRef = useRef(selIdx);
  selRef.current = selIdx;
  const freeAdj = useRef<Map<string, EvEdge[]>>(new Map());
  freeAdj.current = useMemo(() => adjacency(evidence ?? []), [evidence]);
  const lastLabel = useRef<string>('');
  const theme = useRef<MapTheme | null>(null);
  /** Core circle of every topic (centre and 80th percentile radius): where its label goes. Nothing is outlined (D-482). */
  const cores = useMemo(() => {
    const g = map.groups[level];
    return (map.levels[level] ?? []).map((_, s) => (g ? coreRadius(map.xs, map.ys, g.order, g.starts[s]!, g.starts[s + 1]!) : { cx: 0, cy: 0, r: 0 }));
  }, [map, level]);
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const litArea = useRef(-1);
  const isoArea = useRef(-1);
  const paintRef = useRef<{ map: PreparedMap; areas: unknown; dark: boolean; paint: PointPaint } | null>(null);
  /** The colours of the points by area for this map, palette and theme (null when colouring by topic). */
  const areaPaint = (th: MapTheme): PointPaint | null => {
    const a = areasRef.current;
    if (!a) return null;
    const c = paintRef.current;
    if (c && c.map === map && c.areas === a && c.dark === th.dark) return c.paint;
    const u = withUserTints(a.defs, a.slots, th.areas, th.bg);
    const paint = paintPoints(map, u.slots, u.tokens);
    paintRef.current = { map, areas: a, dark: th.dark, paint };
    return paint;
  };
  const clusterOf = useMemo(() => {
    const g = map.groups[level];
    const of = new Int32Array(map.n);
    if (g) for (let s = 0; s + 1 < g.starts.length; s++) for (let j = g.starts[s]!; j < g.starts[s + 1]!; j++) of[g.order[j]!] = s;
    return of;
  }, [map, level]);
  /** The cluster lit by the pointer or by the legend / keyboard (-1: none): the other points go to 35 %, its own get a ring. */
  const lit = useRef(-1);
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
      // Circles below 5000 points (radius 3-6 px by the size of the topic), squares of 2-5 px above.
      const round = map.n <= 5000;
      const cmax = clusters[0]?.size ?? 1;
      const grow = small ? 1.5 : 1;
      const sq = Math.min(5, Math.max(2, 1.2 + Math.sqrt(v.k / Math.max(map.n, 1)) * 40));
      const size = round ? 6 * grow : sq;
      const half = round ? 4.5 * grow : sq / 2;
      const litS = lit.current;
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
      // Labels of the topics: the box of the core of each one (no outline is drawn).
      const topicItems: TopicLabelItem[] = [];
      const texts: Array<{ text: string; ai: boolean; c: number }> = [];
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      clusters.forEach((c, s) => {
        const core = cores[s];
        if (!core || c.size === 0) return;
        const r = core.r * v.k + 6;
        const cx = toScreenX(v, core.cx, w);
        const cy = toScreenY(v, core.cy, h);
        const text = clusterText(c);
        const label = shortLabel(text.text);
        if (label === '') return;
        const tw = ctx.measureText(label).width + (text.ai ? ctx.measureText(aiBadge).width + 16 : 0) + 10;
        texts.push({ text: label, ai: text.ai, c: s });
        topicItems.push({ id: texts.length - 1, box: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, w: tw, size: c.size });
      });
      // Points: one path per colour (the tint of a topic, or a bucket of area colours), culled to the viewport.
      const al = allowRef.current;
      const op = open.current;
      const paint = areaPaint(th);
      const areaLit = isoArea.current >= 0 ? isoArea.current : litArea.current;
      const areaOn = paint !== null && areaLit >= 0;
      const topicLit = !areaOn && litS >= 0;
      const anyDim = areaOn || topicLit;
      const dimAlpha = isoArea.current >= 0 ? 0.15 : areaOn ? 0.25 : 0.35;
      const units: Array<{ color: string; none: boolean; from: number; to: number; at(j: number): number }> = [];
      if (paint) for (const bk of paint.buckets) units.push({ color: bk.color, none: bk.none, from: 0, to: bk.idx.length, at: (j) => bk.idx[j]! });
      else {
        const groups = g ? clusters.length + 1 : 1;
        for (let s = 0; s < groups; s++) {
          const from = g ? g.starts[s]! : 0;
          const to = g ? g.starts[s + 1]! : map.n;
          if (from === to) continue;
          units.push({ color: g && s < clusters.length ? (th.tints[tintRef.current.tint[s] ?? 0] ?? th.muted) : th.muted, none: false, from, to, at: (j) => (g ? g.order[j]! : j) });
        }
      }
      const rings: number[] = [];
      let count = 0;
      for (const u of units) {
        for (const pass of al ? [true, false] : [true]) {
          for (const dimmed of anyDim ? [false, true] : [false]) {
            ctx.fillStyle = u.none ? th.bg : u.color;
            ctx.globalAlpha = (pass ? Math.max(ease, 0.001) : 0.08 + 0.92 * (1 - f.t)) * (dimmed ? dimAlpha : 1);
            ctx.beginPath();
            rings.length = 0;
            for (let j = u.from; j < u.to; j++) {
              const i = u.at(j);
              if (al && al.has(map.ids[i]!) !== pass) continue;
              const cs = clusterOf[i]!;
              if (op && op.cluster === cs) continue;
              if (anyDim && (areaOn ? shareIn(map.ar[i], areaLit) < 0.2 : cs !== litS) !== dimmed) continue;
              const c0 = g && cs < clusters.length ? clusters[cs]!.centroid : null;
              let x = map.xs[i]!;
              let y = map.ys[i]!;
              if (c0 && ease < 1) {
                x = c0.x + (x - c0.x) * ease;
                y = c0.y + (y - c0.y) * ease;
              }
              const sx = (x - v.cx) * v.k + w / 2;
              const sy = (y - v.cy) * v.k + h / 2;
              if (sx < -size || sy < -size || sx > w + size || sy > h + size) continue;
              const rad = (round ? (c0 ? nodeRadius(clusters[cs]!.size, cmax) : 3) : sq / 2) * grow;
              const hs = pass ? rad : rad * (0.5 + 0.5 * (1 - f.t));
              if (round) {
                ctx.moveTo(sx + hs, sy);
                ctx.arc(sx, sy, hs, 0, Math.PI * 2);
              } else ctx.rect(sx - hs, sy - hs, hs * 2, hs * 2);
              if (topicLit && !dimmed) rings.push(sx, sy, hs);
              count++;
            }
            ctx.fill();
            if (round || u.none) {
              ctx.strokeStyle = u.none ? th.areas[8]! : th.bg;
              ctx.lineWidth = u.none ? 1.5 : 1.5;
              ctx.stroke();
            }
            if (rings.length > 0) {
              ctx.strokeStyle = u.color;
              ctx.lineWidth = 1;
              ctx.beginPath();
              for (let k = 0; k < rings.length; k += 3) {
                ctx.moveTo(rings[k]! + rings[k + 2]! + 1.8, rings[k + 1]!);
                ctx.arc(rings[k]!, rings[k + 1]!, rings[k + 2]! + 1.8, 0, Math.PI * 2);
              }
              ctx.stroke();
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      // An open topic: its points spread out (collision), drawn as small circles.
      if (op) {
        if (op.t < 1) {
          op.t = Math.min(1, (now - op.at) / 300);
          animating = true;
        }
        for (const [i, [dx, dy]] of op.dx) {
          ctx.fillStyle = pointColor(i, th);
          const x = toScreenX(v, map.xs[i]! + dx * op.t, w);
          const y = toScreenY(v, map.ys[i]! + dy * op.t, h);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          count++;
        }
      }
      if (ctx.canvas.dataset['drawn'] !== String(count)) ctx.canvas.dataset['drawn'] = String(count);
      // Titles of the papers (section 19.2.4): the hovered, the selected, the neighbours of the selection and the central ones (by evidence), at most 40, none over another.
      if (!op && map.n > 0 && (map.n <= 3000 || v.k / fitView(map.bounds, w, h).k >= 2.5)) {
        const adj = freeAdj.current;
        const deg = (i: number): number => adj.get(map.ids[i]!)?.length ?? 0;
        const vis: number[] = [];
        for (let i = 0; i < map.n; i++) {
          const x = toScreenX(v, map.xs[i]!, w);
          const y = toScreenY(v, map.ys[i]!, h);
          if (x >= 0 && y >= 0 && x <= w && y <= h) vis.push(i);
        }
        const force = new Set<number>([hoverIdx.current, selRef.current].filter((i) => i >= 0));
        if (selRef.current >= 0) for (const e of (adj.get(map.ids[selRef.current]!) ?? []).slice(0, 5)) force.add(map.indexOf.get(e.a === map.ids[selRef.current] ? e.b : e.a) ?? -1);
        const pick = new Set<number>([...vis.sort((a, b) => deg(b) - deg(a) || a - b).slice(0, FREE_LABEL_CAP * 2), ...[...force].filter((i) => i >= 0)]);
        const items = [...pick].map((i) => ({ id: map.ids[i]!, x: toScreenX(v, map.xs[i]!, w), y: toScreenY(v, map.ys[i]!, h), forced: force.has(i), rank: deg(i) }));
        paintLabels(ctx, items, [], w, h, 150, th, () => view.requestDraw(), FREE_LABEL_CAP);
      }
      // Hover halo (additive in the dark theme), selected and cursor rings.
      const at = (i: number): [number, number] => {
        const d = op?.dx.get(i);
        return d ? [map.xs[i]! + d[0] * op!.t, map.ys[i]! + d[1] * op!.t] : [map.xs[i]!, map.ys[i]!];
      };
      const hi = hoverIdx.current;
      if (hi >= 0) {
        const sprite = haloSprite(pointColor(hi, th));
        const hx = toScreenX(v, at(hi)[0], w);
        const hy = toScreenY(v, at(hi)[1], h);
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
        ctx.arc(toScreenX(v, at(idx)[0], w), toScreenY(v, at(idx)[1], h), size + 3, 0, Math.PI * 2);
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
      if (geoRef.current) drawBridge(ctx, th, geoRef.current, (p) => [toScreenX(v, p[0], w), toScreenY(v, p[1], h)], shortLabel);
      // Labels of the topics, in their own colour above the core: none over another (above, below, right, left; the smallest is hidden).
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let shown = 0;
      labelBoxes.current = [];
      const spots = placeTopicLabels(topicItems, w, h);
      for (const [id, at] of spots) {
        const tx = texts[id]!;
        const tint = areasRef.current ? th.muted : (th.tints[tintRef.current.tint[tx.c] ?? 0] ?? th.text);
        const ink = areasRef.current ? mix(th.muted, th.text, 0.5) : mix(tint, th.text, dark ? 0.15 : 0.4);
        const tw = topicItems.find((it) => it.id === id)!.w;
        shown++;
        labelBoxes.current.push({ s: tx.c, x: at.x, y: at.y, w: tw });
        ctx.lineWidth = 3;
        ctx.strokeStyle = th.bg;
        if (tx.ai) {
          const bw = ctx.measureText(aiBadge).width;
          ctx.textAlign = 'left';
          const left = at.x - tw / 2 + 5;
          ctx.strokeText(aiBadge, left, at.y);
          ctx.fillStyle = (getComputedStyle(ctx.canvas).getPropertyValue('--ai').trim() || '#7a3fd0') as string;
          ctx.fillText(aiBadge, left, at.y);
          ctx.strokeText(tx.text, left + bw + 6, at.y);
          ctx.fillStyle = ink;
          ctx.fillText(tx.text, left + bw + 6, at.y);
          ctx.textAlign = 'center';
        } else {
          ctx.strokeText(tx.text, at.x, at.y);
          ctx.fillStyle = ink;
          ctx.fillText(tx.text, at.x, at.y);
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
      // The points of an open topic are where they were spread to; then a point within a few pixels of the pointer; then a topic label (-2 - topic).
      const op = open.current;
      if (op) {
        for (const [i, [dx, dy]] of op.dx) {
          if (Math.hypot(toScreenX(v, map.xs[i]! + dx * op.t, w) - sx, toScreenY(v, map.ys[i]! + dy * op.t, h) - sy) <= 7) return i;
        }
      }
      const p = map.grid.nearest(toWorldX(v, sx, w), toWorldY(v, sy, h), 7 / v.k);
      if (p >= 0) return p;
      for (const b of labelBoxes.current) if (Math.abs(sx - b.x) <= b.w / 2 && Math.abs(sy - b.y) <= 10) return -2 - b.s;
      return -1;
    },
    onHover(idx, sx, sy) {
      if (view.canvas.current) view.canvas.current.style.cursor = idx !== null && idx <= -2 ? 'grab' : '';
      const i = idx !== null && idx >= 0 ? idx : -1;
      // The group under the pointer (a point or its label) is lit; the legend or the keyboard may hold one lit (focusLit).
      if (idx !== null) focusLit.current = false;
      if (!focusLit.current) {
        const c = i >= 0 ? clusterOf[i]! : idx !== null && idx <= -2 ? -2 - idx : -1;
        if (c !== lit.current) {
          lit.current = c;
          view.requestDraw();
        }
      }
      if (i === hoverIdx.current) return;
      hoverIdx.current = i;
      setHover(i < 0 ? null : { idx: i, x: sx, y: sy });
      view.requestDraw();
    },
    onClick(idx) {
      if (idx !== null && idx <= -2) {
        if (areas && onTopicExport) setLabelCard({ s: -2 - idx, x: lastPointer.current.x, y: lastPointer.current.y });
        return;
      }
      setLabelCard(null);
      const s2 = secondRef.current;
      if (s2 !== null) {
        setSecond(null);
        if (idx !== null && idx >= 0 && idx !== s2) onBridge?.(map.ids[s2]!, map.ids[idx]!);
        return;
      }
      onSelect(idx !== null && idx >= 0 ? map.ids[idx]! : null);
    },
    // Drag a topic label: the whole topic moves with it. Drag a point of an open topic: it stays where it is dropped.
    dragStart(hit, wx, wy) {
      if (hit <= -2) {
        drag.current = { kind: 'label', s: -hit - 2, wx, wy };
        if (view.canvas.current) view.canvas.current.style.cursor = 'grabbing';
        return true;
      }
      const op = open.current;
      if (hit >= 0 && op?.dx.has(hit)) {
        op.t = 1;
        drag.current = { kind: 'point', i: hit };
        return true;
      }
      return false;
    },
    dragMove(_hit, wx, wy) {
      const d = drag.current;
      if (!d) return;
      if (d.kind === 'point') {
        open.current?.dx.set(d.i, [wx - map.xs[d.i]!, wy - map.ys[d.i]!]);
        return;
      }
      const dx = wx - d.wx;
      const dy = wy - d.wy;
      d.wx = wx;
      d.wy = wy;
      const g = map.groups[level];
      const c = map.levels[level]?.[d.s];
      if (!g || !c) return;
      for (let j = g.starts[d.s]!; j < g.starts[d.s + 1]!; j++) {
        const i = g.order[j]!;
        map.xs[i]! += dx;
        map.ys[i]! += dy;
      }
      c.centroid.x += dx;
      c.centroid.y += dy;
      const core = cores[d.s];
      if (core) {
        core.cx += dx;
        core.cy += dy;
      }
    },
    dragEnd() {
      if (drag.current?.kind === 'label') map.grid = new PointGrid(map.xs, map.ys, map.n, boundsOf(map.xs, map.ys, map.n));
      drag.current = null;
      if (view.canvas.current) view.canvas.current.style.cursor = '';
    },
    onDoubleClick(idx) {
      // A double click on a topic's label or on one of its points (the nearest within 12 px) opens the topic; on the background it closes an open one (else the camera zooms in).
      const v = view.view.current;
      const { w, h } = view.size.current;
      const pt = lastPointer.current;
      const near = idx !== null && idx >= 0 ? idx : map.grid.nearest(toWorldX(v, pt.x, w), toWorldY(v, pt.y, h), 12 / v.k);
      const s = idx !== null && idx <= -2 ? -2 - idx : near >= 0 ? clusterOf[near]! : -1;
      if (s >= 0 && s < (map.levels[level]?.length ?? 0)) {
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
  /** True while the legend or the keyboard holds a group lit: the pointer does not change it until it leaves the canvas or Esc. */
  const focusLit = useRef(false);

  /** Colour of a point: its area colour, or the tint of its topic. */
  function pointColor(i: number, th: MapTheme): string {
    const p = areaPaint(th);
    if (p) return p.colors[i]!;
    return th.tints[tintRef.current.tint[clusterIndexOf(i)] ?? 0] ?? th.muted;
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
    return map.groups[level] ? (clusterOf[i] ?? 0) : 0;
  }

  /** "Find a bridge" from a document: with another one selected the pair is known, else the next click picks the second. */
  function startBridge(i: number): void {
    const a = map.ids[i]!;
    if (selected !== null && selected !== a) onBridge?.(a, selected);
    else setSecond(i);
  }

  // A bridge arrives from Discover: the camera shows the three points.
  useEffect(() => {
    if (!geo) return;
    const run = setTimeout(() => {
      const { w, h } = view.size.current;
      const b = bridgeView(geo, w || 800, h || 600);
      view.flyTo(b.x, b.y, Math.min(b.k, 40));
    }, 60);
    view.requestDraw();
    return () => clearTimeout(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

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
      lit.current = clusterOf[next]!;
      focusLit.current = true;
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
    if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && cursor.current >= 0 && onBridge) {
      startBridge(cursor.current);
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
        onVicinity?.(map.ids[cursor.current]!);
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
        lit.current = -1;
        litArea.current = -1;
        isoArea.current = -1;
        focusLit.current = false;
        cursor.current = -1;
        setFocused(null);
        setSecond(null);
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
        lit.current = (map.levels[level] ?? []).indexOf(c);
        focusLit.current = lit.current >= 0;
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
      canvas: () => view.canvas.current,
      light(id) {
        const c = id === null ? undefined : map.clusterById.get(id);
        lit.current = c ? (map.levels[level] ?? []).indexOf(c) : -1;
        focusLit.current = lit.current >= 0;
        view.requestDraw();
      },
      lightArea(area) {
        litArea.current = area ?? -1;
        view.requestDraw();
      },
      isolateArea(area) {
        isoArea.current = area ?? -1;
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
  useEffect(() => {
    if (!areas) litArea.current = isoArea.current = -1;
    view.requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  const paintMini = useCallback(
    (ctx: CanvasRenderingContext2D, to: (x: number, y: number) => [number, number]) => {
      const th = theme.current;
      (map.levels[level] ?? []).forEach((c, s) => {
        const [x, y] = to(c.centroid.x, c.centroid.y);
        ctx.fillStyle = areasRef.current ? (th?.muted ?? '#888') : (th?.tints[tintRef.current.tint[s] ?? 0] ?? '#888');
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
      {focused !== null && <Announce docId={map.ids[focused]!} topic={`${announceFor(focused)}${areas ? ` · ${areaSummary(map.ar[focused], areas.defs)}` : ''}`} />}
      {hover && (
        <HoverCard x={hover.x} y={hover.y} width={view.size.current.w} height={view.size.current.h} testId="map-tooltip" live={onBridge ? { label: t('network.card.actions'), onEnter: () => holdHover(true), onLeave: () => menuFor === null && holdHover(false) } : undefined}>
          <DocCard docId={map.ids[hover.idx]!} topic={hoverTopic} area={areas ? areaSummary(map.ar[hover.idx], areas.defs) : undefined} />
          {onBridge && (
            <button ref={moreBtn} type="button" className="icon-button hc-more" aria-haspopup="menu" aria-label={t('network.more')} title={t('network.more')} onClick={() => setMenuFor(hover.idx)} data-testid="map-card-more">
              <span aria-hidden="true">⋯</span>
            </button>
          )}
        </HoverCard>
      )}
      <Menu
        anchor={moreBtn}
        open={menuFor !== null}
        label={t('network.card.actions')}
        onClose={() => {
          setMenuFor(null);
          holdHover(false);
        }}
        groups={[{ id: 'doc', items: [{ id: 'bridge', testId: 'map-card-bridge', label: t('network.bridge.find'), onSelect: () => menuFor !== null && startBridge(menuFor) }, ...(onFindLinks ? [{ id: 'links', testId: 'map-card-links', label: t('network.edge.findLinks'), onSelect: () => menuFor !== null && onFindLinks(map.ids[menuFor]!) }] : [])] }]}
      />
      {labelCard && (() => {
        const c = map.levels[level]?.[labelCard.s];
        if (!c || !onTopicExport) return null;
        const txt = clusterText(c).text || c.id;
        return (
          <>
            <HoverCard x={labelCard.x} y={labelCard.y} width={view.size.current.w} height={view.size.current.h} testId="map-label-card" live={{ label: t('network.card.topicActions'), onEnter: () => undefined, onLeave: () => undefined }}>
              <strong className="hc-title">{safeText(txt)}</strong>
              <span className="hc-line hint">{map.levels[level]![labelCard.s]!.size}</span>
              <button ref={labelBtn} type="button" className="icon-button hc-more" aria-haspopup="menu" aria-label={t('network.more')} title={t('network.more')} onClick={() => setLabelMenu(true)} data-testid="map-label-more">
                <span aria-hidden="true">⋯</span>
              </button>
            </HoverCard>
            <Menu
              anchor={labelBtn}
              open={labelMenu}
              label={t('network.card.topicActions')}
              onClose={() => setLabelMenu(false)}
              groups={[{ id: 'topic', items: [
                { id: 'open', testId: 'map-label-open', label: t('network.card.openTopic'), onSelect: () => (openTopic(labelCard.s), setLabelCard(null)) },
                { id: 'export', testId: 'cluster-export', label: t('secondBrain.clusterButton'), onSelect: () => (onTopicExport(c.id, txt), setLabelCard(null)) },
              ] }]}
            />
          </>
        );
      })()}
      {second !== null && <BridgePick docId={map.ids[second]!} onCancel={() => setSecond(null)} />}
      {overlay}
      {minimapSlot && minimap && map.n > 150 && createPortal(<MiniMap bounds={map.bounds} view={view.view} size={view.size} hooks={view.hooks} paint={paintMini} onMove={(x, y) => view.jump({ ...view.view.current, cx: x, cy: y })} label={t('network.minimapLabel')} version={`${level}:${map.n}:${tints.tint.join(',')}:${areas ? 'a' : 't'}`} />, minimapSlot)}
    </div>
  );
}


/** The papers in view, in the order of the blocks. */
function papersInView(bv: BlockView, v: View, w: number, h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < bv.ids.length; i++) {
    const x = toScreenX(v, bv.x[i]! + DOT_X, w);
    const y = toScreenY(v, bv.y[i]! + DOT_Y, h);
    if (x >= 0 && y >= 0 && x <= w && y <= h) out.push(i);
  }
  return out;
}

/**
 * The Map in blocks (D-498): one block per value of the family, each paper in its cell with its title, evidence edges only for the selected or
 * hovered paper (or the strongest, bundled between blocks). The same camera, card and keyboard as the free layout; nothing runs at rest.
 */
function BlocksCanvas({ blocks, evidence = [], edgeMode = 'selected', selected, onSelect, onRead, onExplore, onVicinity, label, fitKey, handle, allow, minimap, minimapSlot, onBridge, onFindLinks }: Props & { blocks: BlocksProp }) {
  const { t } = useTranslation();
  const bv = blocks.view;
  const [hover, setHover, holdHover] = useRestingHover<{ idx: number; x: number; y: number }>(150, 250);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [second, setSecond] = useState<number | null>(null);
  const secondRef = useRef<number | null>(null);
  secondRef.current = second;
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const hoverIdx = useRef(-1);
  const cursor = useRef(-1);
  const lit = useRef(-1);
  const theme = useRef<MapTheme | null>(null);
  const surprise = useRef<{ a: number; b: number } | null>(null);
  const pulse = useRef<{ idx: number; at: number } | null>(null);
  const flyRef = useRef<{ from: Map<string, [number, number]>; t: number; at: number } | null>(null);
  const lastBv = useRef(bv);
  const selIdx = selected !== null ? (bv.index.get(selected) ?? -1) : -1;
  const selRef = useRef(selIdx);
  selRef.current = selIdx;
  const allowRef = useRef(allow);
  allowRef.current = allow;
  const adj = useMemo(() => adjacency(evidence), [evidence]);
  const central = useMemo(() => centralPapers(Float64Array.from(bv.ids, (id) => adj.get(id)?.length ?? 0), bv.block), [bv, adj]);
  const strong = useMemo(() => {
    const edges = edgeMode === 'strong' ? selectEdges('strong', adj, []) : [];
    return bundleEdges(edges, (id) => (bv.index.has(id) ? bv.block[bv.index.get(id)!]! : -1));
  }, [edgeMode, adj, bv]);
  const neighbors = useMemo(() => {
    const out = new Set<number>();
    if (selected !== null) for (const e of (adj.get(selected) ?? []).slice(0, 5)) out.add(bv.index.get(e.a === selected ? e.b : e.a) ?? -1);
    out.delete(-1);
    return out;
  }, [selected, adj, bv]);
  const stateRef = useRef({ adj, central, strong, neighbors, edgeMode, bv, selected });
  stateRef.current = { adj, central, strong, neighbors, edgeMode, bv, selected };
  const focusLit = useRef(false);
  const probeOut = useRef<{ labels: unknown[]; names: unknown[]; edges: EvEdge[]; bundles: number } | null>(null);

  const view = useCanvasView<number>({
    draw(ctx, w, h, v) {
      const dark = isDarkTheme();
      if (theme.current?.dark !== dark) theme.current = readTheme(ctx.canvas, dark);
      const th = theme.current!;
      const st = stateRef.current;
      let animating = false;
      const fl = flyRef.current;
      if (fl) {
        if (fl.at === 0) fl.at = performance.now();
        fl.t = Math.min(1, (performance.now() - fl.at) / 300);
        animating = fl.t < 1;
        if (!animating) flyRef.current = null;
      }
      const hoverId = hoverIdx.current >= 0 ? st.bv.ids[hoverIdx.current]! : null;
      const shown = st.edgeMode === 'strong' ? st.strong : { single: selectEdges(st.edgeMode, st.adj, [st.selected, hoverId]), bundles: [] };
      const out = drawBlocks({ ctx, w, h, v, bv: st.bv, th, hover: hoverIdx.current, sel: selRef.current, cursor: cursor.current, lit: lit.current, edges: shown.single, bundles: shown.bundles, forced: st.neighbors, central: st.central, allow: allowRef.current, fly: flyRef.current, redraw: () => view.requestDraw() });
      probeOut.current = { labels: out.labels, names: out.names, edges: shown.single, bundles: shown.bundles.length };
      const sig = `${out.labels.length}`;
      if (ctx.canvas.dataset['labels'] !== sig) ctx.canvas.dataset['labels'] = sig;
      ctx.canvas.dataset['drawn'] = String(st.bv.ids.length);
      const pl = pulse.current;
      if (pl) {
        const age = (performance.now() - pl.at) / 1000;
        if (age < 1.2) {
          animating = true;
          ctx.strokeStyle = th.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(toScreenX(v, dotX(st.bv, pl.idx), w), toScreenY(v, dotY(st.bv, pl.idx), h), 8 + Math.abs(Math.sin(age * Math.PI * 2)) * 8, 0, Math.PI * 2);
          ctx.stroke();
        } else pulse.current = null;
      }
      const sr = surprise.current;
      if (sr) {
        const ax = toScreenX(v, dotX(st.bv, sr.a), w);
        const ay = toScreenY(v, dotY(st.bv, sr.a), h);
        const bx = toScreenX(v, dotX(st.bv, sr.b), w);
        const by = toScreenY(v, dotY(st.bv, sr.b), h);
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2 + (by - ay) * 0.2, (ay + by) / 2 - (bx - ax) * 0.2, bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (animating) view.requestDraw();
    },
    hit: (sx, sy, v, w, h) => hitBlocks(bv, toWorldX(v, sx, w), toWorldY(v, sy, h)),
    onHover(idx, sx, sy) {
      if (view.canvas.current) view.canvas.current.style.cursor = idx !== null && idx <= -2 ? 'pointer' : '';
      if (idx !== null) focusLit.current = false;
      if (!focusLit.current) {
        const b = idx !== null && idx <= -2 ? -2 - idx : -1;
        if (b !== lit.current) {
          lit.current = b;
          view.requestDraw();
        }
      }
      const i = idx !== null && idx >= 0 ? idx : -1;
      if (i === hoverIdx.current) return;
      hoverIdx.current = i;
      setHover(i < 0 ? null : { idx: i, x: sx, y: sy });
      view.requestDraw();
    },
    onClick(idx) {
      if (idx !== null && idx <= -2) {
        const b = -2 - idx;
        lit.current = lit.current === b && focusLit.current ? -1 : b;
        focusLit.current = lit.current >= 0;
        view.requestDraw();
        return;
      }
      const s2 = secondRef.current;
      if (s2 !== null) {
        setSecond(null);
        if (idx !== null && idx >= 0 && idx !== s2) onBridge?.(bv.ids[s2]!, bv.ids[idx]!);
        return;
      }
      if (idx === null || idx < 0) {
        lit.current = -1;
        focusLit.current = false;
      }
      onSelect(idx !== null && idx >= 0 ? bv.ids[idx]! : null);
    },
    onDoubleClick(idx) {
      if (idx !== null && idx >= 0 && onVicinity) {
        onVicinity(bv.ids[idx]!);
        return true;
      }
      if (idx === null || idx > -2) return false;
      flyToBlock(-2 - idx);
      return true;
    },
    bounds: () => (bv.ids.length > 0 ? bv.bounds : null),
    maxFit: () => 2.2,
  });

  function flyToBlock(b: number): void {
    const box = bv.blocks[b];
    if (!box) return;
    const { w, h } = view.size.current;
    const target = blockView(box, w || 800, h || 600);
    view.flyTo(target.cx, target.cy, target.k);
  }

  // Another family or another shape of the canvas: the papers fly from the old cells to the new, then the view fits again.
  const first = useRef(true);
  useEffect(() => {
    const old = lastBv.current;
    if (old !== bv && !reducedMotion() && old.ids.length > 0) {
      const from = new Map<string, [number, number]>();
      old.ids.forEach((id, i) => from.set(id, [old.x[i]!, old.y[i]!]));
      flyRef.current = { from, t: 0, at: 0 };
    }
    lastBv.current = bv;
    hoverIdx.current = -1;
    cursor.current = -1;
    lit.current = -1;
    focusLit.current = false;
    setHover(null);
    setFocused(null);
    if (first.current) first.current = false;
    else view.fit(true);
    view.requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bv]);
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) firstFit.current = false;
    else view.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useEffect(() => {
    view.requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allow, selIdx, evidence, edgeMode]);

  function startBridge(i: number): void {
    const a = bv.ids[i]!;
    if (selected !== null && selected !== a) onBridge?.(a, selected);
    else setSecond(i);
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const v = view.view.current;
    const { w, h } = view.size.current;
    const setCursor = (next: number) => {
      cursor.current = next;
      hoverIdx.current = next;
      lit.current = bv.block[next]!;
      focusLit.current = true;
      setHover(null);
      setFocused(next);
      view.requestDraw();
    };
    const list = papersInView(bv, v, w, h);
    if (e.key === ']' || e.key === '[') {
      const next = stepPoint(list, cursor.current >= 0 ? cursor.current : selRef.current, e.key === ']');
      if (next < 0) return;
      setCursor(next);
      return e.preventDefault();
    }
    if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && cursor.current >= 0 && onBridge) {
      startBridge(cursor.current);
      return e.preventDefault();
    }
    const a = mapAction(e);
    if (!a) return view.handlers.onKeyDown(e);
    switch (a.type) {
      case 'move': {
        const from = cursor.current >= 0 ? cursor.current : selRef.current;
        const sx = new Float64Array(bv.ids.length);
        const sy = new Float64Array(bv.ids.length);
        for (const i of list) {
          sx[i] = toScreenX(v, dotX(bv, i), w);
          sy[i] = toScreenY(v, dotY(bv, i), h);
        }
        const next = from < 0 || !list.includes(from) ? firstNode(sx, sy, list) : nearestInDirection(sx, sy, from, a.dir, list);
        if (next < 0) return;
        setCursor(next);
        break;
      }
      case 'open':
        if (cursor.current < 0) return;
        onSelect(bv.ids[cursor.current]!);
        onVicinity?.(bv.ids[cursor.current]!);
        break;
      case 'read':
        if (cursor.current >= 0) onRead?.(bv.ids[cursor.current]!);
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
        lit.current = -1;
        focusLit.current = false;
        cursor.current = -1;
        setFocused(null);
        setSecond(null);
        surprise.current = null;
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
        const b = bv.blocks.findIndex((x) => x.id === id);
        if (b < 0) return;
        lit.current = b;
        focusLit.current = true;
        flyToBlock(b);
      },
      shuffle() {
        view.requestDraw();
      },
      surprise(a, b) {
        const ia = bv.index.get(a);
        const ib = bv.index.get(b);
        if (ia === undefined || ib === undefined) return;
        surprise.current = { a: ia, b: ib };
        const { w, h } = view.size.current;
        const bx = Math.abs(dotX(bv, ia) - dotX(bv, ib));
        const by = Math.abs(dotY(bv, ia) - dotY(bv, ib));
        view.flyTo((dotX(bv, ia) + dotX(bv, ib)) / 2, (dotY(bv, ia) + dotY(bv, ib)) / 2, Math.min(Math.min(w, h) / Math.max(bx * 1.5, by * 1.5, 1e-9), 2.5));
        pulse.current = { idx: ia, at: performance.now() };
        view.requestDraw();
      },
      clearSurprise() {
        surprise.current = null;
        view.requestDraw();
      },
      canvas: () => view.canvas.current,
      light(id) {
        lit.current = id === null ? -1 : bv.blocks.findIndex((x) => x.id === id);
        focusLit.current = lit.current >= 0;
        view.requestDraw();
      },
      lightArea() {},
      isolateArea() {},
      flyToDoc(docId) {
        const i = bv.index.get(docId);
        if (i === undefined) return;
        view.flyTo(dotX(bv, i), dotY(bv, i), Math.max(view.view.current.k, 1.2));
        pulse.current = { idx: i, at: performance.now() };
        view.requestDraw();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bv, view],
  );

  const paintMini = useCallback(
    (ctx: CanvasRenderingContext2D, to: (x: number, y: number) => [number, number]) => {
      const th = theme.current;
      for (const b of bv.blocks) {
        const [x0, y0] = to(b.x, b.y);
        const [x1, y1] = to(b.x + b.w, b.y + b.h);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = th?.areas[b.tint] ?? '#888';
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
      ctx.globalAlpha = 1;
    },
    [bv],
  );

  // e2e runs only (RL_E2E=1, see the preload): what the tests measure on the canvas, in screen pixels of the page.
  useEffect(() => {
    if (!window.rlE2E) return;
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    window.__rlMapProbe = () => {
      const v = view.view.current;
      const { w, h } = view.size.current;
      const cv = view.canvas.current;
      const nodes = bv.ids.map((id, i) => ({ id, x: toScreenX(v, dotX(bv, i), w), y: toScreenY(v, dotY(bv, i), h), block: bv.blocks[bv.block[i]!]?.id ?? '' }));
      const out = probeOut.current;
      return {
        nodes,
        labels: out?.labels ?? [],
        names: out?.names ?? [],
        edges: (out?.edges ?? []).map((e) => ({ a: e.a, b: e.b, e: e.e, kinds: e.kinds })),
        bundles: out?.bundles ?? 0,
        view: { ...v, w, h },
        frame: { canvas: rect(cv), side: rect(document.querySelector('[data-testid="map-side"]')), strip: rect(document.querySelector('[data-testid="map-strip"]')) },
      };
    };
    return () => {
      delete window.__rlMapProbe;
    };
  }, [bv, view]);

  const hoverBlock = hover ? (bv.blocks[bv.block[hover.idx]!]?.label ?? '') : '';
  return (
    <div className="map-wrap" data-testid="map-blocks" data-blocks={bv.blocks.length}>
      <canvas
        ref={view.canvas}
        className="map-canvas"
        tabIndex={0}
        role="application"
        aria-roledescription={t('network.roleMap')}
        aria-label={label}
        data-testid="map-canvas"
        data-points={bv.ids.length}
        {...view.handlers}
        onKeyDown={onKeyDown}
      />
      {focused !== null && <Announce docId={bv.ids[focused]!} topic={bv.blocks[bv.block[focused]!]?.label ?? ''} />}
      {hover && (
        <HoverCard x={hover.x} y={hover.y} width={view.size.current.w} height={view.size.current.h} testId="map-tooltip" live={onBridge ? { label: t('network.card.actions'), onEnter: () => holdHover(true), onLeave: () => menuFor === null && holdHover(false) } : undefined}>
          <DocCard docId={bv.ids[hover.idx]!} topic={hoverBlock} />
          {onBridge && (
            <button ref={moreBtn} type="button" className="icon-button hc-more" aria-haspopup="menu" aria-label={t('network.more')} title={t('network.more')} onClick={() => setMenuFor(hover.idx)} data-testid="map-card-more">
              <span aria-hidden="true">⋯</span>
            </button>
          )}
        </HoverCard>
      )}
      <Menu
        anchor={moreBtn}
        open={menuFor !== null}
        label={t('network.card.actions')}
        onClose={() => {
          setMenuFor(null);
          holdHover(false);
        }}
        groups={[{ id: 'doc', items: [{ id: 'bridge', testId: 'map-card-bridge', label: t('network.bridge.find'), onSelect: () => menuFor !== null && startBridge(menuFor) }, ...(onFindLinks ? [{ id: 'links', testId: 'map-card-links', label: t('network.edge.findLinks'), onSelect: () => menuFor !== null && onFindLinks(bv.ids[menuFor]!) }] : [])] }]}
      />
      {second !== null && <BridgePick docId={bv.ids[second]!} onCancel={() => setSecond(null)} />}
      {minimapSlot && minimap && bv.ids.length > 150 && createPortal(<MiniMap bounds={bv.bounds} view={view.view} size={view.size} hooks={view.hooks} paint={paintMini} onMove={(x, y) => view.jump({ ...view.view.current, cx: x, cy: y })} label={t('network.minimapLabel')} version={bv} />, minimapSlot)}
    </div>
  );
}

export function MapCanvas(props: Props) {
  return props.blocks ? <BlocksCanvas {...props} blocks={props.blocks} /> : <FreeCanvas {...props} />;
}
