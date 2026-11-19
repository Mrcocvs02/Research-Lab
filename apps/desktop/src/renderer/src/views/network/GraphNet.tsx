import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { EmptyState } from '../../components/EmptyState';
import { Lazy, lazyView } from '../../components/Lazy';
import { useNav } from '../../lib/nav';
import { setDiscoverIntent } from '../../lib/discoverIntent';
import { useNotify } from '../../lib/notify';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { isDarkTheme } from '../../lib/theme';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { safeText } from '../library/safeText';
import { reasonLine, weightBar, type LinkReasons } from '../links/reasons';
import { reducedMotion } from './camera';
import { AreaLegend, AreaNote, useAreaColors } from './AreaLegend';
import { GroupBy, GroupLabel } from './GroupBy';
import { applyShares, familyName, nameClusters, TOPIC_FAMILY, useFamilies, useFamily, useFamilyRev, type FamilyShares } from './grouping';
import { areaNoteNeeded, areaSummary, withUserTints, assignAreaSlots, colorCache, loadAreaMemo, mainArea, saveAreaMemo, shareIn, type AreaDef } from './areaColors';
import { Segmented } from '../../components/Segmented';
import { assignKeyTints, mix, readTheme, type MapTheme } from './colors';
import { controlPoint, edgeAlpha, edgeWidths, fillTapered, MAX_CURVED, STRAIGHT_ALPHA, straightWidth } from './edges';
import { MAX_NET_NODES, Network, type EdgeKind, type NetNode, type NodeKind } from './forceSim';
import { boundsOf, toScreenX, toScreenY, type Bounds } from './geometry';
import { clusterText } from './mapModel';
import { DocCard, HoverCard, useRestingHover } from './HoverCard';
import { pickLabels, shortLabel, type LabelCandidate } from './labelsLod';
import { firstNode, mapAction, nearestInDirection } from './mapKeyboard';
import { MiniMap } from './MiniMap';
import { ChipPop, ChromeCtx, copyCanvasImage, HeadMore, MapIllustration, Pill, RowPortal, useHint } from './NetChrome';
import type { NetCtl } from './NetworkView';
import { NodeSearch } from './NodeSearch';
import { bfsPath, rng } from './playful';
import { useCanvasView } from './useCanvasView';
import type { ScopeOptions } from './useScopes';

type Kind = RequestOf<Channels, 'graph:neighbors'>['kinds'][number];
const LinkFinderDialog = lazyView(() => import('../links/LinkFinderDialog').then((m) => ({ default: m.LinkFinderDialog })), ['links']);
const KINDS: Kind[] = ['similar', 'citations', 'tags', 'folder', 'children', 'documents', 'links'];
/** What each kind of node can be expanded by. */
const VALID: Record<NodeKind, Kind[]> = { doc: ['similar', 'citations', 'tags', 'folder', 'links'], folder: ['children', 'documents'], tag: ['documents', 'tags'], entity: [] };
const DEFAULT_KINDS: Kind[] = ['similar', 'citations', 'tags', 'folder', 'children', 'documents', 'links'];
const LIMITS = [10, 25, 50, 100, 300] as const;
const NODE_R = 7;

interface EdgeHit {
  a: string;
  b: string;
  kind: EdgeKind;
  weight: number;
  x: number;
  y: number;
}

export interface NetStart {
  kind: NodeKind;
  id: string;
  label: string;
  /** Changes at every request, so asking for the same start again resets the network. */
  nonce: number;
}

interface Props {
  active: boolean;
  /** The "Network of" chip, drawn first in the row. */
  modeChip: ReactNode;
  /** What the node panel needs to expand, collapse, remove and look for a bridge (null: nothing selected). */
  onCtl(c: NetCtl | null): void;
  start: NetStart | null;
  scopes: ScopeOptions;
  /** The document selected elsewhere (the map, a list): can be the start of the network. */
  selectedDoc: string | null;
  selectedDocLabel: string | null;
  onSelectDoc(docId: string): void;
  onStart(start: Omit<NetStart, 'nonce'>): void;
  /** `L`: open Explore. */
  onExplore?(): void;
}

const EDGE_STYLE: Record<EdgeKind, { dash: number[]; color: keyof MapTheme }> = {
  similar: { dash: [], color: 'accent' },
  cites: { dash: [], color: 'text' },
  linked: { dash: [], color: 'accent' },
  tagged: { dash: [2, 3], color: 'muted' },
  contains: { dash: [], color: 'muted' },
  link: { dash: [], color: 'muted' },
  implies: { dash: [4, 4], color: 'muted' },
  theme: { dash: [2, 4], color: 'muted' },
};
const NODE_FILL: Record<NodeKind, keyof MapTheme> = { doc: 'accent', folder: 'muted', tag: 'text', entity: 'accent' };

/**
 * The network of documents on a canvas: start from a document, folder or tag; expand a node by chosen kinds of neighbours;
 * new nodes appear around it and the force simulation (Barnes-Hut, a temperature that stops it) settles them. Curved tapered
 * edges, a card on hover, a path between two nodes, nodes that stay where they are dropped (the pin), the two-step
 * neighbourhood in focus on double click. No graph library, no DOM per node; frames only while something moves.
 */
