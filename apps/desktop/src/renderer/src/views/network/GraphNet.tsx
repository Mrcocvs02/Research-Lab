import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { boundsOf, toScreenX, toScreenY, type Bounds } from './geometry';
import { MAX_NET_NODES, Network, type EdgeKind, type NetNode, type NodeKind } from './forceSim';
import type { ScopeOptions } from './useScopes';
import { useCanvasView } from './useCanvasView';

type Kind = RequestOf<Channels, 'graph:neighbors'>['kinds'][number];
const KINDS: Kind[] = ['similar', 'citations', 'tags', 'folder', 'children', 'documents'];
/** What each kind of node can be expanded by. */
const VALID: Record<NodeKind, Kind[]> = { doc: ['similar', 'citations', 'tags', 'folder'], folder: ['children', 'documents'], tag: ['documents', 'tags'] };
const DEFAULT_KINDS: Kind[] = ['similar', 'citations', 'tags', 'folder', 'children', 'documents'];
const LIMITS = [10, 25, 50, 100, 300] as const;
const NODE_R = 7;

export interface NetStart {
  kind: NodeKind;
  id: string;
  label: string;
  /** Changes at every request, so asking for the same start again resets the network. */
  nonce: number;
}

interface Props {
  start: NetStart | null;
  scopes: ScopeOptions;
  /** The document selected elsewhere (the map, a list): can be the start of the network. */
  selectedDoc: string | null;
  selectedDocLabel: string | null;
  onSelectDoc(docId: string): void;
  onStart(start: Omit<NetStart, 'nonce'>): void;
}

interface Theme {
  dark: boolean;
  text: string;
  muted: string;
  accent: string;
  ok: string;
  warn: string;
  surface: string;
}

const EDGE_STYLE: Record<EdgeKind, { dash: number[]; color: keyof Theme }> = {
  similar: { dash: [6, 4], color: 'accent' },
  cites: { dash: [], color: 'text' },
  tagged: { dash: [2, 3], color: 'ok' },
  contains: { dash: [], color: 'muted' },
};

/**
 * The expandable network on a canvas: start from a document, folder or tag; expand a node by chosen kinds of neighbours;
 * new nodes appear around it and a small force step settles them without moving the rest. No graph library, no DOM per
 * node; frames only while the layout settles or the view changes.
 */
