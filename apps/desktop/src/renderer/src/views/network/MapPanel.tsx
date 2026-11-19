import { useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  onBuild?(): void;
  onInfo?(i: { topics: number } | null): void;
}

/** The map tab: scope, level, the canvas, the legend of clusters and the labels by Claude. */
export function MapPanel({ active, status, mapVersion, scopes, selected, onSelect, onMapChanged, onRead, onExplore, onBuild, onInfo }: Props) {
  const { t } = useTranslation();
  const { openExport } = useAiUi();
  const [kind, setKind] = useState<ScopeKind>('all');
  const [value, setValue] = useState('');
  const [level, setLevel] = useState(0);
  const [map, setMap] = useState<PreparedMap | null>(null);
  const [mapKey, setMapKey] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
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
  const [legendFor, setLegendFor] = useState<{ id: string; text: string } | null>(null);
  const legendAnchor = useRef<HTMLElement | null>(null);
  const topics = map?.levels[0]?.length ?? 0;
  useEffect(() => {
    onInfo?.(map ? { topics } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, topics]);

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
    if (bridge) {
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
      pill = <Pill testId="map-hint">{t('network.hint')}</Pill>;
    }
  }

  const levels = map?.levels ?? [];
  const legend =
    map && !tooFew ? (
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

  const noMapReason = t('network.noMapTitle');
  return (
    <div className="net-tab map-tab" data-testid="map-panel">
      <RowPortal active={active}>
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
        <div className="map-body">
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
            tints={tints}
            allow={tl.only ?? allow}
            minimap={mini}
            bridge={bridge}
            onBridge={(a, b) => {
              setDiscoverIntent({ kind: 'bridge', docIds: [a, b] });
              nav.navigate({ view: 'discover' });
            }}
            aiBadge={t('ai.badge')}
            label={t('network.mapLabel')}
            fitKey={mapKey}
            handle={handle}
            overlay={
              <>
                {pill}
                {legend}
              </>
            }
          />
        </div>
      )}
      <Menu
        anchor={legendAnchor}
        open={legendFor !== null}
        label={t('network.more')}
        onClose={() => setLegendFor(null)}
        groups={[{ id: 'cluster', items: [{ id: 'export', testId: 'cluster-export', label: t('secondBrain.clusterButton'), onSelect: () => legendFor && openExport({ clusters: [{ id: legendFor.id, label: legendFor.text }], name: legendFor.text }) }] }]}
      />
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
