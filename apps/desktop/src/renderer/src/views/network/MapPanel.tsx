import { useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { Lazy, lazyView } from '../../components/Lazy';
import { ErrorNote } from '../../components/ui';
import { useNotify } from '../../lib/notify';
import { errorMessage } from '../../lib/errors';
import { useAiUi } from '../../lib/aiUi';
import { setDiscoverIntent } from '../../lib/discoverIntent';
import { useNav } from '../../lib/nav';
import { useLocalFlag } from '../../lib/useLocalFlag';
import type { BridgePath } from './BridgePath';
import { takeMapBridge } from './bridgeIntent';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { safeText } from '../library/safeText';
import { Segmented } from '../../components/Segmented';
import { AreaLegend, useAreaColors } from './AreaLegend';
import { setLibraryIntent } from '../../lib/libraryIntent';
import { clearShare, GroupBy, NameFamilyButton, NameFamilyDialog } from './GroupBy';
import { buildBlockView, type FamilyResponse } from './blocksDraw';
import { filterKinds, type EdgeMode, type EvEdge, type EvFilter } from './edges';
import { MapSide, MapStrip, useWide, type EvidenceControls, type SideBlock, type Strictness } from './MapSide';
import { NONE_FAMILY, useFamilies, useFamily, useFamilyRev } from './grouping';
import { areaFallback, assignAreaSlots, loadAreaMemo, saveAreaMemo } from './areaColors';
import { adjacencyOf, assignTints, type TintMemo } from './colors';
import { rng } from './playful';
import { MapCanvas, type MapHandle } from './MapCanvas';
import { clusterCircles, clusterText, prepareMap, tintGroups, type PreparedMap } from './mapModel';
import { ChipPop, copyCanvasImage, HeadMore, MapIllustration, Pill, RowPortal, useHint, ChromeCtx } from './NetChrome';
import { NodeSearch } from './NodeSearch';
import { useTimeline } from './timeline';
import type { ScopeOptions } from './useScopes';
import type { GraphStatus } from './useGraphModel';

const LabelsDialog = lazyView(() => import('./LabelsDialog').then((m) => ({ default: m.LabelsDialog })), ['network']);
const LinkFinderDialog = lazyView(() => import('../links/LinkFinderDialog').then((m) => ({ default: m.LinkFinderDialog })), ['links']);

type ScopeKind = 'all' | 'folder' | 'project' | 'tag';
type MapScope = NonNullable<RequestOf<Channels, 'graph:map'>['scope']>;

interface Props {
  active: boolean;
  status: GraphStatus;
  mapVersion: number;
  scopes: ScopeOptions;
  selected: string | null;
  onSelect(docId: string | null): void;
  onMapChanged(): void;
  onRead?(docId: string): void;
  onExplore?(): void;
  /** Double click or Enter on a paper: its neighbourhood. */
  onVicinity?(docId: string): void;
  /** "Show on the Map" from the Vocabulary: the block of the node (the ids of the node and of its ancestors, the deepest first) is lit and framed. */
  light?: { ids: string[]; nonce: number } | null;
  onBuild?(): void;
  onInfo?(i: { topics: number } | null): void;
  /** "Show on the map" from the unexpected neighbours: the same highlight as the surprise. */
  highlight?: { a: string; b: string; terms: string[]; nonce: number } | null;
}

/** The map tab: scope, level, the canvas, the legend of clusters and the labels by Claude. */
export function MapPanel({ active, status, mapVersion, scopes, selected, onSelect, onMapChanged, onRead, onExplore, onVicinity, onBuild, onInfo, highlight, light }: Props) {
  const { t } = useTranslation();
  const { openExport } = useAiUi();
  const [kind, setKind] = useState<ScopeKind>('all');
  const [value, setValue] = useState('');
  const [level, setLevel] = useState(0);
  const [rawMap, setMap] = useState<PreparedMap | null>(null);
  // Group by (D-498): the papers sit in blocks, one per value of the family; "None" is the free layout of the map.
  const [family] = useFamily();
  const freeMode = family === NONE_FAMILY;
  const map = rawMap;
  const [mapKey, setMapKey] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [findFor, setFindFor] = useState<string | null>(null);
  const handle = useRef<MapHandle>(null);
  const ticket = useRef(0);
  const memo = useRef(new Map<number, TintMemo[]>());
  const [mini, setMini] = useLocalFlag('rl.mapMini', true);
  const [yearBounds, setYearBounds] = useState<[number, number] | null>(null);
  const [years, setYears] = useState<[number, number] | null>(null);
  const [allow, setAllow] = useState<ReadonlySet<string> | null>(null);
  const [surprise, setSurprise] = useState<{ terms: string[] } | null>(null);
  const rand = useRef(rng(Date.now() & 0xffff));
  const nav = useNav();
  // "Tidy the tags" opens the guided cleanup of the vocabulary, not the Settings (D-508).
  const tidyTags = () => {
    setLibraryIntent({ cleanup: true });
    nav.navigate({ view: 'library' });
  };
  // A bridge found in Discover ("Show on the map"): drawn on the canvas until the note is closed.
  const [bridge, setBridge] = useState<BridgePath | null>(() => takeMapBridge());

  const scope = useMemo<MapScope | undefined>(() => {
    if (kind === 'all' || value === '') return undefined;
    return kind === 'folder' ? { folder: value } : kind === 'project' ? { projectId: value } : { tagId: value };
  }, [kind, value]);
  const usable = status.state === 'ready' || status.state === 'stale';

  useEffect(() => {
    if (!usable) return;
    const mine = ++ticket.current;
    setLoading(true);
    rl.invoke('graph:map', scope ? { scope } : {}).then(
      (r) => {
        if (mine !== ticket.current) return;
        setMap(prepareMap(r));
        setMapKey(JSON.stringify(scope ?? null));
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== ticket.current) return;
        setLoading(false);
        if (RlError.from(e).code === 'NOT_FOUND') setMap(null);
        else setError(e);
      },
    );
    // A new document placed incrementally (pending/documents) changes the map without a rebuild.
  }, [usable, scope, mapVersion, status.documents, status.pending, status.builtAt]);

  const [byArea, setByArea] = useAreaColors();
  const families = useFamilies(scope, usable);
  const famRev = useFamilyRev();
  const wide = useWide();
  const [stripNaming, setStripNaming] = useState(false);
  const [sideOpen, setSideOpen] = useLocalFlag('rl.map.sideOpen', true);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const aspect = useAspect(stage, !!rawMap && rawMap.n >= 3);
  const offer = families.find((f) => f.id === family);
  const [autoFor, setAutoFor] = useState<string | null>(null);
  const effective = freeMode ? null : offer?.eligible === false || autoFor === family ? 'auto' : family;
  const [fam, setFam] = useState<FamilyResponse | null>(null);
  useEffect(() => {
    if (!usable || !effective || aspect === null || !rawMap) return;
    let live = true;
    rl.invoke('graph:family', { family: effective, ...(scope ? { scope } : {}), aspect }).then(
      (r) => {
        if (!live) return;
        if (r.eligible === false && effective !== 'auto') setAutoFor(effective);
        else setFam(r);
      },
      () => live && setFam(null),
    );
    return () => {
      live = false;
    };
  }, [usable, effective, scope, aspect, !!rawMap, famRev, mapVersion, status.documents, status.pending, status.builtAt]);
  const blocksView = useMemo(() => (fam?.blocks && !freeMode ? buildBlockView(fam.items, fam.blocks) : null), [fam, freeMode]);
  const blocks = blocksView && blocksView.ids.length > 0 ? { view: blocksView } : null;
  // Evidence between papers (D-499): the threshold of the library and at most 5 edges per paper; the chips and the mode choose what is drawn.
  const [edgeMode, setEdgeMode] = useChoice<EdgeMode>('rl.map.edges', 'selected', ['selected', 'strong', 'none']);
  const [strict, setStrict] = useChoice<Strictness>('rl.map.strict', 'normal', ['strict', 'normal', 'wide']);
  const [kCites, setKCites] = useLocalFlag('rl.map.ev.cites', true);
  const [kLinked, setKLinked] = useLocalFlag('rl.map.ev.links', true);
  const [kSimilar, setKSimilar] = useLocalFlag('rl.map.ev.similar', true);
  const [evidence, setEvidence] = useState<{ tau: number; edges: EvEdge[] } | null>(null);
  useEffect(() => {
    if (!usable) return;
    let live = true;
    rl.invoke('graph:evidence', { ...(scope ? { scope } : {}), strictness: strict }).then(
      (r) => live && setEvidence(r),
      () => live && setEvidence(null),
    );
    return () => {
      live = false;
    };
  }, [usable, scope, strict, mapVersion, status.documents, status.pending, status.builtAt]);
  const kinds = useMemo<EvFilter>(() => ({ cites: kCites, linked: kLinked, similar: kSimilar }), [kCites, kLinked, kSimilar]);
  const edges = useMemo(() => filterKinds(evidence?.edges ?? [], kinds), [evidence, kinds]);
  // Colour by macro-area (D-483): with no area, one area, or colouring switched off, the topics colour the points.
  const fallback = useMemo(() => (map ? areaFallback(map.areas, map.withArea, map.n) : { use: 'topics' as const, reason: 'none' as const }), [map]);
  const areaSlots = useMemo(() => {
    if (!map || map.areas.length === 0) return null;
    const r = assignAreaSlots(map.areas, loadAreaMemo());
    saveAreaMemo(r.memo);
    return r.slots;
  }, [map]);
  const areaProp = useMemo(() => (map && byArea && fallback.use === 'areas' && areaSlots ? { defs: map.areas, slots: areaSlots } : null), [map, byArea, fallback, areaSlots]);
  const tl = useTimeline(map);
  const depth = map?.levels.length ?? 0;
  const lvl = Math.min(level, Math.max(depth - 1, 0));
  const clusters = map?.levels[lvl] ?? [];
  // Stable tints (D-379): the topics inherit the tint of the old topic they share most documents with, touching hulls differ.
  const tints = useMemo(() => {
    if (!map) return { tint: [] as number[], dashed: [] as boolean[] };
    const c = clusterCircles(map, lvl);
    const r = assignTints(tintGroups(map, lvl), adjacencyOf(c.cx, c.cy, c.r), memo.current.get(lvl) ?? null);
    memo.current.set(lvl, r.memo);
    return { tint: r.tints, dashed: r.dashed };
  }, [map, lvl]);

  // The years of the library (the filter's range) and the documents inside the chosen years.
  useEffect(() => {
    if (!usable) return;
    let live = true;
    rl.invoke('search:facets', { text: '' }).then(
      (f) => {
        const ys = f.years.map((b) => Number(b.value)).filter((y) => Number.isFinite(y));
        if (live) setYearBounds(ys.length > 1 ? [Math.min(...ys), Math.max(...ys)] : null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [usable, mapVersion, status.documents]);
  useEffect(() => {
    if (!years || !yearBounds || (years[0] <= yearBounds[0] && years[1] >= yearBounds[1])) {
      setAllow(null);
      return;
    }
    let live = true;
    rl.invoke('documents:ids', { filters: { yearFrom: years[0], yearTo: years[1] }, limit: 50_000 }).then(
      (r) => live && setAllow(new Set(r.ids)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [years, yearBounds]);

  const scopeValues = kind === 'folder' ? scopes.folders.map((f) => ({ id: f, label: f || '/' })) : kind === 'project' ? scopes.projects.map((p) => ({ id: p.id, label: p.name })) : kind === 'tag' ? scopes.tags : [];
  const chrome = useContext(ChromeCtx);
  const { info } = useNotify();
  const [hint, dismissHint] = useHint(active && !!map && map.n >= 3);
  const [topicNoteSeen, setTopicNoteSeen] = useLocalFlag('rl.map.topicNote', false);
  const [legendFor, setLegendFor] = useState<{ id: string; text: string } | null>(null);
  const legendAnchor = useRef<HTMLElement | null>(null);
  const topics = map?.levels[0]?.length ?? 0;
  useEffect(() => {
    onInfo?.(map ? { topics } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, topics]);

  const lastHighlight = useRef(0);
  useEffect(() => {
    if (!highlight || highlight.nonce === lastHighlight.current || !map) return;
    const run = setTimeout(() => {
      lastHighlight.current = highlight.nonce;
      handle.current?.surprise(highlight.a, highlight.b);
      setSurprise({ terms: highlight.terms });
    }, 80);
    return () => clearTimeout(run);
  }, [highlight, map]);

  const lastLight = useRef(0);
  useEffect(() => {
    if (!light || light.nonce === lastLight.current || !blocksView) return;
    const id = light.ids.find((x) => blocksView.blocks.some((b) => b.id === x));
    const run = setTimeout(() => {
      lastLight.current = light.nonce;
      if (id !== undefined) handle.current?.focusCluster(id);
    }, 120);
    return () => clearTimeout(run);
  }, [light, blocksView]);

  const yearsActive = !!years && !!yearBounds && (years[0] > yearBounds[0] || years[1] < yearBounds[1]);
  const filterCount = (kind !== 'all' ? 1 : 0) + (yearsActive ? 1 : 0);
  const tooFew = !!map && map.n < 3;
  const runSurprise = () => {
    rl.invoke('graph:surprising', { limit: 30 }).then(
      (r) => {
        const p = r.pairs[Math.floor(rand.current() * r.pairs.length)];
        if (!p) return setSurprise({ terms: [] });
        handle.current?.surprise(p.a, p.b);
        setSurprise({ terms: p.terms });
      },
      (e: unknown) => setError(e),
    );
  };

  // One pill at a time: the choice of a bridge, the bridge, the surprise, the filters, the cap, the first-use hint.
  const shownCount = allow && map ? [...allow].filter((id) => map.indexOf.has(id)).length : 0;
  let pill: React.ReactNode = null;
  if (map && !tooFew) {
    if (family === 'topic' && offer?.eligible === false && !topicNoteSeen) {
      pill = (
        <Pill testId="map-group-fallback" onClose={() => setTopicNoteSeen(true)}>
          {t('network.blocks.topicNote', { pct: clearShare(offer) })}{' '}
          <button type="button" className="link" onClick={tidyTags}>
            {t('network.area.tidyTags')}
          </button>
        </Pill>
      );
    } else if (bridge) {
      pill = (
        <Pill testId="map-bridge-note" onClose={() => setBridge(null)}>
          {t('network.bridge.note', { a: safeText(bridge.nodes[0].title), b: safeText(bridge.nodes[2].title) })}
        </Pill>
      );
    } else if (surprise) {
      pill = (
        <Pill
          testId="map-surprise-note"
          onClose={() => {
            handle.current?.clearSurprise();
            setSurprise(null);
          }}
        >
          {surprise.terms.length > 0 ? t('network.net.surprise', { terms: surprise.terms.slice(0, 5).map(safeText).join(', ') }) : t('network.ent.noSurprise')}
        </Pill>
      );
    } else if (tl.active) {
      pill = (
        <Pill testId="map-timeline-label">
          {t('network.timeline.label')}
          {tl.withoutYear > 0 ? ` · ${t('network.timeline.noYear')}: ${tl.withoutYear}` : ''}
        </Pill>
      );
    } else if (filterCount > 0) {
      pill = <Pill testId="map-filters-note">{allow ? t('network.mapFiltered', { from: map.n, to: shownCount }) : t('network.scope.active')}</Pill>;
    } else if (map.omitted > 0) {
      pill = <Pill testId="map-omitted">{t('network.mapOmitted', { count: map.omitted, shown: map.n })}</Pill>;
    } else if (hint) {
      pill = <Pill testId="map-hint">{t('network.blocks.hint')}</Pill>;
    } else if (byArea && fallback.use === 'topics') {
      pill = (
        <Pill testId="map-color-note">
          {t(fallback.reason === 'single' ? 'network.area.areaSingle' : 'network.area.areaNoTags')}
          {fallback.reason !== 'single' && (
            <button type="button" className="link" onClick={() => nav.navigate({ view: 'settings' })}>
              {t('network.area.manageTags')}
            </button>
          )}
        </Pill>
      );
    } else if (areaProp && fallback.sparse !== undefined) {
      pill = (
        <Pill testId="map-color-note">
          {t('network.area.areaSparse', { count: fallback.sparse })}
          <button type="button" className="link" onClick={() => setByArea(false)}>
            {t('network.area.areaByTopic')}
          </button>
        </Pill>
      );
    }
  }

  const levels = map?.levels ?? [];
  const legend =
    map && !tooFew && areaProp ? (
      <AreaLegend defs={areaProp.defs} slots={areaProp.slots} without={map.n - map.withArea} onLight={(a) => handle.current?.lightArea(a)} onIsolate={(a) => handle.current?.isolateArea(a)} />
    ) : map && !tooFew ? (
      <ul className="legend" data-testid="cluster-legend" aria-label={t('network.legend')}>
        {clusters.slice(0, 8).map((c, i) => {
          const txt = clusterText(c);
          const name = safeText(txt.text || c.id);
          return (
            <li key={c.id}>
              <button type="button" className="legend-item" title={name} onClick={() => handle.current?.focusCluster(c.id)} onMouseEnter={() => handle.current?.light(c.id)} onMouseLeave={() => handle.current?.light(null)} onFocus={() => handle.current?.light(c.id)} onBlur={() => handle.current?.light(null)} data-testid="cluster-item" data-cluster={c.id} data-ai={txt.ai ? 'true' : 'false'}>
                <span className="rl-swatch" style={{ background: `var(--cat-${(tints.tint[i] ?? 0) + 1})` }} aria-hidden="true" />
                <span className="legend-text">{name}</span>
                {txt.ai && <span className="ai-badge">{t('ai.badge')}</span>}
                <span className="hint">{c.size}</span>
              </button>
              <button
                type="button"
                className="link legend-export"
                aria-haspopup="menu"
                aria-label={t('secondBrain.clusterAria', { name })}
                title={t('network.more')}
                onClick={(e) => {
                  legendAnchor.current = e.currentTarget;
                  setLegendFor({ id: c.id, text: txt.text || c.id });
                }}
                data-testid="cluster-more"
              >
                <span aria-hidden="true">⋯</span>
              </button>
            </li>
          );
        })}
        {clusters.length > 8 && <li className="hint legend-more">{t('network.moreClusters', { count: clusters.length - 8 })}</li>}
      </ul>
    ) : null;

  const sideBlocks: SideBlock[] = !freeMode && blocks ? blocks.view.blocks.map((b) => ({ id: b.id, label: b.label, count: b.count, tint: b.tint })) : [];
  const shown = !freeMode && blocks ? blocks.view.ids.length : (map?.n ?? 0);
  const controls: EvidenceControls = { mode: edgeMode, setMode: setEdgeMode, kinds, setKind: (k, on) => (k === 'cites' ? setKCites(on) : k === 'linked' ? setKLinked(on) : setKSimilar(on)), strict, setStrict, tau: evidence?.tau ?? null };
  const noMapReason = t('network.noMapTitle');
  return (
    <div className="net-tab map-tab" data-testid="map-panel">
      {stripNaming && !wide && <NameFamilyDialog scope={scope} onClose={() => setStripNaming(false)} />}
      <RowPortal active={active}>
        <GroupBy families={families} scope={scope} withNone nameInBar={wide} />
        <NodeSearch
          testId="map-search"
          label={t('network.search.go')}
          placeholder={t('network.search.goDoc')}
          suggest={async (q) => (await rl.invoke('search:query', { text: q, limit: 8 })).hits.filter((h) => map?.indexOf.has(h.docId)).map((h) => ({ id: h.docId, label: h.title ?? t('network.untitled'), hint: h.year ? String(h.year) : undefined }))}
          onPick={(it) => {
            handle.current?.flyToDoc(it.id);
            onSelect(it.id);
          }}
        />
        <ChipPop label={t('network.filters')} testId="map-filters" count={filterCount} width={340}>
          <div className="net-pop-body">
            <label className="net-field net-pop-row">
              <span>{t('network.scope.label')}</span>
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ScopeKind);
                  setValue('');
                }}
                data-testid="map-scope-kind"
              >
                <option value="all">{t('network.scope.all')}</option>
                <option value="folder">{t('network.scope.folder')}</option>
                <option value="project">{t('network.scope.project')}</option>
                <option value="tag">{t('network.scope.tag')}</option>
              </select>
            </label>
            {kind !== 'all' && (
              <label className="net-field net-pop-row">
                <span className="visually-hidden">{t(`network.scope.${kind}`)}</span>
                <select value={value} onChange={(e) => setValue(e.target.value)} data-testid="map-scope-value">
                  <option value="">{t('network.scope.pick')}</option>
                  {scopeValues.map((o) => (
                    <option key={o.id} value={o.id}>
                      {safeText(o.label)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {yearBounds && (
              <div className="net-field net-pop-row ent-years" data-testid="map-years">
                <span>{t('network.ent.years')}</span>
                <input type="range" aria-label={t('network.ent.yearFrom')} min={yearBounds[0]} max={yearBounds[1]} value={years?.[0] ?? yearBounds[0]} onChange={(e) => setYears([Math.min(Number(e.target.value), years?.[1] ?? yearBounds[1]), years?.[1] ?? yearBounds[1]])} data-testid="map-year-from" />
                <input type="range" aria-label={t('network.ent.yearTo')} min={yearBounds[0]} max={yearBounds[1]} value={years?.[1] ?? yearBounds[1]} onChange={(e) => setYears([years?.[0] ?? yearBounds[0], Math.max(Number(e.target.value), years?.[0] ?? yearBounds[0])])} data-testid="map-year-to" />
                <span className="hint">
                  {years?.[0] ?? yearBounds[0]}–{years?.[1] ?? yearBounds[1]}
                </span>
              </div>
            )}
            <div className="net-pop-sec">{t('network.look')}</div>
            <div className="net-field net-pop-row">
              <span>{t('network.area.colorMode')}</span>
              <Segmented<'areas' | 'topics'>
                size="sm"
                label={t('network.area.colorMode')}
                value={areaProp ? 'areas' : 'topics'}
                onChange={(v) => setByArea(v === 'areas')}
                options={[
                  { value: 'areas', label: t('network.area.colorAreas'), testId: 'map-color-areas', disabled: fallback.use === 'topics', disabledReason: t(fallback.reason === 'single' ? 'network.area.areaSingle' : 'network.area.areaNoTags') },
                  { value: 'topics', label: t('network.area.colorTopics'), testId: 'map-color-topics' },
                ]}
              />
            </div>
            <label className="net-field net-pop-row">
              <span>{t('network.colorBy')}</span>
              <select value={lvl} onChange={(e) => setLevel(Number(e.target.value))} disabled={depth === 0} data-testid="map-level">
                {Array.from({ length: depth }, (_, l) => (
                  <option key={l} value={l}>
                    {t('network.level', { level: l + 1 })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ChipPop>
        <span className="map-actions">
          <button type="button" className="icon-button" title={t('network.play.shuffle')} aria-label={t('network.play.shuffle')} onClick={() => handle.current?.shuffle()} disabled={!map || tooFew} data-testid="map-shuffle">
            ✧
          </button>
          <button type="button" className="icon-button" title={t('network.play.surprise')} aria-label={t('network.play.surprise')} disabled={!map || tooFew} data-testid="map-surprise" onClick={runSurprise}>
            ✦
          </button>
          <button type="button" className="icon-button" title={t('network.fit')} aria-label={t('network.fit')} onClick={() => handle.current?.fit()} disabled={!map || tooFew} data-testid="map-fit">
            ⤢
          </button>
        </span>
      </RowPortal>
      <HeadMore
        active={active}
        testId="map-more"
        groups={[
          chrome.model,
          {
            id: 'view',
            items: [
              map ? { id: 'timeline', label: t('network.timeline.byYear'), icon: <span>{tl.active ? '☑' : '☐'}</span>, testId: 'map-timeline-toggle', onSelect: tl.toggle } : { id: 'timeline', label: t('network.timeline.byYear'), testId: 'map-timeline-toggle', onSelect: () => undefined, disabled: true, disabledReason: noMapReason },
              { id: 'minimap', label: t('network.minimap'), icon: <span>{mini ? '☑' : '☐'}</span>, testId: 'map-minimap-toggle', onSelect: () => setMini(!mini) },
            ],
          },
          {
            id: 'out',
            items: [
              {
                id: 'image',
                label: t('network.copyImage'),
                testId: 'map-image',
                onSelect: () => void copyCanvasImage(handle.current?.canvas() ?? null).then((ok) => info(ok ? t('network.imageCopied') : t('network.imageFailed'))),
              },
              map && depth > 0 ? { id: 'labels', label: `✦ ${t('network.labels.open')}`, testId: 'map-label-clusters', onSelect: () => setLabelsOpen(true) } : { id: 'labels', label: `✦ ${t('network.labels.open')}`, testId: 'map-label-clusters', onSelect: () => undefined, disabled: true, disabledReason: noMapReason },
            ],
          },
        ]}
      />
      <span className="visually-hidden" data-testid="map-info" data-seed={map?.seed ?? ''} data-shown={allow ? allow.size : (map?.n ?? 0)} />
      {error ? <ErrorNote testId="map-error">{errorMessage(error, t)}</ErrorNote> : null}
      {!map && !loading && !error && (
        <EmptyState icon={<MapIllustration />} title={t('network.noMapTitle')} action={onBuild ? <button type="button" className="primary" onClick={onBuild} data-testid="map-empty-build">{t('network.build')}</button> : undefined}>
          <span data-testid="map-empty">{t('network.noMap')}</span>
        </EmptyState>
      )}
      {map && map.n === 0 && kind !== 'all' && (
        <EmptyState
          icon={<MapIllustration />}
          title={t('network.noPointsTitle')}
          action={
            <button
              type="button"
              onClick={() => {
                setKind('all');
                setValue('');
              }}
              data-testid="map-clear-scope"
            >
              {t('network.clearScope')}
            </button>
          }
        >
          <span data-testid="map-no-points">{t('network.noPoints')}</span>
        </EmptyState>
      )}
      {map && tooFew && !(map.n === 0 && kind !== 'all') && (
        <EmptyState icon={<MapIllustration />} title={t('network.fewTitle')} action={<button type="button" className="primary" onClick={() => nav.navigate({ view: 'library' })} data-testid="map-few-add">{t('network.addPdf')}</button>}>
          <span data-testid="map-few">{t('network.fewDocs')}</span>
        </EmptyState>
      )}
      {map && !tooFew && (
        <div className={wide ? 'map-body has-side' : 'map-body'}>
          <div className="map-stage" ref={stage}>
            {!wide && <MapStrip blocks={sideBlocks} legend={legend} controls={controls} count={shown} extra={family === 'auto' ? <NameFamilyButton onClick={() => setStripNaming(true)} /> : undefined} onLight={(id) => handle.current?.light(id)} onFly={(id) => handle.current?.focusCluster(id)} />}
            {pill && <div className="map-notes">{pill}</div>}
            {!freeMode && !blocks && !fam ? (
              <div className="map-wrap map-loading" role="status" data-testid="map-blocks-loading">
                {t('network.blocks.loading')}
              </div>
            ) : (
              <MapCanvas
                map={tl.map ?? map}
                level={lvl}
                selected={selected}
                onSelect={(id) => {
                  dismissHint();
                  onSelect(id);
                }}
                onRead={onRead}
                onExplore={onExplore}
                onVicinity={onVicinity}
                tints={tints}
                areas={areaProp}
                allow={tl.only ?? allow}
                minimap={mini}
                minimapSlot={wide && sideOpen ? slot : null}
                blocks={freeMode ? null : blocks}
                evidence={edges}
                edgeMode={edgeMode}
                bridge={bridge}
                onFindLinks={setFindFor}
                onTopicExport={(id, text) => openExport({ clusters: [{ id, label: text }], name: text })}
                onBridge={(a, b) => {
                  setDiscoverIntent({ kind: 'bridge', docIds: [a, b] });
                  nav.navigate({ view: 'discover' });
                }}
                aiBadge={t('ai.badge')}
                label={t('network.mapLabel')}
                fitKey={mapKey}
                handle={handle}
              />
            )}
          </div>
          {wide && <MapSide open={sideOpen} onToggle={() => setSideOpen(!sideOpen)} minimapRef={setSlot} blocks={sideBlocks} legend={legend} controls={controls} count={shown} onLight={(id) => handle.current?.light(id)} onFly={(id) => handle.current?.focusCluster(id)} />}
        </div>
      )}
      <Menu
        anchor={legendAnchor}
        open={legendFor !== null}
        label={t('network.more')}
        onClose={() => setLegendFor(null)}
        groups={[{ id: 'cluster', items: [{ id: 'export', testId: 'cluster-export', label: t('secondBrain.clusterButton'), onSelect: () => legendFor && openExport({ clusters: [{ id: legendFor.id, label: legendFor.text }], name: legendFor.text }) }] }]}
      />
      {findFor && (
        <Lazy>
          <LinkFinderDialog docIds={[findFor]} onClose={() => setFindFor(null)} />
        </Lazy>
      )}
      {labelsOpen && map && (
        <Lazy>
          <LabelsDialog
            levels={levels}
            level={lvl}
            onClose={() => setLabelsOpen(false)}
            onDone={() => {
              onMapChanged();
            }}
          />
        </Lazy>
      )}
    </div>
  );
}

/** A string choice kept in localStorage as a per-viewer convenience (an unknown stored value falls back to the default). */
function useChoice<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key) as T | null;
      return raw && allowed.includes(raw) ? raw : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* storage unavailable: the choice lives until the next load */
    }
  };
  return [value, set];
}

/** Width over height of the canvas column for the blocks: measured at once, then again 300 ms after the last resize when it changed by more than 15 %. */
function useAspect(el: RefObject<HTMLElement | null>, on: boolean): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || !on) return;
    let timer = 0;
    let last = 0;
    const read = () => {
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const q = r.width / r.height;
      if (last === 0 || Math.abs(q - last) / last > 0.15) {
        last = q;
        setAspect(Math.round(q * 100) / 100);
      }
    };
    const ro = new ResizeObserver(() => {
      if (last === 0) read();
      else {
        clearTimeout(timer);
        timer = window.setTimeout(read, 300);
      }
    });
    ro.observe(node);
    read();
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [el, on]);
  return aspect;
}