export function GraphNet({ start, scopes, selectedDoc, selectedDocLabel, onSelectDoc, onStart }: Props) {
  const { t } = useTranslation();
  const net = useMemo(() => new Network(), []);
  const [kinds, setKinds] = useState<Kind[]>(DEFAULT_KINDS);
  const [limit, setLimit] = useState<number>(25);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const hoverKey = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = selKey;
  const theme = useRef<Theme | null>(null);
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const lastStart = useRef(0);

  const view = useCanvasView<NetNode>({
    draw(ctx, w, h, v) {
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      if (theme.current?.dark !== dark) {
        const css = getComputedStyle(ctx.canvas);
        const get = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
        theme.current = { dark, text: css.color, muted: get('--text-muted', '#5a6475'), accent: get('--accent', '#2955d9'), ok: get('--ok', '#1b7a43'), warn: dark ? '#e0b45a' : '#a8741a', surface: get('--surface', '#fff') };
      }
      const th = theme.current!;
      const sx = (x: number) => toScreenX(v, x, w);
      const sy = (y: number) => toScreenY(v, y, h);
      const nodes = net.nodes;
      // Edges: one path per style (similar edges by weight).
      ctx.lineCap = 'round';
      for (const kind of ['contains', 'tagged', 'cites', 'similar'] as EdgeKind[]) {
        const style = EDGE_STYLE[kind];
        ctx.strokeStyle = th[style.color] as string;
        ctx.setLineDash(style.dash);
        ctx.globalAlpha = kind === 'contains' ? 0.55 : 0.8;
        if (kind === 'similar') {
          for (const e of net.edges) {
            if (e.kind !== kind) continue;
            const a = nodes.get(e.a);
            const b = nodes.get(e.b);
            if (!a || !b) continue;
            ctx.lineWidth = 1 + e.weight * 3;
            ctx.beginPath();
            ctx.moveTo(sx(a.x), sy(a.y));
            ctx.lineTo(sx(b.x), sy(b.y));
            ctx.stroke();
          }
          continue;
        }
        ctx.lineWidth = kind === 'cites' ? 1.6 : 1;
        ctx.beginPath();
        for (const e of net.edges) {
          if (e.kind !== kind) continue;
          const a = nodes.get(e.a);
          const b = nodes.get(e.b);
          if (!a || !b) continue;
          ctx.moveTo(sx(a.x), sy(a.y));
          ctx.lineTo(sx(b.x), sy(b.y));
          if (kind === 'cites') {
            // Arrow head at the cited end.
            const ax = sx(a.x);
            const ay = sy(a.y);
            const bx = sx(b.x);
            const by = sy(b.y);
            const ang = Math.atan2(by - ay, bx - ax);
            const tx = bx - Math.cos(ang) * (NODE_R + 2);
            const ty = by - Math.sin(ang) * (NODE_R + 2);
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - Math.cos(ang - 0.45) * 7, ty - Math.sin(ang - 0.45) * 7);
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - Math.cos(ang + 0.45) * 7, ty - Math.sin(ang + 0.45) * 7);
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Nodes: one path per kind (circle: document, square: folder, diamond: tag).
      const fills: Record<NodeKind, string> = { doc: th.accent, folder: th.warn, tag: th.ok };
      for (const kind of ['doc', 'folder', 'tag'] as NodeKind[]) {
        ctx.fillStyle = fills[kind];
        ctx.beginPath();
        for (const n of nodes.values()) {
          if (n.kind !== kind) continue;
          const x = sx(n.x);
          const y = sy(n.y);
          if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
          if (kind === 'doc') {
            ctx.moveTo(x + NODE_R, y);
            ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
          } else if (kind === 'folder') ctx.rect(x - NODE_R, y - NODE_R, NODE_R * 2, NODE_R * 2);
          else {
            ctx.moveTo(x, y - NODE_R - 2);
            ctx.lineTo(x + NODE_R + 2, y);
            ctx.lineTo(x, y + NODE_R + 2);
            ctx.lineTo(x - NODE_R - 2, y);
            ctx.closePath();
          }
        }
        ctx.fill();
      }
      // Expanded nodes, the selected one and the hovered one get a ring.
      ctx.strokeStyle = th.text;
      for (const n of nodes.values()) {
        const isSel = n.key === selRef.current;
        const isHover = n.key === hoverKey.current;
        if (!n.expanded && !isSel && !isHover) continue;
        ctx.lineWidth = isSel ? 3 : isHover ? 2 : 1.5;
        ctx.globalAlpha = n.expanded && !isSel && !isHover ? 0.5 : 1;
        ctx.beginPath();
        ctx.arc(sx(n.x), sy(n.y), NODE_R + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Labels: everywhere when the network is small or zoomed in, else only for the ones that matter.
      const all = nodes.size <= 120 || v.k >= 1.4;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillStyle = th.text;
      for (const n of nodes.values()) {
        if (!all && !n.expanded && n.key !== selRef.current && n.key !== hoverKey.current) continue;
        const x = sx(n.x);
        const y = sy(n.y);
        if (x < -60 || y < -20 || x > w + 60 || y > h + 20) continue;
        const text = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        ctx.fillText(text, x, y + NODE_R + 5);
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
      const key = n?.key ?? null;
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      setHover(n ? { key: n.key, x: px, y: py } : null);
      view.requestDraw();
    },
    onClick(n) {
      setSelKey(n?.key ?? null);
      if (n?.kind === 'doc') onSelectDoc(n.id);
      view.requestDraw();
    },
    onDoubleClick(n) {
      if (n) void expand(n);
    },
    bounds: (): Bounds | null => {
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
    },
    tick: () => {
      if (!net.tick()) return false;
      return net.heat > 0;
    },
    dragStart(n, wx, wy) {
      n.pinned = true;
      n.x = wx;
      n.y = wy;
      net.warm(40);
      return true;
    },
    dragMove(n, wx, wy) {
      n.x = wx;
      n.y = wy;
      net.warm(20);
    },
    dragEnd(n) {
      n.pinned = false;
      net.warm(30);
    },
  });

  const syncCount = () => setCount(net.size);

  async function expand(n: NetNode): Promise<void> {
    const valid = kindsRef.current.filter((k) => VALID[n.kind].includes(k));
    if (valid.length === 0) {
      setNote(t('network.net.noKinds'));
      return;
    }
    if (n.expanded) {
      setNote(t('network.net.alreadyExpanded'));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await rl.invoke('graph:neighbors', { node: { kind: n.kind, id: n.id }, kinds: valid, limit: limitRef.current });
      const live = net.nodes.get(n.key);
      if (!live) return;
      const res = net.expand(live, r.nodes, r.edges);
      if (res.capped) setNote(t('network.net.capped', { limit: MAX_NET_NODES }));
      else if (res.added === 0) setNote(t('network.net.nothingNew'));
      syncCount();
      view.requestDraw();
      // The first expansion shows the whole network; later ones keep the view the user chose.
      if (net.size <= 40) view.fit();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // A start (from the selection, the map, the pickers): reset, seed and expand once.
  useEffect(() => {
    if (!start || start.nonce === lastStart.current) return;
    lastStart.current = start.nonce;
    net.clear();
    const seed = net.seed({ kind: start.kind, id: start.id, label: start.label });
    setSelKey(seed.key);
    setError(null);
    setNote(null);
    syncCount();
    view.fit();
    void expand(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start?.nonce]);

  const selected = selKey ? net.nodes.get(selKey) : undefined;
  /** Keyboard: ] and [ move the selection through the nodes, Enter expands the selected one; the rest is pan and zoom. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === ']' || e.key === '[') {
      const keys = [...net.nodes.keys()];
      if (keys.length === 0) return;
      const at = selKey ? keys.indexOf(selKey) : -1;
      const next = keys[(at + (e.key === ']' ? 1 : -1) + keys.length) % keys.length]!;
      setSelKey(next);
      view.requestDraw();
      e.preventDefault();
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault();
      void expand(selected);
    } else view.handlers.onKeyDown(e);
  };
  const toggleKind = (k: Kind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : KINDS.filter((x) => x === k || cur.includes(x))));
  const hovered = hover ? net.nodes.get(hover.key) : undefined;
  const afterChange = () => {
    syncCount();
    if (selKey && !net.nodes.has(selKey)) setSelKey(null);
    view.requestDraw();
  };

  return (
    <div className="net-tab graph-tab" data-testid="graph-panel">
      <div className="net-toolbar">
        <button type="button" onClick={() => selectedDoc && onStart({ kind: 'doc', id: selectedDoc, label: selectedDocLabel ?? selectedDoc.slice(0, 8) })} disabled={!selectedDoc} data-testid="net-start-doc">
          {t('network.net.fromDoc')}
        </button>
        <label className="net-field">
          <span>{t('network.net.fromFolder')}</span>
          <select
            value="__none"
            onChange={(e) => {
              if (e.target.value !== '__none') onStart({ kind: 'folder', id: e.target.value, label: e.target.value === '' ? '/' : (e.target.value.split('/').pop() ?? e.target.value) });
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
        <label className="net-field">
          <span>{t('network.net.fromTag')}</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onStart({ kind: 'tag', id: e.target.value, label: scopes.tagLabel(e.target.value) });
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
        <label className="net-field">
          <span>{t('network.net.limit')}</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} data-testid="net-limit">
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="net-kinds" data-testid="net-kinds">
        <legend>{t('network.net.kinds')}</legend>
        {KINDS.map((k) => (
          <label key={k} className="check-inline">
            <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} data-testid={`net-kind-${k}`} />
            {t(`network.net.kind.${k}`)}
          </label>
        ))}
      </fieldset>
      <div className="net-toolbar">
        <button type="button" onClick={() => selected && void expand(selected)} disabled={!selected || busy || selected.expanded} data-testid="net-expand">
          {t('network.net.expand')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (selected) net.collapse(selected.key);
            afterChange();
          }}
          disabled={!selected || !selected.expanded}
          data-testid="net-collapse"
        >
          {t('network.net.collapse')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (selected) net.remove(selected.key);
            afterChange();
          }}
          disabled={!selected}
          data-testid="net-remove"
        >
          {t('network.net.remove')}
        </button>
        <button
          type="button"
          onClick={() => {
            net.clear();
            setSelKey(null);
            setNote(null);
            setError(null);
            lastStart.current = start?.nonce ?? 0;
            afterChange();
          }}
          disabled={count === 0}
          data-testid="net-reset"
        >
          {t('network.net.reset')}
        </button>
        <button type="button" onClick={() => view.fit()} disabled={count === 0} data-testid="net-fit">
          {t('network.fit')}
        </button>
        <span className="hint" data-testid="net-count" data-count={count} aria-live="polite">
          {t('network.net.count', { count })}
        </span>
        <span className="net-key" aria-label={t('network.net.legend')} data-testid="net-legend">
          <span className="key-doc">{t('network.net.docNode')}</span>
          <span className="key-folder">{t('network.net.folderNode')}</span>
          <span className="key-tag">{t('network.net.tagNode')}</span>
          <span className="key-line key-similar">{t('network.net.kind.similar')}</span>
          <span className="key-line key-cites">{t('network.net.edge.cites')}</span>
          <span className="key-line key-tagged">{t('network.net.edge.tagged')}</span>
          <span className="key-line key-contains">{t('network.net.edge.contains')}</span>
        </span>
      </div>
      {error ? <ErrorNote testId="net-error">{errorMessage(error, t)}</ErrorNote> : null}
      {note && (
        <p className="hint" role="status" data-testid="net-note">
          {note}
        </p>
      )}
      {count === 0 ? (
        <p className="hint" data-testid="net-empty">
          {t('network.net.empty')}
        </p>
      ) : (
        <p className="hint">{t('network.net.help')}</p>
      )}
      <div className="map-wrap net-wrap">
        <canvas
          ref={view.canvas}
          className="map-canvas"
          tabIndex={0}
          role="img"
          aria-label={t('network.net.label')}
          data-testid="net-canvas"
          data-nodes={count}
          data-edges={net.edges.length}
          data-selected={selected?.key ?? ''}
          {...view.handlers}
          onKeyDown={onKeyDown}
        />
        {hovered && (
          <div className="map-tooltip" role="tooltip" style={{ left: (hover?.x ?? 0) + 12, top: (hover?.y ?? 0) + 12 }} data-testid="net-tooltip">
            {safeText(hovered.label)}
            {hovered.count !== undefined && <span className="hint"> ({hovered.count})</span>}
          </div>
        )}
      </div>
    </div>
  );
}
