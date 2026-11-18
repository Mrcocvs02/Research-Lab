import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { isDarkTheme } from '../../lib/theme';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { migrateAliases, useAliasVersion } from './authorAliases';
import { assignKeyTints, haloSprite, mix, readableColor, readTheme, withAlpha, type MapTheme } from './colors';
import { controlPoint, edgeAlpha, fillTapered, MAX_CURVED } from './edges';
import { authorKey, fetchEntityNetwork } from './entityData';
import { layoutAnchors, nodeRadius } from './entityLayout';
import type { EntityMode, EntityNetwork, EntityNode } from './entityTypes';
import { MAX_NET_NODES, Network, type NetNode, type RawEdge, type RawNode } from './forceSim';
import { boundsOf, toScreenX, toScreenY, type Bounds } from './geometry';
import { HoverCard, useRestingHover, YearBars } from './HoverCard';
import { convexHull, centroidOf, hullShape, type Pt } from './hulls';
import { pickLabels, shortLabel, type LabelCandidate } from './labelsLod';
import { firstNode, mapAction, nearestInDirection } from './mapKeyboard';
import { MiniMap } from './MiniMap';
import { NodeSearch } from './NodeSearch';
import { bfsPath, pickSurprise, rng, type Surprise } from './playful';
import type { ScopeOptions } from './useScopes';
import { useCanvasView } from './useCanvasView';
import { reducedMotion } from './camera';
import { useOpenInLibrary } from './libraryOpen';

type TFn = ReturnType<typeof useTranslation>['t'];
export type EmptyKind = 'build' | 'tags' | 'review';

interface Props {
  mode: EntityMode;
  scopes: ScopeOptions;
  /** Entity shown in the side panel (kept highlighted). */
  selectedId: string | null;
  onSelect(node: EntityNode | null): void;
  onSelectDoc(docId: string): void;
  /** `L`: open Explore on the same dimension. */
  onExplore(): void;
  onEmpty(kind: EmptyKind): void;
  /** The network that is shown (its nodes feed "Merge with…" and the year range of the card). */
  onData?(d: EntityNetwork | null): void;
  mapVersion: number;
  /** The Panorama model exists (topics, and the starting positions). */
  mapReady: boolean;
}

const MIN_NODES = 3;
const MAX_DOT = 80;

/**
 * The entity networks (tags, topics, authors) on a canvas: nodes sized by documents, tinted by branch, topic or main topic,
 * hulls with the group's name, curved tapered edges, the tag's documents as small dots on double click, topics that split
 * into sub-topics, the "Tu" ring on your own author node, hover card, path, Mescola and Sorprendimi. Data from
 * `fetchEntityNetwork`. Frames only while the simulation or the camera moves.
 */
