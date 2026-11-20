import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import type { Channels, MapViewFrame, MapViewState, RequestOf } from '@rl/core';
import { MAP_EDIT_LIMITS } from '@rl/core';
import { Button } from '../../components/Button';
import { Lazy, lazyView } from '../../components/Lazy';
import type { MenuItem } from '../../components/Menu';
import { Switch } from '../../components/Switch';
import { setDiscoverIntent } from '../../lib/discoverIntent';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { takeMapViewIntent } from '../../lib/mapViewIntent';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { safeText } from '../library/safeText';
import { loadMetas, peekMeta, type BlockView } from './blocksDraw';
import { filterKinds, type EdgeMode, type EvEdge } from './edges';
import { gapPairs, isolatedOf, mostCentral } from './gaps';
import { familyLabel, useFamily } from './grouping';
import { nextToRead as pickNext, type NextPick, type PickLink } from './reading';
import { useWide, type Strictness } from './MapSide';
import './mapExtras.css';

// The viewer's saved views and the export live in their own chunk, loaded when the section is opened or a menu entry is chosen.
const ViewsSection = lazyView(() => import('./export/MapViews').then((m) => ({ default: m.ViewsSection })), ['mapExtras', 'network']);
const ViewsDialog = lazyView(() => import('./export/MapViews').then((m) => ({ default: m.ViewsDialog })), ['mapExtras', 'network']);
const ExportDialog = lazyView(() => import('./export/MapViews').then((m) => ({ default: m.ExportDialog })), ['mapExtras', 'network']);

/** What the Map's reading state, isolated papers, saved views and export need from the panel (section 20.10). */
type MapScope = NonNullable<RequestOf<Channels, 'graph:map'>['scope']>;
type Kind = 'cites' | 'linked' | 'similar';

/** What `MapPanel` holds that the hook cannot see: the evidence chips, threshold and edge mode, the years, the camera; and a way to frame the canvas. */
export interface ViewBridge {
  read(): { years: [number, number] | null; kinds: Kind[]; strictness: Strictness; edgeMode: EdgeMode; camera: { cx: number; cy: number; k: number } | null; size?: { w: number; h: number } | null };
  /** Puts back the filters of a saved view (the scope is `v.scope`; `years` is null to clear). */
  write(v: { scope: MapScope | undefined; years: [number, number] | null; kinds: Kind[]; strictness: Strictness; edgeMode: EdgeMode }): void;
  /** Frames the canvas: everything, some blocks, some papers, or an exact camera. */
  frame(f: { kind: 'fit' } | { kind: 'blocks'; ids: string[] } | { kind: 'docs'; ids: string[] } | { kind: 'camera'; cx: number; cy: number; k: number }): void;
}

export interface MapExtrasInput {
  /** The blocks of the family (null with the free layout: the reading and gap controls are then switched off with their reason). */
  blocks: BlockView | null;
  /** Evidence of the Map: the object of `graph:evidence` or just its edges, NOT filtered by the chips (isolation counts every kind of evidence). */
  evidence: { tau?: number; edges: readonly EvEdge[] } | readonly EvEdge[] | null;
  selected: string | null;
  /** Ids of the papers of the multiple selection. */
  multi: ReadonlySet<string> | readonly string[];
  family: string;
  scope: MapScope | undefined;
  onFly(docId: string): void;
  onSelect(docId: string | null): void;
  onSelectMany(ids: string[]): void;
  /** Optional: what `MapPanel` holds (without it a saved view keeps only family, reading filters, selection and a fit frame). */
  bridge?: ViewBridge;
  /** Called when a saved view is opened, whoever asked (dialog, section or shortcut): the owner of the Back / Forward stack records the place. */
  onApply?(): void;
  /** Optional: the name of the family for the default name of a view and the file name of an export. */
  familyName?: string;
  /** False while the Map tab is hidden (the shortcut Ctrl+Shift+S then does nothing). */
  active?: boolean;
}

export interface MapExtras {
  /** Papers that pass "Unread only"; null = all. `MapPanel` intersects it with its own filters. */
  allow: ReadonlySet<string> | null;
  /** Reading state of the papers that are not "to read". */
  st: Map<string, 1 | 2>;
  /** Isolated papers to ring: empty unless "Isolated and bridges" is on. */
  isolated: ReadonlySet<string>;
  /** The two blocks lit by the hovered row of the side column (indices of the block view), for `extras.pairLit`. */
  pairLit: readonly [number, number] | null;
  sideSections: ReactNode;
  filterRows: ReactNode;
  moreItems: MenuItem[];
  paperItems(docId: string): MenuItem[];
  nextToRead(from: string[] | null): void;
  captureView(): MapViewState;
  applyView(v: MapViewState): void;
}