export function GraphNet({ active, modeChip, onCtl, start, scopes, selectedDoc, selectedDocLabel, onSelectDoc, onStart, onExplore }: Props) {
  const { t } = useTranslation();
  const net = useMemo(() => new Network(), []);
  const [kinds, setKinds] = useState<Kind[]>(DEFAULT_KINDS);
  const [limit, setLimit] = useState<number>(25);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hover, setHover] = useRestingHover<{ key: string; x: number; y: number }>();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const expanding = useRef(new Set<string>());
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<{ text: string; only?: NetNode } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [pathKeys, setPathKeys] = useState<string[] | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [surprise, setSurprise] = useState<{ a: string; b: string; terms: string[] } | null>(null);
  const [chips, setChips] = useState<Array<{ id: string; label: string; n: number }>>([]);
  const [mini, setMini] = useLocalFlag('rl.mapMini', true);
  /** The topics of the Panorama: the topic of each document (coarsest level), the tint of each topic and its name. */
  const topics = useRef<{ of: Map<string, string>; tint: Map<string, number>; name: Map<string, string> } | null>(null);
  const hoverKey = useRef<string | null>(null);
  /** Macro-areas (D-483): the areas of the library and their tint slots, learnt from the answers of `graph:neighbors`. */
  const [byArea, setByArea] = useAreaColors();
  // Group by (D-489): the family of the chosen tag kind (or communities) colours the nodes and shapes the springs.
  const [family] = useFamily();
  const families = useFamilies(undefined, active);
  const famRev = useFamilyRev();
  const lastRev = useRef(famRev);
  const familyRef = useRef(family);
  familyRef.current = family;
  const [areaState, setAreaState] = useState<{ defs: AreaDef[]; slots: number[] } | null>(null);
  const areaRef = useRef<{ on: boolean; defs: AreaDef[]; slots: number[]; names: Map<string, string> }>({ on: false, defs: [], slots: [], names: new Map() });
  const areaPaint = useRef<{ dark: boolean; slots: unknown; fn: ReturnType<typeof colorCache> } | null>(null);
  const litAreaRef = useRef<number | null>(null);
  const isoAreaRef = useRef<number | null>(null);
  const [bridgeFrom, setBridgeFrom] = useState<string | null>(null);
  /** The links drawn (`linked` edges, section 18.2) by their two node keys, and the card of the edge that was clicked. */
  const linkMeta = useRef(new Map<string, { id: string; reasons: LinkReasons }>());
  const pointer = useRef({ x: 0, y: 0 });
  const [edgeCard, setEdgeCard] = useState<EdgeHit | null>(null);
  const [findFor, setFindFor] = useState<string | null>(null);
  const refs = useRef({ selKey, cursor, pathKeys, focusKey, surprise, bridgeFrom });
  refs.current = { selKey, cursor, pathKeys, focusKey, surprise, bridgeFrom };
  const theme = useRef<MapTheme | null>(null);
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const lastStart = useRef(0);
  const autoTried = useRef(false);
  const rand = useRef(rng(Date.now() & 0xffff));
  const searchRef = useRef<HTMLInputElement>(null);
  const chrome = useContext(ChromeCtx);
  const nav = useNav();
  const { info } = useNotify();
  const untitled = t('network.untitled');
  const [hint, dismissHint] = useHint(active);

  /** Documents take the group of their macro-area (when one holds 60 % of them) or of their topic; the simulation pulls a group of three or more together. */
  function tagTopics(): void {
    const ar = areaRef.current;
    const tp = topics.current;
    const docs = [...net.nodes.values()].filter((n) => n.kind === 'doc');
    // No area, or one, or no document with one: the topics colour the nodes.
    ar.on = (byAreaRef.current || familyRef.current !== TOPIC_FAMILY) && ar.defs.length >= 2 && docs.some((n) => n.ar !== undefined && n.ar.length > 0);
    ar.names = new Map();
    for (const n of docs) {
      if (ar.on) {
        const a = mainArea(n.ar);
        n.group = a >= 0 && shareIn(n.ar, a) >= 0.6 && ar.defs[a] ? `area:${ar.defs[a]!.id}` : undefined;
        if (n.group) ar.names.set(n.group, ar.defs[a]!.label);
      } else n.group = tp?.of.get(n.id);
    }
  }
  const byAreaRef = useRef(byArea);
  byAreaRef.current = byArea;

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
      if (theme.current?.dark !== dark) theme.current = readTheme(ctx.canvas, dark);
      const th = theme.current!;
      const sx = (x: number) => toScreenX(v, x, w);
      const sy = (y: number) => toScreenY(v, y, h);
      const { selKey: sel, cursor: cur, pathKeys: path, focusKey: focus, surprise: sur } = refs.current;
      const hk = hoverKey.current;
      const nodes = net.nodes;
      const near = new Set<string>();
      if (hk) {
        near.add(hk);
        for (const k of net.neighbors(hk)) near.add(k);
      }
      let focusSet: Set<string> | null = null;
      if (focus && nodes.has(focus)) {
        focusSet = new Set([focus]);
        for (const a of net.neighbors(focus)) {
          focusSet.add(a);
          for (const b of net.neighbors(a)) focusSet.add(b);
        }
      }
      const pathSet = path ? new Set(path) : null;
      const onPath = new Set<string>();
      if (path) for (let i = 0; i + 1 < path.length; i++) onPath.add(`${path[i]}|${path[i + 1]}`).add(`${path[i + 1]}|${path[i]}`);
      const fade = (k: string): number => (focusSet && !focusSet.has(k) ? 0.12 : hk && !near.has(k) ? 0.35 : pathSet && !pathSet.has(k) ? 0.25 : 1);
      // No outlines (D-482): the name of a group is a label at the centroid of its visible nodes (three or more).
      const tp = topics.current;
      const ar = areaRef.current;
      const groupAt = new Map<string, { x: number; y: number; n: number }>();
      for (const n of nodes.values()) {
        if (n.kind !== 'doc' || !n.group) continue;
        const x = sx(n.x);
        const y = sy(n.y);
        if (x < 0 || y < 0 || x > w || y > h) continue;
        const g = groupAt.get(n.group) ?? groupAt.set(n.group, { x: 0, y: 0, n: 0 }).get(n.group)!;
        g.x += x;
        g.y += y;
        g.n++;
      }
      const colorFn = (() => {
        if (!ar.on) return null;
        const c = areaPaint.current;
        if (c && c.dark === dark && c.slots === ar.slots) return c.fn;
        const u = withUserTints(ar.defs, ar.slots, th.areas, th.bg);
        const fn = colorCache(u.slots, u.tokens);
        areaPaint.current = { dark, slots: ar.slots, fn };
        return fn;
      })();
      const areaLit = isoAreaRef.current ?? litAreaRef.current;
      const areaFade = (n: NetNode): number => (areaLit === null || shareIn(n.ar, areaLit) >= 0.2 ? 1 : isoAreaRef.current !== null ? 0.15 : 0.25);
      const visible = [];
      for (const e of net.edges) {
        const a = nodes.get(e.a);
        const b = nodes.get(e.b);
        if (!a || !b) continue;
        const ax = sx(a.x);
        const ay = sy(a.y);
        const bx = sx(b.x);
        const by = sy(b.y);
        if ((ax < -50 && bx < -50) || (ay < -50 && by < -50) || (ax > w + 50 && bx > w + 50) || (ay > h + 50 && by > h + 50)) continue;
        visible.push({ e, a, b, ax, ay, bx, by });
      }
      const curved = visible.length <= MAX_CURVED;
      ctx.lineCap = 'round';
      for (const { e, a, b, ax, ay, bx, by } of visible) {
        const style = EDGE_STYLE[e.kind];
        const col = mix(th[style.color] as string, th.muted, 0.35);
        const dim = hk && a.key !== hk && b.key !== hk ? 0.35 : focusSet && !(focusSet.has(a.key) && focusSet.has(b.key)) ? 0.12 : 1;
        if (onPath.has(`${a.key}|${b.key}`)) {
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
        const we = e.kind === 'contains' || e.kind === 'tagged' ? 0.3 : e.weight;
        const incident = hk !== null && (a.key === hk || b.key === hk);
        ctx.globalAlpha = incident ? 0.9 : edgeAlpha(we, dark) * (curved ? 1 : STRAIGHT_ALPHA) * dim * (pathSet ? 0.5 : 1);
        if (curved && style.dash.length === 0) {
          ctx.fillStyle = col;
          const wd = edgeWidths(we, e.kind === 'cites');
          fillTapered(ctx, ax, ay, bx, by, wd.w0 + (incident ? 1 : 0), wd.w1 + (incident ? 1 : 0));
        } else {
          ctx.strokeStyle = col;
          ctx.setLineDash(style.dash);
          ctx.lineWidth = (style.dash.length === 0 ? straightWidth(we) : 1) + (incident ? 1 : 0);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (sur) {
        const a = nodes.get(sur.a);
        const b = nodes.get(sur.b);
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
      // Nodes: circle = document, square = folder, diamond = tag.
      const labels: LabelCandidate[] = [];
      const texts: string[] = [];
      ctx.font = '12px system-ui, sans-serif';
      for (const n of nodes.values()) {
        const x = sx(n.x);
        const y = sy(n.y);
        if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
        const r = NODE_R * (n.key === hk ? 1.25 : 1);
        ctx.globalAlpha = fade(n.key) * areaFade(n);
        const tin = n.kind === 'doc' && n.group !== undefined ? tp?.tint.get(n.group) : undefined;
        const ac = colorFn ? colorFn(n.ar, n.az) : null;
        const ring = colorFn !== null && n.kind === 'doc' && ac === null;
        // A tag outside every area (a loose tag, D-490) stays neutral instead of the heavy text colour.
        ctx.fillStyle = ring ? th.bg : ac ?? (colorFn && n.kind === 'tag' ? th.muted : tin !== undefined ? (th.tints[tin] ?? th.accent) : (th[NODE_FILL[n.kind]] as string));
        ctx.strokeStyle = ring ? th.areas[8]! : th.bg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (n.kind === 'doc') ctx.arc(x, y, r, 0, Math.PI * 2);
        else if (n.kind === 'folder') ctx.rect(x - r, y - r, r * 2, r * 2);
        else {
          ctx.moveTo(x, y - r - 2);
          ctx.lineTo(x + r + 2, y);
          ctx.lineTo(x, y + r + 2);
          ctx.lineTo(x - r - 2, y);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
        if (n.expanded || n.key === sel || n.key === cur || n.key === hk) {
          ctx.strokeStyle = n.key === sel ? th.accent : th.text;
          ctx.lineWidth = n.key === sel ? 2.5 : 1.5;
          ctx.globalAlpha = n.expanded && n.key !== sel && n.key !== hk && n.key !== cur ? fade(n.key) * 0.5 : fade(n.key);
          ctx.setLineDash(n.key === cur && n.key !== sel ? [3, 3] : []);
          ctx.beginPath();
          ctx.arc(x, y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (n.fixed) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = th.text;
          ctx.beginPath();
          ctx.arc(x + r, y - r, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        texts.push(shortLabel(n.label));
        labels.push({ id: texts.length - 1, x, y: y + r + 12, w: ctx.measureText(texts[texts.length - 1]!).width + 6, size: n.expanded ? r + 3 : r, forced: n.key === hk || n.key === sel || n.key === cur });
      }
      ctx.globalAlpha = 1;
      ctx.font = '600 13px system-ui, sans-serif';
      const groupIds = new Set<number>();
      for (const [id, g] of groupAt) {
        if (g.n < 3) continue;
        const name = ar.on ? ar.names.get(id) : tp?.name.get(id);
        if (!name) continue;
        texts.push(shortLabel(name));
        groupIds.add(texts.length - 1);
        labels.push({ id: texts.length - 1, x: g.x / g.n, y: g.y / g.n, w: ctx.measureText(shortLabel(name)).width + 8, size: 1e6 + g.n, forced: false });
      }
      ctx.font = '12px system-ui, sans-serif';
      // Labels: everywhere when the network is small, else the ones that matter and do not overlap.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const chosen = nodes.size < 30 ? labels.map((_, i) => i) : pickLabels(labels, w, h, nodes.size <= 120 ? 400 : 60);
      for (const i of chosen) {
        const l = labels[i]!;
        const isGroup = groupIds.has(l.id);
        ctx.font = isGroup ? '600 13px system-ui, sans-serif' : '12px system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = th.bg;
        ctx.strokeText(texts[l.id]!, l.x, l.y);
        ctx.fillStyle = isGroup ? th.muted : th.text;
        ctx.fillText(texts[l.id]!, l.x, l.y);
      }
      ctx.textAlign = 'left';
    },
    hit(px, py, v, w, h) {
      let best: NetNode | null = null;
      let bestD = (NODE_R + 5) * (NODE_R + 5);
      for (const n of net.nodes.values()) {
        const dx = toScreenX(v, n.x, w) - px;
        const dy = toScreenY(v, n.y, h) - py;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    },
    onHover(n, px, py) {
      pointer.current = { x: px, y: py };
      const key = n?.key ?? null;
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      setHover(n ? { key: n.key, x: px, y: py } : null);
      view.requestDraw();
    },
    onClick(n, shift) {
      dismissHint();
      if (!n) {
        const hit = edgeAt(pointer.current.x, pointer.current.y);
        if (hit) {
          setEdgeCard(hit);
          return;
        }
      }
      setEdgeCard(null);
      if (refs.current.bridgeFrom && n && n.kind === 'doc' && `doc:${refs.current.bridgeFrom}` !== n.key) {
        setDiscoverIntent({ kind: 'bridge', docIds: [refs.current.bridgeFrom, n.id] });
        setBridgeFrom(null);
        nav.navigate({ view: 'discover' });
        return;
      }
      if (shift && n && refs.current.selKey && refs.current.selKey !== n.key) {
        const p = bfsPath((k) => net.neighbors(k), refs.current.selKey, n.key);
        setPathKeys(p);
        setNote(p ? null : { text: t('network.ent.noPath') });
        view.requestDraw();
        return;
      }
      setPathKeys(null);
      setFocusKey(null);
      if (n && n.fixed && n.key === refs.current.selKey) n.fixed = false;
      pick(n);
    },
    onDoubleClick(n) {
      if (!n) return false;
      focusOn(n);
      return true;
    },
    bounds: getBounds,
    maxFit: () => 40 / NODE_R,
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

  const syncCount = () => setCount(net.size);

  function pick(n: NetNode | null): void {
    setSelKey(n?.key ?? null);
    if (n?.kind === 'doc') onSelectDoc(n.id);
    if (n) {
      setCursor(n.key);
      setAnnounce(t('network.net.announce', { name: n.label, kind: t(`network.net.${n.kind}Node`), links: net.neighbors(n.key).length }));
    }
    view.requestDraw();
  }

  /** Double click: the two-step neighbourhood in focus (the rest at 12%), the camera flies onto it; the node is expanded if it was not. */
  function focusOn(n: NetNode): void {
    setFocusKey(n.key);
    pick(n);
    const ring = [n.key, ...net.neighbors(n.key)].map((k) => net.nodes.get(k)).filter((x): x is NetNode => !!x);
    if (ring.length > 1) {
      const b = boundsOf(
        ring.map((r) => r.x),
        ring.map((r) => r.y),
        ring.length,
      );
      const { w, h } = view.size.current;
      view.flyTo((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, Math.min(3, Math.min(w, h) / Math.max(b.maxX - b.minX + 160, b.maxY - b.minY + 160, 1)));
    }
    if (!n.expanded) void expand(n);
  }

  /** The `linked` edge under the pointer (a hit zone of 6 px). */
  function edgeAt(px: number, py: number): EdgeHit | null {
    const v = view.view.current;
    const { w, h } = view.size.current;
    let best: EdgeHit | null = null;
    let bestD = 36;
    for (const e of net.edges) {
      if (e.kind !== 'linked') continue;
      const a = net.nodes.get(e.a);
      const b = net.nodes.get(e.b);
      if (!a || !b) continue;
      const ax = toScreenX(v, a.x, w);
      const ay = toScreenY(v, a.y, h);
      const dx = toScreenX(v, b.x, w) - ax;
      const dy = toScreenY(v, b.y, h) - ay;
      const len2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = (ax + u * dx - px) ** 2 + (ay + u * dy - py) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = { a: e.a, b: e.b, kind: e.kind, weight: e.weight, x: px, y: py };
      }
    }
    return best;
  }

  const metaOf = (c: { a: string; b: string }) => linkMeta.current.get(`${c.a}|${c.b}`) ?? linkMeta.current.get(`${c.b}|${c.a}`);

  async function removeLink(card: EdgeHit): Promise<void> {
    const meta = metaOf(card);
    if (!meta) return;
    try {
      await rl.invoke('doclinks:remove', { ids: [meta.id] });
      net.edges = net.edges.filter((e) => !(e.kind === 'linked' && ((e.a === card.a && e.b === card.b) || (e.a === card.b && e.b === card.a))));
      net.version++;
      setEdgeCard(null);
      view.requestDraw();
    } catch (e) {
      setError(e);
    }
  }

  /** Asks the main process for the shares of the family on the document nodes and installs them (and the grouped physics when it is not the topic). */
  async function applyFamily(warm: boolean): Promise<void> {
    const f = familyRef.current;
    const docs = [...net.nodes.values()].filter((n) => n.kind === 'doc');
    try {
      const r = await rl.invoke('graph:family', { family: f, docIds: docs.map((n) => n.id).slice(0, MAX_NET_NODES) });
      if (f !== familyRef.current) return;
      const defs = nameClusters(t, (r.areas ?? []) as FamilyShares['areas']);
      applyShares(net.nodes.values(), r.items as FamilyShares['items']);
      const slots = assignAreaSlots(defs, f === TOPIC_FAMILY ? loadAreaMemo() : null);
      areaRef.current.defs = defs;
      areaRef.current.slots = slots.slots;
      setAreaState({ defs, slots: slots.slots });
      tagTopics();
      // Warm start from the positions on screen (never a random restart); with reduced motion it settles at once.
      if (warm) net.regroup(f !== TOPIC_FAMILY, reducedMotion());
      else net.grouping = f !== TOPIC_FAMILY;
      view.requestDraw();
      if (warm) view.fit(true);
    } catch (e) {
      setError(e);
    }
  }
  const lastFamily = useRef(family);
  useEffect(() => {
    if (lastFamily.current === family) return;
    lastFamily.current = family;
    if (net.size > 0) void applyFamily(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family]);

  useEffect(() => {
    if (lastRev.current === famRev) return;
    lastRev.current = famRev;
    if (net.size > 0 && familyRef.current !== TOPIC_FAMILY) void applyFamily(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [famRev]);

  async function expand(n: NetNode): Promise<void> {
    const valid = kindsRef.current.filter((k) => VALID[n.kind].includes(k));
    if (valid.length === 0) {
      setNote({ text: t('network.net.noKinds') });
      return;
    }
    if (n.expanded) {
      setNote({ text: t('network.net.alreadyExpanded') });
      return;
    }
    // One expansion per node at a time (a double click must not ask twice).
    if (expanding.current.has(n.key)) return;
    expanding.current.add(n.key);
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await rl.invoke('graph:neighbors', { node: { kind: n.kind as 'doc' | 'folder' | 'tag', id: n.id }, kinds: valid, limit: limitRef.current });
      const live = net.nodes.get(n.key);
      if (!live) return;
      for (const e of r.edges) if (e.kind === 'linked' && e.id) linkMeta.current.set(`${e.from}|${e.to}`, { id: e.id, reasons: (e.reasons ?? {}) as LinkReasons });
      const res = net.expand(live, r.nodes, r.edges);
      if (familyRef.current === TOPIC_FAMILY && r.areas && r.areas.length > 0 && areaRef.current.defs !== r.areas) {
        const slots = assignAreaSlots(r.areas, loadAreaMemo());
        saveAreaMemo(slots.memo);
        areaRef.current.defs = r.areas;
        areaRef.current.slots = slots.slots;
        setAreaState({ defs: r.areas, slots: slots.slots });
      }
      if (familyRef.current !== TOPIC_FAMILY) await applyFamily(false);
      else tagTopics();
      if (res.capped) setNote({ text: t('network.net.capped', { count: res.omitted, limit: MAX_NET_NODES }), only: live });
      else if (r.hiddenTags) setNote({ text: t('network.net.tagsMore', { count: r.hiddenTags }), only: live });
      else if (res.added === 0) setNote({ text: t('network.net.nothingNew') });
      syncCount();
      view.requestDraw();
      if (reducedMotion()) for (let i = 0; i < 400 && net.tick(); i++);
      // After every expansion the view is fitted again, animated (400 ms; at once with reduced motion).
      view.fit(true);
    } catch (e) {
      setError(e);
    } finally {
      expanding.current.delete(n.key);
      setBusy(expanding.current.size > 0);
    }
  }

  // A start (from the selection, the map, the pickers): reset, seed and expand once.
  useEffect(() => {
    if (!start || start.nonce === lastStart.current) return;
    lastStart.current = start.nonce;
    net.clear();
    const seed = net.seed({ kind: start.kind, id: start.id, label: start.label });
    tagTopics();
    setSelKey(seed.key);
    setError(null);
    setNote(null);
    setPathKeys(null);
    setFocusKey(null);
    setSurprise(null);
    syncCount();
    view.fit();
    void expand(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start?.nonce]);

  // Never empty (D-379): with no start, the selected document, or the most linked of the latest ones, opens one step expanded.
  useEffect(() => {
    if (start || count > 0 || autoTried.current) return;
    autoTried.current = true;
    let live = true;
    (async () => {
      if (selectedDoc) return onStart({ kind: 'doc', id: selectedDoc, label: selectedDocLabel ?? untitled });
      // The document read last, when it is still in the library, is the natural place to start.
      const resume = await rl.invoke('resume:get', {}).catch(() => null);
      if (resume?.last) {
        const d = await rl.invoke('documents:get', { docId: resume.last.docId }).catch(() => null);
        if (d && live) return onStart({ kind: 'doc', id: resume.last.docId, label: d.title ?? untitled });
      }
      const list = await rl.invoke('documents:list', { limit: 8, sort: 'added-desc' });
      const scored = await Promise.all(
        list.items.map((d) => {
          const label = d.title ?? untitled;
          return rl.invoke('graph:neighbors', { node: { kind: 'doc', id: d.docId }, kinds: ['similar', 'citations'], limit: 25 }).then(
            (r) => ({ id: d.docId, label, n: r.nodes.length }),
            () => ({ id: d.docId, label, n: 0 }),
          );
        }),
      );
      if (!live) return;
      scored.sort((a, b) => b.n - a.n);
      setChips(scored.slice(0, 5));
      if (scored[0] && scored[0].n > 0) onStart({ kind: 'doc', id: scored[0].id, label: scored[0].label });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, start?.nonce]);

  // The topics of the Panorama, once (nothing when the model is not built): documents are tinted and ringed by topic.
  useEffect(() => {
    let live = true;
    rl.invoke('graph:map', {}).then(
      (m) => {
        if (!live) return;
        const top = m.clusters.filter((c) => c.level === 0);
        const of = new Map<string, string>();
        for (const p of m.points) if (p.clusters[0] !== undefined) of.set(p.docId, p.clusters[0]);
        topics.current = { of, tint: assignKeyTints(top.map((c) => c.id)), name: new Map(top.map((c) => [c.id, clusterText(c).text])) };
        tagTopics();
        view.requestDraw();
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = selKey ? net.nodes.get(selKey) : undefined;
  const afterChange = () => {
    syncCount();
    if (selKey && !net.nodes.has(selKey)) setSelKey(null);
    view.requestDraw();
  };
  const ctlRef = useRef<{ expand(): void; collapse(): void; remove(): void; bridge(): void; links(): void }>({ expand() {}, collapse() {}, remove() {}, bridge() {}, links() {} });
  ctlRef.current = {
    expand: () => selected && void expand(selected),
    collapse() {
      if (selected) net.collapse(selected.key);
      afterChange();
    },
    remove() {
      if (selected) net.remove(selected.key);
      afterChange();
    },
    bridge() {
      if (selected?.kind === 'doc') setBridgeFrom(selected.id);
    },
    links() {
      if (selected?.kind === 'doc') setFindFor(selected.id);
    },
  };
  const ctlKey = selected && selected.kind === 'doc' ? `${selected.key}|${selected.expanded ? 1 : 0}|${busy ? 1 : 0}` : '';
  useEffect(() => {
    if (!active || !selected || selected.kind !== 'doc') return onCtl(null);
    onCtl({ expanded: !!selected.expanded, busy, expand: () => ctlRef.current.expand(), collapse: () => ctlRef.current.collapse(), remove: () => ctlRef.current.remove(), bridge: () => ctlRef.current.bridge(), links: () => ctlRef.current.links() });
    return () => onCtl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ctlKey]);
  const hovered = hover ? net.nodes.get(hover.key) : undefined;

  const keyAt = () => {
    const v = view.view.current;
    const { w, h } = view.size.current;
    const list = [...net.nodes.values()];
    const xs = list.map((n) => toScreenX(v, n.x, w));
    const ys = list.map((n) => toScreenY(v, n.y, h));
    return { list, xs, ys, inView: list.map((_, i) => i).filter((i) => xs[i]! >= 0 && ys[i]! >= 0 && xs[i]! <= w && ys[i]! <= h) };
  };

  /** Keyboard: arrows go to the nearest node that way, ] and [ walk through all, Enter selects (twice: expands), Shift+Enter reads. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === ']' || e.key === '[') {
      const keys = [...net.nodes.keys()];
      if (keys.length === 0) return;
      const from = cursor ?? selKey;
      const at = from ? keys.indexOf(from) : -1;
      const next = keys[(at + (e.key === ']' ? 1 : -1) + keys.length) % keys.length]!;
      setSelKey(next);
      setCursor(next);
      view.requestDraw();
      return e.preventDefault();
    }
    const a = mapAction(e);
    if (!a) return view.handlers.onKeyDown(e);
    const n = (cursor ? net.nodes.get(cursor) : undefined) ?? selected;
    switch (a.type) {
      case 'move': {
        const k = keyAt();
        const from = n ? k.list.indexOf(n) : -1;
        const next = from < 0 ? firstNode(k.xs, k.ys, k.inView) : nearestInDirection(k.xs, k.ys, from, a.dir, k.inView);
        if (next < 0) return;
        const target = k.list[next]!;
        setCursor(target.key);
        setAnnounce(t('network.net.announce', { name: target.label, kind: t(`network.net.${target.kind}Node`), links: net.neighbors(target.key).length }));
        view.requestDraw();
        break;
      }
      case 'open':
        if (n && selKey === n.key) void expand(n);
        else pick(n ?? null);
        break;
      case 'read':
        if (n?.kind === 'doc') onSelectDoc(n.id);
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
        return onExplore?.();
      default:
        return;
    }
    e.preventDefault();
  };

  const toggleKind = (k: Kind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : KINDS.filter((x) => x === k || cur.includes(x))));
  /** "Sorprendimi": a pair close in content but far in the topics; both documents join the network and the camera flies to them. */
  const doSurprise = async () => {
    try {
      const r = await rl.invoke('graph:surprising', { limit: 30 });
      const p = r.pairs[Math.floor(rand.current() * r.pairs.length)];
      if (!p) return setNote({ text: t('network.ent.noSurprise') });
      const a = net.seed({ kind: 'doc', id: p.a, label: untitled });
      const b = net.seed({ kind: 'doc', id: p.b, label: untitled });
      setSurprise({ a: a.key, b: b.key, terms: p.terms });
      syncCount();
      for (const n of [a, b]) {
        void rl.invoke('documents:get', { docId: n.id }).then(
          (d) => {
            n.label = d.title ?? n.label;
            view.requestDraw();
          },
          () => undefined,
        );
      }
      view.flyTo((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(view.view.current.k, 1));
      view.requestDraw();
    } catch (e) {
      setError(e);
    }
  };

  const paintMini = useMemo(
    () => (ctx: CanvasRenderingContext2D, to: (x: number, y: number) => [number, number]) => {
      ctx.fillStyle = theme.current?.accent ?? '#0f6e78';
      for (const n of net.nodes.values()) {
        const [x, y] = to(n.x, n.y);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    },
    [net],
  );

  const reset = () => {
    net.clear();
    setSelKey(null);
    setNote(null);
    setError(null);
    setSurprise(null);
    setPathKeys(null);
    lastStart.current = start?.nonce ?? 0;
    autoTried.current = true;
    afterChange();
  };

  const docNodes = [...net.nodes.values()].filter((n) => n.kind === 'doc');
  let pill: ReactNode = null;
  if (bridgeFrom) {
    pill = (
      <Pill testId="net-bridge-pick" onClose={() => setBridgeFrom(null)}>
        {t('network.bridge.pickSecondShort')}
      </Pill>
    );
  } else if (surprise) {
    pill = (
      <Pill testId="net-surprise-note" onClose={() => setSurprise(null)}>
        {t('network.net.surprise', { terms: surprise.terms.slice(0, 5).map(safeText).join(', ') || '—' })}
      </Pill>
    );
  } else if (note) {
    pill = (
      <Pill testId="net-note" onClose={() => setNote(null)}>
        {note.text}
        {note.only && (
          <>
            {' · '}
            <button type="button" className="link" onClick={() => onStart({ kind: note.only!.kind, id: note.only!.id, label: note.only!.label })} data-testid="net-only-these">
              {t('network.net.onlyThese')}
            </button>
          </>
        )}
      </Pill>
    );
  } else if (byArea && areaState && count > 0 && areaNoteNeeded(areaState.defs, docNodes)) {
    pill = <AreaNote testId="net-color-note" defs={areaState.defs} withArea={docNodes.filter((n) => n.ar && n.ar.length > 0).length} total={docNodes.length} onTopics={() => setByArea(false)} />;
  } else if (hint && count > 0) {
    pill = <Pill testId="net-hint">{t('network.hint')}</Pill>;
  }

  return (
    <div className="net-tab graph-tab" data-testid="graph-panel">
      <RowPortal active={active}>
        {modeChip}
        <NodeSearch
          ref={searchRef}
          testId="net-search"
          label={t('network.search.go')}
          placeholder={t('network.search.goDoc')}
          suggest={async (q) => {
            const r = await rl.invoke('search:query', { text: q, limit: 8 });
            return r.hits.map((h) => ({ id: h.docId, label: h.title ?? untitled, hint: h.year ? String(h.year) : undefined }));
          }}
          onPick={(it) => {
            const known = net.nodes.get(`doc:${it.id}`);
            if (known) {
              view.flyTo(known.x, known.y, Math.max(view.view.current.k, 1.6));
              pick(known);
            } else onStart({ kind: 'doc', id: it.id, label: it.label });
          }}
        />
        <ChipPop label={t('network.start')} testId="net-start" width={360}>
          {(close) => (
            <div className="net-pop-body">
              <div className="net-pop-sec">{t('network.net.startFrom')}</div>
              <button
                type="button"
                onClick={() => {
                  if (selectedDoc) onStart({ kind: 'doc', id: selectedDoc, label: selectedDocLabel ?? untitled });
                  close();
                }}
                disabled={!selectedDoc}
                data-testid="net-start-doc"
              >
                {selectedDoc ? t('network.net.fromDocNamed', { title: safeText(selectedDocLabel ?? untitled) }) : t('network.net.fromDoc')}
              </button>
              <label className="net-field net-pop-row">
                <span>{t('network.net.fromFolder')}</span>
                <select
                  value="__none"
                  onChange={(e) => {
                    if (e.target.value !== '__none') {
                      onStart({ kind: 'folder', id: e.target.value, label: e.target.value === '' ? '/' : (e.target.value.split('/').pop() ?? e.target.value) });
                      close();
                    }
                  }}
                  data-testid="net-start-folder"
                >
                  <option value="__none">{t('network.scope.pick')}</option>
                  <option value="">/</option>
                  {scopes.folders.map((f) => (
                    <option key={f} value={f}>
                      {safeText(f)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="net-field net-pop-row">
                <span>{t('network.net.fromTag')}</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      onStart({ kind: 'tag', id: e.target.value, label: scopes.tagLabel(e.target.value) });
                      close();
                    }
                  }}
                  data-testid="net-start-tag"
                >
                  <option value="">{t('network.scope.pick')}</option>
                  {scopes.tags.map((x) => (
                    <option key={x.id} value={x.id}>
                      {safeText(x.label)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="net-pop-sec">{t('network.net.eachExpansion')}</div>
              <label className="net-field net-pop-row">
                <span>{t('network.net.limit')}</span>
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} data-testid="net-limit">
                  {LIMITS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="net-kinds" data-testid="net-kinds">
                <legend className="visually-hidden">{t('network.net.kinds')}</legend>
                {KINDS.map((k) => (
                  <label key={k} className="check-inline">
                    <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} data-testid={`net-kind-${k}`} />
                    {t(`network.net.kind.${k}`)}
                  </label>
                ))}
              </fieldset>
              <div className="net-pop-sec">{t('network.look')}</div>
              <div className="net-field net-pop-row">
                <span>{t('network.area.colorMode')}</span>
                <Segmented<'areas' | 'topics'>
                  size="sm"
                  label={t('network.area.colorMode')}
                  value={byArea ? 'areas' : 'topics'}
                  onChange={(v) => {
                    setByArea(v === 'areas');
                    byAreaRef.current = v === 'areas';
                    tagTopics();
                    view.requestDraw();
                  }}
                  options={[
                    { value: 'areas', label: t('network.area.colorAreas'), testId: 'net-color-areas' },
                    { value: 'topics', label: t('network.area.colorTopics'), testId: 'net-color-topics' },
                  ]}
                />
              </div>
              <GroupBy families={families} />
            </div>
          )}
        </ChipPop>
        <span className="map-actions">
          <button
            type="button"
            className="icon-button"
            title={t('network.play.shuffle')}
            aria-label={t('network.play.shuffle')}
            onClick={() => {
              net.shuffle(rand.current);
              if (reducedMotion()) for (let i = 0; i < 400 && net.tick(); i++);
              view.fit(true);
              view.requestDraw();
            }}
            disabled={count === 0}
            data-testid="net-shuffle"
          >
            ✧
          </button>
          <button type="button" className="icon-button" title={t('network.play.surprise')} aria-label={t('network.play.surprise')} onClick={() => void doSurprise()} data-testid="net-surprise">
            ✦
          </button>
          <button type="button" className="icon-button" title={t('network.fit')} aria-label={t('network.fit')} onClick={() => view.fit(true)} disabled={count === 0} data-testid="net-fit">
            ⤢
          </button>
        </span>
      </RowPortal>
      <HeadMore
        active={active}
        testId="net-more"
        groups={[
          {
            id: 'net',
            items: [
              count > 0 ? { id: 'reset', label: t('network.net.resetNet'), testId: 'net-reset', onSelect: reset } : { id: 'reset', label: t('network.net.resetNet'), testId: 'net-reset', onSelect: reset, disabled: true, disabledReason: t('network.net.emptyTitle') },
              {
                id: 'unpin',
                label: t('network.unpinAll'),
                testId: 'net-unpin-all',
                onSelect: () => {
                  for (const n of net.nodes.values()) n.fixed = false;
                  view.requestDraw();
                },
              },
            ],
          },
          {
            id: 'view',
            items: [
              { id: 'minimap', label: t('network.minimap'), icon: <span>{mini ? '☑' : '☐'}</span>, testId: 'net-minimap-toggle', onSelect: () => setMini(!mini) },
              { id: 'image', label: t('network.copyImage'), testId: 'net-image', onSelect: () => void copyCanvasImage(view.canvas.current).then((ok) => info(ok ? t('network.imageCopied') : t('network.imageFailed'))) },
            ],
          },
          chrome.model,
        ]}
      />
      {error ? <ErrorNote testId="net-error">{errorMessage(error, t)}</ErrorNote> : null}
      {count === 0 && (
        <EmptyState
          icon={<MapIllustration />}
          title={t('network.net.emptyTitle')}
          action={
            chips.length > 0 ? (
              <span className="chip-row" data-testid="net-chips">
                {chips.map((c) => (
                  <button key={c.id} type="button" className="rl-chip" onClick={() => onStart({ kind: 'doc', id: c.id, label: c.label })} data-testid="net-chip">
                    {safeText(c.label)}
                  </button>
                ))}
              </span>
            ) : undefined
          }
        >
          <span data-testid="net-empty">{t('network.net.empty')}</span>
        </EmptyState>
      )}
      <div className="map-wrap net-wrap" hidden={count === 0}>
        <canvas
          ref={view.canvas}
          className="map-canvas"
          tabIndex={0}
          role="application"
          aria-roledescription={t('network.roleMap')}
          aria-label={t('network.net.label')}
          data-testid="net-canvas"
          data-nodes={count}
          data-edges={net.edges.length}
          data-selected={selected?.key ?? ''}
          {...view.handlers}
          onKeyDown={onKeyDown}
        />
        <span className="visually-hidden" aria-live="polite" data-testid="net-focus">
          {announce}
        </span>
        {pill}
        {/* Legend and node count stack in one column, so they never overlap (audit on real data, D-490). */}
        <div className="net-bl">
        {areaState && areaRef.current.on && (
          <AreaLegend
            title={family !== TOPIC_FAMILY ? t('network.group.grouped', { name: familyName(t, families, family) }) : undefined}
            defs={areaState.defs}
            slots={areaState.slots}
            without={[...net.nodes.values()].filter((n) => n.kind === 'doc' && !(n.ar && n.ar.length > 0)).length}
            onLight={(a) => {
              litAreaRef.current = a;
              view.requestDraw();
            }}
            onIsolate={(a) => {
              isoAreaRef.current = a;
              view.requestDraw();
            }}
          />
        )}
        <div className="net-legend-box">
          {family !== TOPIC_FAMILY && count > 0 && <GroupLabel families={families} family={family} />}
          <span className="hint" data-testid="net-count" data-count={count} aria-live="polite">
            {t('network.net.count', { count })}
          </span>
          <span className="net-key" aria-label={t('network.net.legend')} data-testid="net-legend">
            <span className="key-doc">{t('network.net.docNode')}</span>
            <span className="key-folder">{t('network.net.folderNode')}</span>
            <span className="key-tag">{t('network.net.tagNode')}</span>
          </span>
        </div>
        </div>
        {hovered && hover && (
          <HoverCard x={hover.x} y={hover.y} width={view.size.current.w} height={view.size.current.h} testId="net-tooltip">
            {hovered.kind === 'doc' ? (
              <DocCard docId={hovered.id} area={areaRef.current.on ? areaSummary(hovered.ar, areaRef.current.defs) : undefined} />
            ) : (
              <strong className="hc-title">
                {safeText(hovered.label)}
                {hovered.count !== undefined && <span className="hint"> ({hovered.count})</span>}
              </strong>
            )}
          </HoverCard>
        )}
        {edgeCard && (
          <div className="net-edge-card" style={{ left: Math.min(edgeCard.x + 8, Math.max(0, view.size.current.w - 260)), top: Math.min(edgeCard.y + 8, Math.max(0, view.size.current.h - 120)) }} role="dialog" aria-label={t('network.edge.title')} data-testid="net-edge-card">
            <strong>{t(`network.edge.kind.${edgeCard.kind}`)}</strong>
            <span className="hint">{reasonLine(metaOf(edgeCard)?.reasons, (part, o = {}) => t(`network.edge.reason.${part}`, o), safeText)}</span>
            <span>
              {weightBar(edgeCard.weight)} {t('network.edge.weight', { value: edgeCard.weight.toFixed(2) })}
            </span>
            {edgeCard.kind === 'linked' && (
              <button type="button" onClick={() => void removeLink(edgeCard)} data-testid="net-edge-remove">
                {t('network.edge.remove')}
              </button>
            )}
            <button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setEdgeCard(null)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
        {findFor && (
          <Lazy>
            <LinkFinderDialog docIds={[findFor]} onClose={() => setFindFor(null)} onShowMap={(id, label) => onStart({ kind: 'doc', id, label: label || untitled })} />
          </Lazy>
        )}
        {mini && count > 0 && <MiniMap bounds={getBounds()} view={view.view} size={view.size} hooks={view.hooks} paint={paintMini} onMove={(x, y) => view.jump({ ...view.view.current, cx: x, cy: y })} label={t('network.minimapLabel')} version={count} />}
      </div>
    </div>
  );
}