export function EntityNet({ mode, scopes, selectedId, onSelect, onSelectDoc, onExplore, onEmpty, onData, mapVersion, mapReady }: Props) {
  const { t } = useTranslation();
  const app = useApp();
  const lib = app.activeLibraryId ?? '';
  const docsVersion = useChangeVersion('documents');
  const taxVersion = useChangeVersion('taxonomy');
  const aliasVersion = useAliasVersion();
  const net = useMemo(() => new Network(), []);
  const centroids = useRef(new Map<string, { x: number; y: number }>());
  const docsOfCluster = useRef(new Map<string, string[]>());
  const [depth, setDepth] = useState(1);
  const [minDocs, setMinDocs] = useState(2);
  const [minWeight, setMinWeight] = useState(0);
  const [level, setLevel] = useState(0);
  const [tagScope, setTagScope] = useState('');
  const [years, setYears] = useState<[number, number] | null>(null);
  const [data, setData] = useState<EntityNetwork | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hover, setHover] = useRestingHover<{ key: string; x: number; y: number }>();
  const [note, setNote] = useState<string | null>(null);
  const [surprise, setSurprise] = useState<Surprise | null>(null);
  const [announce, setAnnounce] = useState('');
  const [mini, setMini] = useLocalFlag('rl.mapMini', true);
  const [drilled, setDrilled] = useState(0);
  const [pathKeys, setPathKeys] = useState<string[] | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const theme = useRef<MapTheme | null>(null);
  const tintOf = useRef(new Map<string, string>());
  const keyTints = useRef(new Map<string, number>());
  const levelOf = useRef(new Map<string, number>());
  const levelData = useRef(new Map<number, EntityNetwork>());
  const hoverKey = useRef<string | null>(null);
  const selKey = selectedId !== null ? `entity:${selectedId}` : null;
  const refs = useRef({ selKey, cursor, pathKeys, focusKey, surprise });
  refs.current = { selKey, cursor, pathKeys, focusKey, surprise };
  const searchRef = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const prevMode = useRef<EntityMode | null>(null);
  const selfKeys = useMemo(() => new Set([app.settings?.user.name ?? '', ...(app.settings?.user.authorVariants ?? [])].filter((s) => s.trim() !== '').map(authorKey)), [app.settings?.user.name, app.settings?.user.authorVariants]);
  const nodeAt = (key: string): NetNode | undefined => net.nodes.get(key);
  const maxCount = useRef(1);
  const rand = useRef(rng(Date.now() & 0xffff));

  const colorOf = (n: NetNode, th: MapTheme): string => {
    if (n.kind === 'doc') return th.muted;
    const cached = tintOf.current.get(n.key);
    if (cached) return cached;
    const k = n.entity?.colorKey ?? '';
    const c = k === '' ? th.muted : k.startsWith('#') ? readableColor(k, th.bg, th.tints) : (th.tints[keyTints.current.get(k) ?? 0] ?? th.muted);
    tintOf.current.set(n.key, c);
    return c;
  };
  const isSelf = (n: NetNode) => n.kind === 'entity' && mode === 'author' && n.entity !== undefined && selfKeys.has(n.entity.id.slice(7));
  const radiusOf = (n: NetNode) => n.r ?? 4;

  function getBounds(): Bounds | null {
    if (net.size === 0) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const n of net.nodes.values()) {
      xs.push(n.x);
      ys.push(n.y);
    }
    const b = boundsOf(xs, ys, xs.length);
    const pad = 40;
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }

  const view = useCanvasView<NetNode>({
    draw(ctx, w, h, v) {
      const dark = isDarkTheme();
      if (theme.current?.dark !== dark) {
        theme.current = readTheme(ctx.canvas, dark);
        tintOf.current.clear();
      }
      const th = theme.current!;
      const sx = (x: number) => toScreenX(v, x, w);
      const sy = (y: number) => toScreenY(v, y, h);
      const { selKey: sel, cursor: cur, pathKeys: path, focusKey: focus, surprise: sur } = refs.current;
      const hk = hoverKey.current;
      const nodes = [...net.nodes.values()];
      const near = new Set<string>();
      const lit = hk ?? null;
      if (lit) {
        near.add(lit);
        for (const k of net.neighbors(lit)) near.add(k);
      }
      let focusSet: Set<string> | null = null;
      if (focus && net.nodes.has(focus)) {
        focusSet = new Set([focus]);
        for (const a of net.neighbors(focus)) {
          focusSet.add(a);
          for (const b of net.neighbors(a)) focusSet.add(b);
        }
      }
      const pathSet = path ? new Set(path) : null;
      const fade = (k: string): number => (focusSet && !focusSet.has(k) ? 0.12 : lit && !near.has(k) ? 0.35 : pathSet && !pathSet.has(k) ? 0.25 : 1);
      // Hulls of the groups.
      const groups = new Map<string, NetNode[]>();
      for (const n of nodes) if (n.group) (groups.get(n.group) ?? groups.set(n.group, []).get(n.group)!).push(n);
      const labels: LabelCandidate[] = [];
      const texts: string[] = [];
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const [, members] of groups) {
        const tint = colorOf(members[0]!, th);
        const hull = convexHull(members.map((n) => [sx(n.x), sy(n.y)] as Pt));
        const shape = hullShape(hull, 16);
        if (shape.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(shape[0]![0], shape[0]![1]);
        for (let i = 1; i < shape.length; i++) ctx.lineTo(shape[i]![0], shape[i]![1]);
        ctx.closePath();
        ctx.fillStyle = withAlpha(tint, dark ? 0.12 : 0.07);
        ctx.fill();
        ctx.strokeStyle = withAlpha(tint, dark ? 0.35 : 0.25);
        ctx.lineWidth = 1;
        ctx.stroke();
        const label = members[0]!.entity?.groupLabel;
        if (label) {
          const c = centroidOf(hull);
          const text = mode === 'author' ? t('network.ent.groupOf', { name: label }) : label;
          texts.push(shortLabel(text));
          labels.push({ id: texts.length - 1, x: c[0], y: c[1] - Math.max(...hull.map((p) => Math.abs(p[1] - c[1]))) - 22, w: ctx.measureText(shortLabel(text)).width + 8, size: 1e6 + members.length, forced: false });
        }
      }
      // Edges: curved and tapered below 3000, straight lines above.
      const visible: Array<{ a: NetNode; b: NetNode; w: number; implies: boolean }> = [];
      for (const e of net.edges) {
        const a = net.nodes.get(e.a);
        const b = net.nodes.get(e.b);
        if (!a || !b) continue;
        const ax = sx(a.x);
        const ay = sy(a.y);
        const bx = sx(b.x);
        const by = sy(b.y);
        if ((ax < -50 && bx < -50) || (ay < -50 && by < -50) || (ax > w + 50 && bx > w + 50) || (ay > h + 50 && by > h + 50)) continue;
        visible.push({ a, b, w: e.weight, implies: e.kind === 'implies' });
      }
      const curved = visible.length <= MAX_CURVED;
      const onPath = new Set<string>();
      if (path) for (let i = 0; i + 1 < path.length; i++) onPath.add(`${path[i]}|${path[i + 1]}`).add(`${path[i + 1]}|${path[i]}`);
      for (const e of visible) {
        const ax = sx(e.a.x);
        const ay = sy(e.a.y);
        const bx = sx(e.b.x);
        const by = sy(e.b.y);
        const incident = lit !== null && (e.a.key === lit || e.b.key === lit);
        const dim = lit !== null && !incident ? 0.35 : focusSet && !(focusSet.has(e.a.key) && focusSet.has(e.b.key)) ? 0.12 : 1;
        const onP = onPath.has(`${e.a.key}|${e.b.key}`);
        const base = mix(colorOf(e.a, th), th.muted, 0.5);
        if (e.implies) {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = base;
          ctx.globalAlpha = 0.3 * dim;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        if (onP) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = th.accent;
          ctx.lineWidth = 3.5;
          const c = controlPoint(ax, ay, bx, by);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(c.x, c.y, bx, by);
          ctx.stroke();
          continue;
        }
        const alpha = (curved ? edgeAlpha(e.w, dark) : 0.3) * dim * (pathSet ? 0.5 : 1);
        ctx.globalAlpha = alpha;
        if (curved) {
          ctx.fillStyle = base;
          fillTapered(ctx, ax, ay, bx, by);
        } else {
          ctx.strokeStyle = base;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
      if (sur) {
        const a = net.nodes.get(`entity:${sur.a}`);
        const b = net.nodes.get(`entity:${sur.b}`);
        if (a && b) {
          ctx.globalAlpha = 1;
          ctx.setLineDash([8, 6]);
          ctx.strokeStyle = th.accent;
          ctx.lineWidth = 2.5;
          const c = controlPoint(sx(a.x), sy(a.y), sx(b.x), sy(b.y), 0.25);
          ctx.beginPath();
          ctx.moveTo(sx(a.x), sy(a.y));
          ctx.quadraticCurveTo(c.x, c.y, sx(b.x), sy(b.y));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;
      // Nodes.
      if (dark) ctx.globalCompositeOperation = 'lighter';
      const hot = hk ? net.nodes.get(hk) : undefined;
      if (hot) {
        const sprite = haloSprite(colorOf(hot, th));
        const r = radiusOf(hot) * 3.2;
        if (sprite) ctx.drawImage(sprite, sx(hot.x) - r, sy(hot.y) - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const n of nodes) {
        const x = sx(n.x);
        const y = sy(n.y);
        const r = radiusOf(n) * (n.key === hk ? 1.25 : 1);
        if (x < -r - 20 || y < -r - 20 || x > w + r + 20 || y > h + r + 20) continue;
        ctx.globalAlpha = fade(n.key);
        ctx.fillStyle = colorOf(n, th);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.kind !== 'doc') {
          ctx.strokeStyle = th.bg;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        const ring = n.key === sel || n.key === cur || isSelf(n);
        if (ring) {
          ctx.strokeStyle = th.accent;
          ctx.lineWidth = n.key === sel ? 2 : 1.5;
          ctx.setLineDash(n.key === cur && n.key !== sel ? [3, 3] : []);
          ctx.beginPath();
          ctx.arc(x, y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (n.fixed) {
          ctx.fillStyle = th.text;
          ctx.beginPath();
          ctx.arc(x + r * 0.8, y - r * 0.8, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (n.kind === 'entity') {
          const text = shortLabel(isSelf(n) ? `${t('network.ent.you')} · ${n.label}` : n.label);
          texts.push(text);
          labels.push({ id: texts.length - 1, x, y: y + r + 11, w: ctx.measureText(text).width + 6, size: r, forced: n.key === hk || n.key === sel || n.key === cur || isSelf(n) });
        }
      }
      ctx.globalAlpha = 1;
      // Labels: groups first, then the biggest nodes that do not overlap.
      ctx.font = '12px system-ui, sans-serif';
      for (const i of pickLabels(labels, w, h)) {
        const l = labels[i]!;
        const text = texts[l.id]!;
        const group = l.size >= 1e6;
        ctx.font = group ? '600 13px system-ui, sans-serif' : '12px system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = th.bg;
        ctx.strokeText(text, l.x, l.y);
        ctx.fillStyle = group ? th.muted : th.text;
        ctx.fillText(text, l.x, l.y);
      }
      ctx.textAlign = 'left';
      if (ctx.canvas.dataset['nodes'] !== String(nodes.length)) ctx.canvas.dataset['nodes'] = String(nodes.length);
    },
    hit(px, py, v, w, h) {
      let best: NetNode | null = null;
      let bestD = Infinity;
      for (const n of net.nodes.values()) {
        const dx = toScreenX(v, n.x, w) - px;
        const dy = toScreenY(v, n.y, h) - py;
        const d = dx * dx + dy * dy;
        const r = radiusOf(n) + 4;
        if (d <= r * r && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    },
    onHover(n, px, py) {
      const key = n?.key ?? null;
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      setHover(n ? { key: n.key, x: px, y: py } : null);
      view.requestDraw();
    },
    onClick(n, shift) {
      if (shift && n && refs.current.selKey && refs.current.selKey !== n.key) {
        const p = bfsPath((k) => net.neighbors(k), refs.current.selKey, n.key);
        setPathKeys(p);
        setNote(p ? null : t('network.ent.noPath'));
        view.requestDraw();
        return;
      }
      setPathKeys(null);
      setFocusKey(null);
      pick(n);
    },
    onDoubleClick(n) {
      if (!n) return false;
      void activate(n);
      return true;
    },
    bounds: getBounds,
    maxFit: () => 40 / 14,
    tick: () => net.tick() && net.heat > 0,
    dragStart(n, wx, wy) {
      n.pinned = true;
      n.x = wx;
      n.y = wy;
      net.warm(0.3);
      return true;
    },
    dragMove(n, wx, wy) {
      n.x = wx;
      n.y = wy;
      net.warm(0.3);
    },
    dragEnd(n) {
      n.pinned = false;
      n.fixed = true;
      net.warm(0.3);
    },
  });

  function pick(n: NetNode | null): void {
    if (!n) return onSelect(null);
    if (n.kind === 'doc') onSelectDoc(n.id);
    else if (n.entity) onSelect(n.entity);
    setCursor(n.key);
    setAnnounce(describe(n));
    view.requestDraw();
  }

  const describe = (n: NetNode): string => {
    const e = n.entity;
    if (!e) return n.label;
    const links = net.neighbors(n.key).length;
    return t(`network.ent.announce.${mode}`, { name: e.label, count: e.count, links, topic: e.groupLabel ?? '' });
  };

  /** Double click: a tag opens its documents as dots, a topic splits into sub-topics, an author brings its two-step neighbourhood into focus. */
  async function activate(n: NetNode): Promise<void> {
    if (n.kind === 'doc') return onSelectDoc(n.id);
    if (!n.entity) return;
    if (mode === 'tag') {
      if (n.expanded) {
        net.collapse(n.key);
        setCount(net.size);
        return view.requestDraw();
      }
      try {
        const r = await rl.invoke('documents:ids', { filters: { tags: [n.id] }, limit: MAX_DOT });
        const raws: RawNode[] = r.ids.map((id) => ({ kind: 'doc', id, label: '', r: 3.5 }));
        const edges: RawEdge[] = r.ids.map((id) => ({ from: n.key, to: `doc:${id}`, kind: 'tagged', weight: 0.3 }));
        const res = net.expand(n, raws, edges);
        if (res.added < r.total) setNote(t('network.ent.dotsMore', { shown: res.added, total: r.total }));
        setCount(net.size);
        view.requestDraw();
        if (reducedMotion()) settle();
      } catch (e) {
        setError(e);
      }
    } else if (mode === 'topic') {
      const from = levelOf.current.get(n.key) ?? level;
      if (from + 1 >= depth) return void setNote(t('network.ent.lastLevel'));
      try {
        let next = levelData.current.get(from + 1);
        if (!next) {
          next = await load(from + 1);
          levelData.current.set(from + 1, next);
        }
        const kids = next.nodes.filter((k) => k.group === n.id);
        if (kids.length === 0) return void setNote(t('network.ent.lastLevel'));
        const max = maxCount.current;
        const raws: RawNode[] = kids.map((k) => ({ kind: 'entity', id: k.id, label: k.label, count: k.count, entity: k, group: n.group || undefined, r: nodeRadius(k.count, max) } as RawNode));
        const ids = new Set(kids.map((k) => k.id));
        const edges: RawEdge[] = next.edges.filter((e) => ids.has(e.a) && ids.has(e.b)).map((e) => ({ from: `entity:${e.a}`, to: `entity:${e.b}`, kind: 'link', weight: e.w }));
        for (const e of net.edges) {
          const other = e.a === n.key ? e.b : e.b === n.key ? e.a : null;
          if (other) for (const k of kids) edges.push({ from: `entity:${k.id}`, to: other, kind: 'link', weight: e.weight * 0.6 });
        }
        const keepTint = colorOf(n, theme.current ?? readTheme(view.canvas.current!, isDarkTheme()));
        net.replace(n.key, raws, edges);
        for (const k of kids) {
          levelOf.current.set(`entity:${k.id}`, from + 1);
          tintOf.current.set(`entity:${k.id}`, keepTint);
        }
        setDrilled((d) => d + 1);
        setCount(net.size);
        view.requestDraw();
      } catch (e) {
        setError(e);
      }
    } else {
      setFocusKey(n.key);
      pick(n);
      const ring = [n.key, ...net.neighbors(n.key)].map((k) => net.nodes.get(k)).filter((x): x is NetNode => !!x);
      if (ring.length > 1) {
        const b = boundsOf(ring.map((r) => r.x), ring.map((r) => r.y), ring.length);
        const { w, h } = view.size.current;
        view.flyTo((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, Math.min(3, Math.min(w, h) / Math.max(b.maxX - b.minX + 160, b.maxY - b.minY + 160, 1)));
      }
    }
  }

  /** Settles the layout without drawing (reduced motion): the result appears at once. */
  function settle(): void {
    for (let i = 0; i < 400 && net.tick(); i++);
  }

  async function load(lvl: number): Promise<EntityNetwork> {
    await migrateAliases(lib);
    const req = { mode, level: lvl, ...(tagScope ? { scope: { tagId: tagScope } } : {}), ...(years ? { years } : {}), minDocs, minWeight, limit: MAX_NET_NODES };
    return fetchEntityNetwork(req);
  }

  // The Panorama gives the starting positions (centroids) and the depth of the topic levels.
  useEffect(() => {
    if (!mapReady) return;
    let live = true;
    rl.invoke('graph:map', {}).then(
      (m) => {
        if (!live) return;
        centroids.current = new Map(m.clusters.map((c) => [c.id, c.centroid]));
        const docs = new Map<string, string[]>();
        for (const p of m.points) for (const c of p.clusters) (docs.get(c) ?? docs.set(c, []).get(c)!).push(p.docId);
        docsOfCluster.current = docs;
        setDepth(Math.max(1, ...m.clusters.map((c) => c.level + 1)));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [mapReady, mapVersion]);

  // Loads the network of the mode and the filters; a newer request wins.
  const ticket = useRef(0);
  const reqKey = `${mode}|${level}|${minDocs}|${minWeight}|${tagScope}|${years?.join('-') ?? ''}|${docsVersion}|${taxVersion}|${aliasVersion}|${mapVersion}`;
  useEffect(() => {
    if (mode === 'topic' && !mapReady) return;
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    const run = setTimeout(() => {
      load(level).then(
        (d) => {
          if (mine !== ticket.current) return;
          levelData.current = new Map([[level, d]]);
          show(d);
          setLoading(false);
        },
        (e: unknown) => {
          if (mine !== ticket.current) return;
          setError(e);
          setLoading(false);
        },
      );
    }, 150);
    return () => clearTimeout(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, mapReady]);

  function show(d: EntityNetwork): void {
    setData(d);
    onData?.(d);
    levelOf.current.clear();
    tintOf.current.clear();
    keyTints.current = assignKeyTints(d.nodes.map((n) => n.colorKey).filter((k) => k !== '' && !k.startsWith('#')));
    maxCount.current = Math.max(1, ...d.nodes.map((n) => n.count));
    const pos = layoutAnchors(d.nodes, centroids.current);
    const raws: RawNode[] = d.nodes.map((n) => ({ kind: 'entity', id: n.id, label: n.label, count: n.count, x: pos.get(n.id)!.x, y: pos.get(n.id)!.y, entity: n, group: n.group || undefined, r: nodeRadius(n.count, maxCount.current) }));
    for (const n of d.nodes) levelOf.current.set(`entity:${n.id}`, level);
    net.load(raws, d.edges.map((e) => ({ a: `entity:${e.a}`, b: `entity:${e.b}`, kind: e.implies ? ('implies' as const) : ('link' as const), weight: e.w })), prevMode.current === mode && count > 0 ? 0.3 : 0.6);
    prevMode.current = mode;
    setCount(net.size);
    setDrilled(0);
    setPathKeys(null);
    setFocusKey(null);
    setSurprise(null);
    setCursor(null);
    setNote(null);
    if (reducedMotion()) settle();
    view.fit(false);
    view.requestDraw();
  }

  const ascend = () => {
    load(level).then((d) => {
      levelData.current = new Map([[level, d]]);
      show(d);
    }, setError);
  };

  const reset = () => {
    setMinDocs(1);
    setMinWeight(0);
    setYears(null);
    setTagScope('');
  };

  const reflow = () => {
    net.shuffle(rand.current);
    if (reducedMotion()) settle();
    view.fit(true);
    view.requestDraw();
  };

  const hovered = hover ? net.nodes.get(hover.key) : undefined;
  const keyAt = (v = view.view.current, w = view.size.current.w, h = view.size.current.h) => {
    const list = [...net.nodes.values()];
    const xs = list.map((n) => toScreenX(v, n.x, w));
    const ys = list.map((n) => toScreenY(v, n.y, h));
    return { list, xs, ys, inView: list.map((_, i) => i).filter((i) => xs[i]! >= 0 && ys[i]! >= 0 && xs[i]! <= w && ys[i]! <= h) };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === ']' || e.key === '[') {
      const keys = [...net.nodes.values()].filter((n) => n.kind === 'entity').sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || (a.key < b.key ? -1 : 1)).map((n) => n.key);
      if (keys.length === 0) return;
      const at = cursor ? keys.indexOf(cursor) : -1;
      const next = keys[(at + (e.key === ']' ? 1 : -1) + keys.length) % keys.length]!;
      setCursor(next);
      setAnnounce(describe(net.nodes.get(next)!));
      view.requestDraw();
      return e.preventDefault();
    }
    const a = mapAction(e);
    if (!a) return view.handlers.onKeyDown(e);
    const n = cursor ? net.nodes.get(cursor) : selKey ? net.nodes.get(selKey) : undefined;
    switch (a.type) {
      case 'move': {
        const k = keyAt();
        const from = n ? k.list.indexOf(n) : -1;
        const next = from < 0 ? firstNode(k.xs, k.ys, k.inView) : nearestInDirection(k.xs, k.ys, from, a.dir, k.inView);
        if (next < 0) return;
        const target = k.list[next]!;
        setCursor(target.key);
        setAnnounce(describe(target));
        view.requestDraw();
        break;
      }
      case 'open':
        if (n && selKey === n.key) void activate(n);
        else pick(n ?? null);
        break;
      case 'read':
        if (n?.entity) openLibrary(n.entity);
        break;
      case 'zoom':
        view.zoom(a.factor);
        break;
      case 'fit':
        view.fit(true);
        break;
      case 'search':
        searchRef.current?.focus();
        break;
      case 'pin':
        if (n) {
          n.fixed = !n.fixed;
          view.requestDraw();
        }
        break;
      case 'escape':
        setCursor(null);
        setPathKeys(null);
        setFocusKey(null);
        setSurprise(null);
        view.requestDraw();
        return view.handlers.onKeyDown(e);
      case 'explore':
        return onExplore();
      default:
        return;
    }
    e.preventDefault();
  };

  const openLibrary = useOpenInLibrary(mode);

  const doSurprise = () => {
    if (!data) return;
    const s = pickSurprise(mode, data.nodes, data.edges, (id) => nodeAt(`entity:${id}`), rand.current);
    if (!s) return void setNote(t('network.ent.noSurprise'));
    setSurprise(s);
    const a = nodeAt(`entity:${s.a}`);
    const b = nodeAt(`entity:${s.b}`);
    if (a && b) {
      const { w, h } = view.size.current;
      view.flyTo((a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(3, Math.min(w, h) / Math.max(Math.abs(a.x - b.x) + 200, Math.abs(a.y - b.y) + 200, 1)));
    }
    view.requestDraw();
  };

  const labelOf = (id: string) => nodeAt(`entity:${id}`)?.label ?? id;
  const sentence = surprise ? t(`network.ent.surprise.${surprise.kind}`, { a: safeText(labelOf(surprise.a)), b: safeText(labelOf(surprise.b)), n: surprise.n }) : '';

  const paintMini = useCallback(
    (ctx: CanvasRenderingContext2D, to: (x: number, y: number) => [number, number], dark: boolean) => {
      const th = theme.current ?? { tints: [], muted: '#888' };
      for (const n of net.nodes.values()) {
        if (n.kind !== 'entity') continue;
        const [x, y] = to(n.x, n.y);
        ctx.fillStyle = (n.entity && (tintOf.current.get(n.key) ?? th.tints[keyTints.current.get(n.entity.colorKey) ?? 0])) || th.muted;
        ctx.globalAlpha = dark ? 0.9 : 0.8;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
    },
    [net],
  );

  const emptyKind: EmptyKind | null = loading || error ? null : mode === 'topic' && !mapReady ? 'build' : mode === 'tag' && scopes.tags.length === 0 ? 'tags' : mode === 'author' && data && data.total === 0 && (data.documents ?? 0) > 0 && minDocs <= 1 ? 'review' : null;
  const few = !loading && !error && emptyKind === null && data !== null && count < MIN_NODES;
  const kindName = t(`network.ent.kind.${mode}`);
  const rangeYears = data?.yearRange;

  return (
    <div className="net-tab ent-tab" data-testid="entity-panel" data-mode={mode}>
      <div className="net-toolbar ent-filters">
        <NodeSearch
          ref={searchRef}
          testId="ent-search"
          label={t('network.search.go')}
          placeholder={t('network.search.goEntity', { kind: kindName })}
          suggest={(q) => {
            const f = q.toLowerCase();
            return [...net.nodes.values()].filter((n) => n.kind === 'entity' && n.label.toLowerCase().includes(f)).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map((n) => ({ id: n.key, label: n.label, hint: String(n.count ?? '') }));
          }}
          onPick={(it) => {
            const n = nodeAt(it.id);
            if (!n) return;
            view.flyTo(n.x, n.y, Math.max(view.view.current.k, 1.6));
            pick(n);
          }}
        />
        {rangeYears && rangeYears[1] > rangeYears[0] && (
          <span className="net-field ent-years" data-testid="ent-years">
            <span>{t('network.ent.years')}</span>
            <input type="range" aria-label={t('network.ent.yearFrom')} min={rangeYears[0]} max={rangeYears[1]} value={years?.[0] ?? rangeYears[0]} onChange={(e) => setYears([Math.min(Number(e.target.value), years?.[1] ?? rangeYears[1]), years?.[1] ?? rangeYears[1]])} data-testid="ent-year-from" />
            <input type="range" aria-label={t('network.ent.yearTo')} min={rangeYears[0]} max={rangeYears[1]} value={years?.[1] ?? rangeYears[1]} onChange={(e) => setYears([years?.[0] ?? rangeYears[0], Math.max(Number(e.target.value), years?.[0] ?? rangeYears[0])])} data-testid="ent-year-to" />
            <span className="hint">
              {years?.[0] ?? rangeYears[0]}–{years?.[1] ?? rangeYears[1]}
            </span>
          </span>
        )}
        <label className="net-field">
          <span>{t('network.ent.minDocs')}</span>
          <input type="range" min={1} max={10} value={minDocs} onChange={(e) => setMinDocs(Number(e.target.value))} data-testid="ent-min-docs" />
          <span className="hint">{minDocs}</span>
        </label>
        <label className="net-field">
          <span>{t('network.ent.minWeight')}</span>
          <input type="range" min={0} max={0.9} step={0.05} value={minWeight} onChange={(e) => setMinWeight(Number(e.target.value))} data-testid="ent-min-weight" />
        </label>
        {mode === 'topic' && depth > 1 && (
          <label className="net-field">
            <span>{t('network.ent.level')}</span>
            <input type="range" min={1} max={depth} value={level + 1} onChange={(e) => setLevel(Number(e.target.value) - 1)} data-testid="ent-level" />
            <span className="hint">
              {level + 1}/{depth}
            </span>
          </label>
        )}
        {mode !== 'tag' && scopes.tags.length > 0 && (
          <label className="net-field">
            <span className="visually-hidden">{t('network.scope.tag')}</span>
            <select value={tagScope} onChange={(e) => setTagScope(e.target.value)} data-testid="ent-tag-scope">
              <option value="">{t('network.ent.tagAny')}</option>
              {scopes.tags.map((x) => (
                <option key={x.id} value={x.id}>
                  {safeText(x.label)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="map-actions">
          <button type="button" className="icon-button" title={t('network.play.shuffle')} aria-label={t('network.play.shuffle')} onClick={reflow} disabled={count === 0} data-testid="ent-shuffle">
            ✧
          </button>
          <button type="button" className="icon-button" title={t('network.play.surprise')} aria-label={t('network.play.surprise')} onClick={doSurprise} disabled={count < 2} data-testid="ent-surprise">
            ✦
          </button>
          <button type="button" className="icon-button" title={t('network.fit')} aria-label={t('network.fit')} onClick={() => view.fit(true)} disabled={count === 0} data-testid="ent-fit">
            ⤢
          </button>
          <details className="map-more">
            <summary aria-label={t('network.more')} title={t('network.more')} data-testid="ent-more">
              ⋯
            </summary>
            <div className="map-more-body">
              <label className="check-inline">
                <input type="checkbox" checked={mini} onChange={(e) => setMini(e.target.checked)} data-testid="ent-minimap-toggle" />
                {t('network.minimap')}
              </label>
              <button
                type="button"
                className="link"
                onClick={() => {
                  for (const n of net.nodes.values()) n.fixed = false;
                  view.requestDraw();
                }}
                data-testid="ent-unpin-all"
              >
                {t('network.unpinAll')}
              </button>
            </div>
          </details>
        </span>
      </div>
      {error ? <ErrorNote testId="ent-error">{errorMessage(error, t)}</ErrorNote> : null}
      {data && count > 0 && (
        <p className="hint ent-subtitle" role="status" data-testid="ent-count" data-count={count} data-total={data.total} data-truncated={data.truncated ? 'true' : 'false'} data-drilled={drilled}>
          {data.truncated ? t('network.ent.cap', { shown: count, total: data.total.toLocaleString(), kind: kindName }) : t('network.ent.count', { count, kind: kindName })}
          {data.documents !== undefined ? ` · ${t('network.ent.documents', { count: data.documents })}` : ''}
          {drilled > 0 && (
            <>
              {' · '}
              <button type="button" className="link" onClick={ascend} data-testid="ent-up">
                {t('network.ent.up')}
              </button>
            </>
          )}
        </p>
      )}
      {note && (
        <p className="hint" role="status" data-testid="ent-note">
          {note}
        </p>
      )}
      {surprise && (
        <p className="surprise-note" role="status" data-testid="ent-surprise-note">
          {sentence}{' '}
          <button type="button" className="link" onClick={() => setSurprise(null)}>
            {t('common.close')}
          </button>
        </p>
      )}
      {emptyKind && (
        <EmptyState icon={<span>◌</span>} title={t(`network.ent.empty.${emptyKind}.title`)} action={<button type="button" className="primary" onClick={() => onEmpty(emptyKind)} data-testid={`ent-empty-${emptyKind}`}>{t(`network.ent.empty.${emptyKind}.action`)}</button>}>
          {t(`network.ent.empty.${emptyKind}.text`)}
        </EmptyState>
      )}
      {few && (
        <EmptyState icon={<span>◌</span>} title={t('network.ent.empty.few.title')} action={<button type="button" onClick={reset} data-testid="ent-clear-filters">{t('network.ent.empty.few.action')}</button>}>
          {t('network.ent.empty.few.text')}
        </EmptyState>
      )}
      <div ref={wrap} className="map-wrap net-wrap" hidden={emptyKind !== null}>
        <canvas
          ref={view.canvas}
          className="map-canvas"
          tabIndex={0}
          role="application"
          aria-roledescription={t('network.roleMap')}
          aria-label={t('network.ent.label', { kind: kindName })}
          data-testid="ent-canvas"
          data-nodes={count}
          data-edges={net.edges.length}
          data-mode={mode}
          data-selected={selectedId ?? ''}
          data-loading={loading ? 'true' : 'false'}
          {...view.handlers}
          onKeyDown={onKeyDown}
        />
        <span className="visually-hidden" aria-live="polite" data-testid="ent-focus">
          {announce}
        </span>
        {hovered?.entity && hover && (
          <HoverCard x={hover.x} y={hover.y} width={view.size.current.w} height={view.size.current.h} testId="net-tooltip">
            <strong className="hc-title">
              {safeText(hovered.entity.label)}
              {hovered.entity.variants && hovered.entity.variants.length > 1 ? <span className="hint"> ({t('network.ent.forms', { count: hovered.entity.variants.length })})</span> : null}
            </strong>
            {hovered.entity.variants && hovered.entity.variants.length > 1 && <span className="hc-line hint">{t('network.ent.namesake', { count: hovered.entity.variants.length })}</span>}
            <span className="hc-line">
              {t('network.ent.documents', { count: hovered.entity.count })}
              {rangeYears ? ` · ${rangeYears[0]}–${rangeYears[1]}` : ''} <YearBars years={hovered.entity.years} range={rangeYears} />
            </span>
            {hovered.entity.groupLabel && <span className="hc-line hint">{t(`network.ent.groupLine.${mode}`, { name: safeText(hovered.entity.groupLabel) })}</span>}
            {topLinks(net, hovered, t, mode)}
          </HoverCard>
        )}
        {mini && count > 0 && <MiniMap bounds={getBounds()} view={view.view} size={view.size} hooks={view.hooks} paint={paintMini} onMove={(x, y) => view.jump({ ...view.view.current, cx: x, cy: y })} label={t('network.minimapLabel')} version={count + drilled} />}
      </div>
    </div>
  );
}

/** The three strongest links of a node with their counts: "Co-authors: B. Test (6)". */
function topLinks(net: Network, n: NetNode, t: TFn, mode: EntityMode) {
  const w = new Map<string, number>();
  for (const e of net.edges) {
    if (e.a === n.key) w.set(e.b, e.weight);
    else if (e.b === n.key) w.set(e.a, e.weight);
  }
  const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => net.nodes.get(k)).filter((x): x is NetNode => !!x && x.kind === 'entity');
  if (top.length === 0) return null;
  return (
    <span className="hc-line hint">
      {t(`network.ent.links.${mode}`)}: {top.map((x) => `${safeText(x.label)} (${x.count ?? 0})`).join(', ')}
    </span>
  );
}