/** What the views section and its dialog need from the panel (functions read the latest state, whenever they run). */
export interface ViewsApi {
  capture(): MapViewState;
  apply(v: MapViewState): void;
  defaultName(): string;
  selectionTooBig(): boolean;
  notify: Notify;
}
export interface Notify {
  info(text: string, action?: { label: string; run(): void }): void;
  fail(text: string): void;
  error(e: unknown): void;
}
/** What an export needs: the blocks and the evidence as they are on the screen, the camera and what is selected. */
export interface ExportCtx {
  bv: BlockView | null;
  /** Evidence already filtered by the chips. */
  edges: readonly EvEdge[];
  edgeMode: EdgeMode;
  selected: string | null;
  multi: readonly string[];
  isolated: readonly string[];
  allow: ReadonlySet<string> | null;
  camera: { cx: number; cy: number; k: number } | null;
  familyName: string;
}

const EMPTY: ReadonlySet<string> = new Set();
const ALL_KINDS: Kind[] = ['cites', 'linked', 'similar'];
const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** FNV-1a of a string, base 36: the fingerprint of a layout (`sig` of a saved camera). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
/** Fingerprint of a layout: family, scope, the blocks and the shape of the canvas rounded to a tenth (D-527). */
export function layoutSig(family: string, scope: unknown, blockIds: readonly string[], aspect: number): string {
  return hash(`${family}|${JSON.stringify(scope ?? null)}|${blockIds.join(',')}|${(Math.round(aspect * 10) / 10).toFixed(1)}`);
}

/** The live canvas of the Map (blocks): its element, for the size and the colours. */
export const mapCanvasEl = (): HTMLCanvasElement | null => document.querySelector<HTMLCanvasElement>('[data-testid="map-canvas"]');

/** Mounts a dialog in its own root on the page body (modal, so nothing under it changes) and returns nothing; `close` unmounts it. */
function mountOverlay(render: (close: () => void) => ReactNode): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () =>
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  root.render(<Lazy>{render(close)}</Lazy>);
}

/** One-line section of the side column (and of the Filters popover): a small title, then its rows. */
function Section({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="map-ext" data-testid={testId} aria-label={title}>
      <h3 className="map-ctl-title">{title}</h3>
      {children}
    </section>
  );
}

function ReadingLegend() {
  const { t } = useTranslation();
  return (
    <ul className="map-ext-legend" data-testid="map-reading-legend" aria-label={t('mapRead.title')}>
      <li>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="var(--bg)" stroke="var(--text-muted)" strokeWidth="1.5" />
          <path d="M7 2.5 A4.5 4.5 0 0 0 7 11.5 Z" fill="var(--text-muted)" />
        </svg>
        <span>{t('mapRead.legendStudy')}</span>
      </li>
      <li>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="8" r="4.5" fill="var(--text-muted)" />
          <path d="M5.5 3.2 L7.7 5.4 L11.5 1.8" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
        </svg>
        <span>{t('mapRead.legendRead')}</span>
      </li>
    </ul>
  );
}

interface Rows {
  ids: { unread: string; gaps: string; next: string; count: string };
  withWhy: boolean;
}

/**
 * The reading state, the isolated papers and bridges, the saved views and the export of the Map (D-525..D-528). `MapPanel` calls it with the
 * blocks and the evidence, and wires the pieces: `allow` into the filters, `sideSections` into `MapSide.extra`, `filterRows` into the Filters
 * popover, `moreItems` into the bar's menu; `MapCanvas` takes `st`, `isolated` and `pairLit` for `drawBlocks` and `paperItems` for its card.
 */
export function useMapExtras(p: MapExtrasInput): MapExtras {
  const { t, i18n } = useTranslation();
  const wide = useWide();
  const nav = useNav();
  const { info, fail, reportError } = useNotify();
  const [, setFamily] = useFamily();
  const [onlyUnread, setOnlyUnread] = useLocalFlag('rl.map.onlyUnread', false);
  const [viewsOpen, setViewsOpen] = useLocalFlag('rl.map.viewsOpen', false);
  const [gaps, setGaps] = useState(false);
  const [pairLit, setPairLit] = useState<readonly [number, number] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const bv = p.blocks;
  const edgeList = useMemo<readonly EvEdge[]>(() => (!p.evidence ? [] : Array.isArray(p.evidence) ? p.evidence : (p.evidence as { edges: readonly EvEdge[] }).edges), [p.evidence]);
  const multiIds = useMemo(() => [...p.multi], [p.multi]);

  const st = useMemo(() => {
    const m = new Map<string, 1 | 2>();
    if (bv) for (let i = 0; i < bv.ids.length; i++) if (bv.st[i]) m.set(bv.ids[i]!, bv.st[i] as 1 | 2);
    return m;
  }, [bv]);
  const allow = useMemo(() => (onlyUnread && bv ? new Set(bv.ids.filter((id) => st.get(id) !== 2)) : null), [onlyUnread, bv, st]);
  const isolatedAll = useMemo(() => (bv ? isolatedOf(bv.ids, edgeList) : EMPTY), [bv, edgeList]);
  const pairs = useMemo(
    () =>
      bv && gaps
        ? gapPairs(
            bv.blocks.map((b, i) => ({ id: b.id, other: b.other, none: b.none, docs: bv.members[i]!.map((x) => bv.ids[x]!) })),
            edgeList,
          )
        : [],
    [bv, edgeList, gaps],
  );
  const isolated = gaps ? isolatedAll : EMPTY;

  const title = (id: string): string => safeText(peekMeta(id)?.title ?? t('network.untitled'));
  const num = (e: number): string => e.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const blockIdOf = (id: string): string | undefined => {
    const i = bv?.index.get(id);
    return i === undefined ? undefined : bv!.blocks[bv!.block[i]!]!.id;
  };

  // ---- Next to read ----
  const whyText = (pick: NextPick): string => {
    const parts: string[] = [];
    const tie = (l: PickLink) => ({ title: title(l.id), e: num(l.e) });
    if (pick.step === 2 && pick.via && pick.from) parts.push(t('mapRead.why.via', { from: title(pick.from.id), via: title(pick.via) }));
    else {
      if (pick.read) parts.push(t(`mapRead.why.${pick.read.kind}`, tie(pick.read)));
      if (pick.from) {
        const txt = t(pick.from.kind === 'similar' ? 'mapRead.why.fromSimilar' : pick.from.kind === 'cites' ? 'mapRead.why.fromCites' : 'mapRead.why.fromLinked', tie(pick.from));
        const own = st.get(pick.from.id) === 2 ? t('mapRead.why.fromRead', { text: txt }) : txt;
        parts.push(parts.length === 0 ? own.charAt(0).toUpperCase() + own.slice(1) : own);
      }
    }
    return parts.length > 0 ? parts.join(' · ') : t('mapRead.why.central');
  };
  const nextToRead = (from: string[] | null): void => {
    if (!bv) return fail(t('mapRead.needsBlocks'));
    const start = from && from.length > 0 ? from : null;
    const pick = pickNext(edgeList, st, start, { ids: bv.ids, blockOf: blockIdOf });
    if (!pick) {
      const none = `${t('mapRead.none')} · ${t('mapRead.noneHint')}`;
      setWhy(none);
      info(none);
      return;
    }
    p.onSelect(pick.id);
    p.onFly(pick.id);
    // The titles may still be on their way: wait for the few the sentence names, then say why.
    void loadMetas([pick.id, ...(pick.read ? [pick.read.id] : []), ...(pick.from ? [pick.from.id] : []), ...(pick.via ? [pick.via] : [])]).then(() => {
      const text = whyText(pick);
      setWhy(text);
      info(text);
    });
  };
  const nextFromState = () => nextToRead(multiIds.length > 0 ? multiIds : p.selected ? [p.selected] : null);

  // ---- Isolated papers and bridges ----
  const goDiscover = (kind: 'bridge' | 'extend', docIds: string[]) => {
    setDiscoverIntent({ kind, docIds });
    nav.navigate({ view: 'discover' });
  };
  const central = (block: number): string | null => (bv ? mostCentral(bv.members[block]!.map((x) => bv.ids[x]!), edgeList) : null);
  const bridgePair = (a: number, b: number) => {
    const x = central(a);
    const y = central(b);
    if (x && y) goDiscover('bridge', [x, y]);
    else info(t('mapGaps.noBridge'));
  };
  const bridgeIsolated = async (docId: string) => {
    if (!bv) return;
    try {
      // The nearest block by similarity (even under the threshold); without a neighbour, the paper's own block.
      const r = await rl.invoke('graph:similar', { docId, limit: 10 });
      const own = bv.index.get(docId);
      const near = r.items.map((it) => bv.index.get(it.docId)).find((i): i is number => i !== undefined);
      const block = near !== undefined ? bv.block[near]! : own !== undefined ? bv.block[own]! : -1;
      const target = block >= 0 ? mostCentral(bv.members[block]!.map((x) => bv.ids[x]!).filter((id) => id !== docId), edgeList) : null;
      if (target) goDiscover('bridge', [docId, target]);
      else info(t('mapGaps.noBridge'));
    } catch (e) {
      reportError(e);
    }
  };
  const paperItems = (docId: string): MenuItem[] => {
    const next: MenuItem = bv
      ? { id: 'next-read', label: t('mapRead.next'), testId: 'map-next-read', onSelect: () => nextToRead([docId]) }
      : { id: 'next-read', label: t('mapRead.next'), testId: 'map-next-read', disabled: true, disabledReason: t('mapRead.needsBlocks'), onSelect: () => undefined };
    if (!isolatedAll.has(docId)) return [next];
    return [
      next,
      { id: 'gap-bridge', label: t('mapGaps.bridge'), testId: 'map-gap-bridge', onSelect: () => void bridgeIsolated(docId) },
      { id: 'gap-discover', label: t('mapGaps.discover'), testId: 'map-gap-discover', onSelect: () => goDiscover('extend', [docId]) },
    ];
  };

  // ---- Saved views ----
  const sigNow = (size?: { w: number; h: number } | null): string => {
    const c = size ?? mapCanvasEl()?.getBoundingClientRect();
    const w = c ? ('w' in c ? c.w : c.width) : 1;
    const h = c ? ('h' in c ? c.h : c.height) : 1;
    return layoutSig(p.family, p.scope, bv?.blocks.map((b) => b.id) ?? [], h > 0 ? w / h : 1);
  };
  const captureView = (): MapViewState => {
    const s = p.bridge?.read();
    const tooBig = multiIds.length > MAP_EDIT_LIMITS.selection;
    let frame: MapViewFrame;
    if (tooBig) {
      const bs = [...new Set(multiIds.map(blockIdOf).filter((b): b is string => b !== undefined))];
      frame = bs.length > 0 && bs.length <= MAP_EDIT_LIMITS.frameBlocks ? { kind: 'blocks', ids: bs } : { kind: 'fit' };
    } else if (s?.camera) frame = { kind: 'camera', ...s.camera, sig: sigNow(s.size) };
    else frame = multiIds.length > 0 ? { kind: 'docs' } : { kind: 'fit' };
    return {
      family: p.family,
      scope: p.scope,
      ...(s?.years ? { years: [...s.years] } : {}),
      filters: { ...(onlyUnread ? { onlyUnread: true } : {}), ...(gaps ? { gaps: true } : {}), kinds: s?.kinds ?? ALL_KINDS, strictness: s?.strictness ?? 'normal', edgeMode: s?.edgeMode ?? 'selected' },
      selection: tooBig ? [] : multiIds,
      ...(p.selected ? { focus: p.selected } : {}),
      frame,
    };
  };
  // Opening a view sets the filters at once; the frame waits for the blocks of the view's family (they arrive after a change of family or scope).
  const pending = useRef<{ v: MapViewState; waitFor: BlockView | null } | null>(null);
  const [tick, setTick] = useState(0);
  const applyView = (v: MapViewState): void => {
    p.onApply?.();
    setOnlyUnread(!!v.filters.onlyUnread);
    setGaps(!!v.filters.gaps);
    p.bridge?.write({ scope: v.scope, years: v.years && v.years.length === 2 ? [v.years[0]!, v.years[1]!] : null, kinds: v.filters.kinds, strictness: v.filters.strictness, edgeMode: v.filters.edgeMode });
    const moved = v.family !== p.family || JSON.stringify(v.scope ?? null) !== JSON.stringify(p.scope ?? null);
    if (v.family !== p.family) setFamily(v.family);
    pending.current = { v, waitFor: moved ? bv : null };
    setTick((n) => n + 1);
  };
  useEffect(() => {
    const pd = pending.current;
    if (!pd || !bv) return;
    if (pd.waitFor && bv === pd.waitFor) {
      const give = setTimeout(() => {
        pd.waitFor = null;
        setTick((n) => n + 1);
      }, 4000);
      return () => clearTimeout(give);
    }
    pending.current = null;
    const { v } = pd;
    const ids = v.selection.filter((id) => bv.index.has(id));
    const f = v.frame;
    const same = f.kind === 'camera' && f.sig === sigNow(p.bridge?.read().size);
    if (f.kind === 'camera' && same) p.bridge?.frame({ kind: 'camera', cx: f.cx, cy: f.cy, k: f.k });
    else if (f.kind === 'blocks' && f.ids.some((b) => bv.blocks.some((x) => x.id === b))) p.bridge?.frame({ kind: 'blocks', ids: f.ids.filter((b) => bv.blocks.some((x) => x.id === b)) });
    else if (ids.length > 0) p.bridge?.frame({ kind: 'docs', ids });
    else p.bridge?.frame({ kind: 'fit' });
    if (f.kind === 'camera' && !same) info(t('mapViews.changed'));
    p.onSelect(v.focus && bv.index.has(v.focus) ? v.focus : null);
    if (ids.length > 0) p.onSelectMany(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bv, tick]);
  // "Open on the Map" from a project: a view asked for before the Map opened.
  const [asked] = useState(() => takeMapViewIntent());
  useEffect(() => {
    if (!asked) return;
    let live = true;
    rl.invoke('mapViews:list', {}).then(
      (r) => {
        const v = r.views.find((x) => x.id === asked);
        if (live && v) applyView(v.state);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // What the dialogs and the views section read: always the latest values, whatever the render that mounted them.
  const api = useRef({ captureView, applyView });
  api.current = { captureView, applyView };
  const familyName = p.familyName ?? familyLabel(t, { id: p.family, label: p.family });
  const viewsApi = useMemo(
    () => ({
      capture: () => api.current.captureView(),
      apply: (v: MapViewState) => api.current.applyView(v),
      defaultName: () => t('mapViews.defaultName', { family: familyName, filter: t(onlyUnread ? 'mapViews.filterUnread' : gaps ? 'mapViews.filterGaps' : 'mapViews.filterAll'), date: new Date().toLocaleDateString(i18n.language) }),
      selectionTooBig: () => multiIds.length > MAP_EDIT_LIMITS.selection,
      notify: { info, fail, error: reportError },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyName, onlyUnread, gaps, multiIds.length, i18n.language],
  );
  const openViews = useCallback(() => mountOverlay((close) => <ViewsDialog api={viewsApi} onClose={close} />), [viewsApi]);
  const openExport = (format: 'png' | 'svg') => {
    const s = p.bridge?.read();
    mountOverlay((close) => (
      <ExportDialog
        format={format}
        onClose={close}
        notify={{ info, fail, error: reportError }}
        ctx={{
          bv,
          edges: filterKinds(edgeList, { cites: (s?.kinds ?? ALL_KINDS).includes('cites'), linked: (s?.kinds ?? ALL_KINDS).includes('linked'), similar: (s?.kinds ?? ALL_KINDS).includes('similar') }),
          edgeMode: s?.edgeMode ?? 'selected',
          selected: p.selected,
          multi: multiIds,
          isolated: [...isolated],
          allow,
          camera: s?.camera ?? null,
          familyName,
        }}
      />
    ));
  };
  useEffect(() => {
    if (p.active === false) return;
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 's' || editable(e.target)) return;
      if (!(document.querySelector('[data-testid="map-panel"]')?.getClientRects().length ?? 0)) return;
      e.preventDefault();
      openViews();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [p.active, openViews]);

  // ---- Rows ----
  const needBlocks = bv ? undefined : t('mapRead.needsBlocks');
  const pairRows = (
    <ul className="map-ext-pairs">
      {pairs.map((q) => {
        const a = safeText(bv!.blocks[q.a]!.label);
        const b = safeText(bv!.blocks[q.b]!.label);
        return (
          <li key={`${q.a}:${q.b}`} className="map-ext-pair" data-testid="map-gap-pair" data-a={bv!.blocks[q.a]!.id} data-b={bv!.blocks[q.b]!.id}>
            <button type="button" className="legend-item map-ext-pair-text" title={t('mapGaps.pair', { a, b })} onMouseEnter={() => setPairLit([q.a, q.b])} onMouseLeave={() => setPairLit(null)} onFocus={() => setPairLit([q.a, q.b])} onBlur={() => setPairLit(null)} onClick={() => bridgePair(q.a, q.b)}>
              <span className="legend-text">{t('mapGaps.pair', { a, b })}</span>
            </button>
            <button type="button" className="link" aria-label={t('mapGaps.pairBridge', { a, b })} onClick={() => bridgePair(q.a, q.b)} data-testid="map-gap-bridge">
              {t('mapGaps.bridge')}
            </button>
          </li>
        );
      })}
    </ul>
  );
  const readRows = (r: Rows) => (
    <>
      <Switch checked={onlyUnread} onChange={setOnlyUnread} label={t('mapRead.onlyUnread')} disabled={!bv} disabledReason={needBlocks} data-testid={r.ids.unread} />
      <Button size="sm" onClick={nextFromState} disabled={!bv} disabledReason={needBlocks} data-testid={r.ids.next}>
        {t('mapRead.next')}
      </Button>
      {r.withWhy && why && (
        <p className="hint map-ext-why" role="status" aria-live="polite" data-testid="map-next-why">
          {why}
        </p>
      )}
    </>
  );
  const gapRows = (r: Rows) => (
    <>
      <Switch checked={gaps} onChange={setGaps} label={t('mapGaps.toggle')} disabled={!bv} disabledReason={needBlocks} data-testid={r.ids.gaps} />
      {gaps && bv && (
        <>
          <p className="hint" data-testid={r.ids.count}>
            {isolatedAll.size === 0 && pairs.length === 0 ? t('mapGaps.none') : t('mapGaps.count', { i: isolatedAll.size, p: pairs.length })}
          </p>
          {pairRows}
        </>
      )}
    </>
  );
  // From 1440 px the controls sit in the side column and, in the Filters popover, under another test id (a test id is on one element at a time).
  const sideIds: Rows['ids'] = { unread: 'map-only-unread', gaps: 'map-gaps', next: 'map-next-read', count: 'map-gaps-count' };
  const popIds: Rows['ids'] = wide ? { unread: 'map-only-unread-f', gaps: 'map-gaps-f', next: 'map-next-read-f', count: 'map-gaps-count-f' } : sideIds;

  const sideSections = (
    <>
      <Section title={t('mapRead.title')} testId="map-reading">
        <ReadingLegend />
        {readRows({ ids: sideIds, withWhy: true })}
      </Section>
      <Section title={t('mapGaps.title')} testId="map-gaps-section">
        {gapRows({ ids: sideIds, withWhy: false })}
      </Section>
      <section className="map-ext" data-testid="map-views" aria-label={t('mapViews.title')}>
        <h3 className="map-ctl-title">
          <button type="button" className="map-ext-fold" aria-expanded={viewsOpen} onClick={() => setViewsOpen(!viewsOpen)} data-testid="map-views-toggle">
            <span aria-hidden="true">{viewsOpen ? '▾' : '▸'}</span> {t('mapViews.title')}
          </button>
        </h3>
        {viewsOpen && (
          <Lazy>
            <ViewsSection api={viewsApi} />
          </Lazy>
        )}
      </section>
    </>
  );
  const filterRows = (
    <>
      <div className="net-pop-sec">{t('mapRead.title')}</div>
      <div className="map-ext-rows">{readRows({ ids: popIds, withWhy: !wide })}</div>
      <div className="net-pop-sec">{t('mapGaps.title')}</div>
      <div className="map-ext-rows">{wide ? <Switch checked={gaps} onChange={setGaps} label={t('mapGaps.toggle')} disabled={!bv} disabledReason={needBlocks} data-testid={popIds.gaps} /> : gapRows({ ids: popIds, withWhy: false })}</div>
    </>
  );

  const moreItems: MenuItem[] = [
    { id: 'export-png', label: t('mapExport.png'), testId: 'map-export-png', onSelect: () => openExport('png') },
    bv
      ? { id: 'export-svg', label: t('mapExport.svg'), testId: 'map-export-svg', onSelect: () => openExport('svg') }
      : { id: 'export-svg', label: t('mapExport.svg'), testId: 'map-export-svg', disabled: true, disabledReason: t('mapExport.svgOff'), onSelect: () => undefined },
    ...(wide ? [] : [{ id: 'views', label: t('mapViews.menu'), testId: 'map-views-menu', onSelect: openViews }]),
  ];

  return { allow, st, isolated, pairLit, sideSections, filterRows, moreItems, paperItems, nextToRead, captureView, applyView };
}
