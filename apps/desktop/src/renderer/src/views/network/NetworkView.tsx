import { useEffect, useRef, useState } from 'react';
import type { Channels, RequestOf } from '@rl/core';
import { GRAPH_LIMITS } from '@rl/core';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { Lazy, lazyView } from '../../components/Lazy';
import { Menu, type MenuGroup } from '../../components/Menu';
import { ErrorNote, ProgressBar } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { takeMapStart } from '../../lib/mapStartIntent';
import { useNav } from '../../lib/nav';
import { canRead, useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { useDocTitle } from '../chat/useLabels';
import { safeText } from '../library/safeText';
import { EntityDetail } from './EntityDetail';
import type { EmptyKind } from './EntityNet';
import type { EntityMode, EntityNetwork, EntityNode } from './entityTypes';
import { Explore } from './Explore';
import type { NetStart } from './GraphNet';
import { LinksPanel } from './LinksPanel';
import { MapPanel } from './MapPanel';
import { canBack, canForward, crumbs as crumbsOf, currentNav, emptyNav, pushNav, stepBack, stepForward, type NavStack, type NavState } from './navStack';
import { ChromeCtx, HeadMore, MapIllustration } from './NetChrome';
import { PathChain, type Strictness } from './PathChain';
import { useFamily } from './grouping';
import { setDiscoverIntent } from '../../lib/discoverIntent';
import { SimilarPanel, SurprisingList } from './SimilarPanel';
import { useGraphModel, type Phase } from './useGraphModel';
import { useScopeOptions } from './useScopes';
import './palette.css';
import './network.css';
import './vicinity.css';

const ModelOptions = lazyView(() => import('./ModelOptions').then((m) => ({ default: m.ModelOptions })), ['network']);
const TABS = ['map', 'network', 'explore', 'surprising'] as const;
type Tab = (typeof TABS)[number];
const PHASES: Phase[] = ['vectors', 'similarity', 'clusters', 'layout'];

/** What the neighbourhood gives the panel of the selected paper: "Find a bridge" and "Find links". */
export interface NetCtl {
  bridge(): void;
  links(): void;
}

function DocDetail({ docId, onClose, onNetwork, onPathStart, tagLabel, onOpenDoc, ctl }: { docId: string; onClose(): void; onNetwork(): void; onPathStart(): void; tagLabel(id: string): string; onOpenDoc(docId: string): void; ctl: NetCtl | null }) {
  const { t } = useTranslation();
  const title = useDocTitle(docId);
  const { openReader } = useReader();
  const [readable, setReadable] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    setReadable(false);
    rl.invoke('documents:get', { docId }).then(
      (d) => live && setReadable(canRead(d.path, false)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [docId]);
  return (
    <aside className="net-detail" aria-label={t('network.detail')} data-testid="net-detail" data-doc-id={docId}>
      <header>
        <h2 data-testid="net-detail-title">{safeText(title ?? t('network.untitled'))}</h2>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose} data-testid="net-detail-close">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="net-toolbar">
        {readable && (
          <button type="button" onClick={() => openReader(docId)} data-testid="net-open-reader">
            {t('network.openReader')}
          </button>
        )}
        <button type="button" onClick={onNetwork} data-testid="vic-focus">
          {t('vicinity.focus')}
        </button>
        <button ref={more} type="button" className="icon-button" aria-haspopup="menu" aria-label={t('network.more')} title={t('network.more')} onClick={() => setMenu((m) => !m)} data-testid="net-detail-more">
          <span aria-hidden="true">⋯</span>
        </button>
        <Menu
          anchor={more}
          open={menu}
          onClose={() => setMenu(false)}
          label={t('network.more')}
          groups={[
            {
              id: 'node',
              items: [
                { id: 'path', label: t('vicinity.path.start'), testId: 'path-start', onSelect: onPathStart },
                ...(ctl
                  ? [
                      { id: 'bridge', label: t('network.bridge.findWith'), testId: 'net-bridge', onSelect: ctl.bridge },
                      { id: 'links', label: t('network.edge.findLinks'), testId: 'net-links-find', onSelect: ctl.links },
                    ]
                  : []),
              ],
            },
          ]}
        />
      </div>
      <h3>{t('network.similar.title')}</h3>
      <SimilarPanel docId={docId} tagLabel={tagLabel} onOpen={onOpenDoc} />
    </aside>
  );
}

/**
 * Network section: the model status and build, the 2D map with clusters, the expandable network, the zoomable
 * exploration and the "close but do not look it" pairs. A tab that was opened stays mounted (hidden), so its context
 * (view, selection, level) is still there when the user comes back.
 */
export function NetworkView() {
  const { t, i18n } = useTranslation();
  const model = useGraphModel();
  const scopes = useScopeOptions();
  const [tab, setTab] = useState<Tab>('map');
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['map']));
  const [doc, setDocState] = useState<string | null>(null);
  const [entity, setEntity] = useState<{ node: EntityNode; mode: EntityMode } | null>(null);
  const [entityData, setEntityData] = useState<EntityNetwork | null>(null);
  const [dimRequest, setDimRequest] = useState<{ dim: 'topic' | 'author'; nonce: number } | undefined>(undefined);
  const nav = useNav();
  const { openReader } = useReader();
  const [start, setStart] = useState<NetStart | null>(null);
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mapInfo, setMapInfo] = useState<{ topics: number } | null>(null);
  const [ctl, setCtl] = useState<NetCtl | null>(null);
  const [panorama, setPanorama] = useState<{ a: string; b: string; terms: string[]; nonce: number } | null>(null);
  const [lightNode, setLightNode] = useState<{ ids: string[]; nonce: number } | null>(null);
  const docTitle = useDocTitle(doc);
  const { status, building } = model;
  // Path between two papers (section 19.2.5): started from the panel ("Path to...") or by Shift+click; the second paper chosen ends it.
  const [path, setPath] = useState<{ a: string; b: string } | null>(null);
  const [strictness, setStrictness] = useState<Strictness>('normal');
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [family, setFamily] = useFamily();
  // The Back / Forward stack common to the Map and the Neighbourhood (50 states).
  const [navStack, setNavStack] = useState<NavStack>(emptyNav);
  const restored = useRef<NavState | null>(null);

  const startPath = (a: string, b: string) => {
    setPathFrom(null);
    setPath({ a, b });
    show('network');
  };
  /** A document and an entity are never both in the side panel. A paper chosen after "Path to..." ends the path there. */
  const setDoc = (id: string | null) => {
    setDocState(id);
    if (id) setEntity(null);
    if (id && pathFrom && id !== pathFrom) startPath(pathFrom, id);
  };
  const mapReady = status !== null && (status.state === 'ready' || status.state === 'stale');
  const noModel = status !== null && status.state === 'none' && !building;
  const readDoc = (id: string) => {
    rl.invoke('documents:get', { docId: id }).then(
      (d) => canRead(d.path, false) && openReader(id),
      () => undefined,
    );
  };
  const exploreDim = (dim: 'topic' | 'author') => {
    setDimRequest((cur) => ({ dim, nonce: (cur?.nonce ?? 0) + 1 }));
    show('explore');
  };
  const onEmpty = (kind: EmptyKind) => {
    if (kind === 'build') void model.build();
    else nav.navigate({ view: kind === 'review' ? 'review' : 'library' });
  };

  const show = (next: Tab) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  };
  const startNet = (s: Omit<NetStart, 'nonce'>) => {
    setStart((cur) => ({ ...s, nonce: (cur?.nonce ?? 0) + 1 }));
    show('network');
  };
  /** A paper of the neighbourhood (or a crumb) becomes the centre. */
  const centerOn = (id: string, label: string) => {
    startNet({ kind: 'doc', id, label });
    setDocState(id);
    setEntity(null);
  };

  const navState: NavState = { tab, family, doc, center: start?.id ?? null, path: path ? [path.a, path.b] : null };
  useEffect(() => {
    const r = restored.current;
    restored.current = null;
    if (r && r.tab === navState.tab && r.family === navState.family && r.doc === navState.doc && r.path?.[0] === navState.path?.[0] && r.path?.[1] === navState.path?.[1] && (r.center === null || r.center === navState.center)) return;
    setNavStack((cur) => pushNav(cur, navState));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, family, doc, start?.id, path?.a, path?.b]);
  /** Goes to the state the stack points at: the tab, the family, the selection, the centre and the path come back together. */
  const goTo = (next: NavStack) => {
    const st = currentNav(next);
    if (!st) return;
    restored.current = st;
    setNavStack(next);
    show(st.tab);
    setDocState(st.doc);
    if (st.doc) setEntity(null);
    if (st.family !== family) setFamily(st.family);
    setPath(st.path ? { a: st.path[0], b: st.path[1] } : null);
    setPathFrom(null);
    if (st.center !== null && st.center !== start?.id) setStart((cur) => ({ kind: 'doc', id: st.center!, label: '', nonce: (cur?.nonce ?? 0) + 1 }));
  };
  const goBack = () => canBack(navStack) && goTo(stepBack(navStack));
  const goForward = () => canForward(navStack) && goTo(stepForward(navStack));
  const navAct = useRef({ goBack, goForward, can: [false, false] });
  navAct.current = { goBack, goForward, can: [canBack(navStack), canForward(navStack)] };
  // Alt+Left / Alt+Right and the side buttons of the mouse; when there is nothing to go back to the application's own Back gets them.
  useEffect(() => {
    const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
    const act = (dir: -1 | 1, e: Event): void => {
      const a = navAct.current;
      if (!a.can[dir < 0 ? 0 : 1]) return;
      e.preventDefault();
      e.stopPropagation();
      if (dir < 0) a.goBack();
      else a.goForward();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || editable(e.target)) return;
      if (e.key === 'ArrowLeft') act(-1, e);
      else if (e.key === 'ArrowRight') act(1, e);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) act(-1, e);
      else if (e.button === 4) act(1, e);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse, true);
    };
  }, []);
  // "Show on the Map" from the link finder of the Library: start the network from that document.
  useEffect(() => {
    const m = takeMapStart();
    if (m) startNet({ kind: 'doc', id: m.docId, label: m.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bridgeOf = (a: string, b: string) => {
    setDiscoverIntent({ kind: 'bridge', docIds: [a, b] });
    nav.navigate({ view: 'discover' });
  };
  const phase = building?.phase ?? null;

  const when = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  let subtitle = '';
  if (status && !building) {
    if (status.state === 'none') subtitle = t('network.head.none');
    else if (status.state === 'stale') subtitle = status.pending > 0 ? t('network.head.stale', { count: status.pending }) + (status.removed > 0 ? ` · ${t('network.status.alsoRemoved', { count: status.removed })}` : '') : t('network.head.removed', { count: status.removed });
    else {
      subtitle = t('network.head.documents', { count: status.documents });
      if (mapInfo && mapInfo.topics > 0) subtitle += ` · ${t('network.head.topics', { count: mapInfo.topics })}`;
      if (status.builtAt) subtitle += ` · ${t('network.head.updated', { date: when(status.builtAt) })}`;
    }
  }
  const modelGroup: MenuGroup = {
    id: 'model',
    items: [
      { id: 'options', label: t('network.options.open'), testId: 'map-options', onSelect: () => setOptionsOpen(true) },
      building || status === null
        ? { id: 'rebuild', label: t('network.rebuildMap'), testId: 'map-rebuild', onSelect: () => undefined, disabled: true, disabledReason: t('network.rebuildBusy') }
        : { id: 'rebuild', label: t('network.rebuildMap'), testId: 'map-rebuild', onSelect: () => void model.build() },
    ],
  };
  const tabKeys = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length]!;
    show(next);
    document.getElementById(`net-tab-${next}`)?.focus();
  };

  return (
    <ChromeCtx.Provider value={{ head, row, model: modelGroup }}>
      <div className="network-page" data-testid="section-network">
        <HeadMore active={noModel} testId="map-more" groups={[modelGroup]} />
        <header className="net-head">
          <h1>{t('sections.network')}</h1>
          <div className="net-status" data-testid="graph-status" data-state={status?.state ?? 'unknown'} data-pending={status?.pending ?? 0} aria-live="polite">
            {status && !building && subtitle !== '' && (
              <span data-testid="graph-status-text" title={status.builtAt ?? undefined}>
                {subtitle}
              </span>
            )}
            {building && (
              <span className="net-progress" data-testid="graph-progress" data-phase={phase ?? ''} data-done={building.done} data-total={building.total}>
                <span>{phase ? t(`network.phase.${phase}`) : t('network.building')}</span>
                <ProgressBar value={building.done} max={building.total > 0 ? building.total : undefined} label={t('network.building')} />
                {PHASES.map((p) => (
                  <span key={p} className={p === phase ? 'phase on' : 'phase'} aria-hidden="true" />
                ))}
              </span>
            )}
          </div>
          <div className="net-build">
            {!building && status?.state === 'stale' && (
              <button type="button" className="primary" onClick={() => void model.build()} data-testid="graph-build">
                {t('network.updateMap')}
              </button>
            )}
            {building && (
              <button type="button" onClick={() => void model.cancel()} disabled={building.jobId === null} data-testid="graph-cancel">
                {t('common.cancel')}
              </button>
            )}
            <span className="net-head-slot" ref={setHead} />
          </div>
        </header>
        {model.error ? <ErrorNote testId="graph-error">{errorMessage(model.error, t)}</ErrorNote> : null}
        {model.failed && <ErrorNote testId="graph-failed">{t(model.failReason ? `network.buildFailed_${model.failReason}` : 'network.buildFailed', { limit: GRAPH_LIMITS.buildDocuments.toLocaleString(i18n.language) })}</ErrorNote>}
        {model.trimmed > 0 && !building && (
          <p className="note" role="status" data-testid="graph-trimmed">
            {t('network.citationsTrimmed', { count: model.trimmed, max: GRAPH_LIMITS.citationKeys })}
          </p>
        )}
        <div className="net-row">
          <span className="vic-nav" role="group" aria-label={t('vicinity.history')}>
            <button type="button" className="icon-button" onClick={goBack} disabled={!canBack(navStack)} title={t('vicinity.back')} aria-label={t('vicinity.back')} data-testid="map-back">
              <span aria-hidden="true">←</span>
            </button>
            <button type="button" className="icon-button" onClick={goForward} disabled={!canForward(navStack)} title={t('vicinity.forward')} aria-label={t('vicinity.forward')} data-testid="map-forward">
              <span aria-hidden="true">→</span>
            </button>
          </span>
          <div role="tablist" aria-label={t('network.tabs')} className="rl-seg rl-seg--md net-tabs">
            {TABS.map((id, i) => (
              <button key={id} type="button" role="tab" id={`net-tab-${id}`} aria-selected={tab === id} aria-controls={`net-panel-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'rl-seg__opt is-on' : 'rl-seg__opt'} onClick={() => show(id)} onKeyDown={(e) => tabKeys(e, i)} data-testid={`net-tab-${id}`}>
                {id === 'network' ? t('vicinity.tab') : t(`network.tab.${id}`)}
              </button>
            ))}
          </div>
          {!noModel && <div className="net-row-slot" ref={setRow} />}
        </div>
        <div className="net-main">
          {noModel ? (
            <div className="net-panels" data-testid="graph-empty">
              <EmptyState icon={<MapIllustration />} title={t('network.noModel.title')} action={<button type="button" className="primary" onClick={() => void model.build()} data-testid="graph-build-empty">{t('network.build')}</button>}>
                {t('network.noModel.text')}
              </EmptyState>
            </div>
          ) : (
            <div className="net-panels">
              {visited.has('map') && (
                <div role="tabpanel" id="net-panel-map" aria-labelledby="net-tab-map" hidden={tab !== 'map'} className="net-panel">
                  {status ? <MapPanel active={tab === 'map'} status={status} mapVersion={model.mapVersion} scopes={scopes} selected={doc} onSelect={setDoc} onMapChanged={model.bumpMap} onRead={readDoc} onExplore={() => exploreDim('topic')} onVicinity={(id) => centerOn(id, t('network.untitled'))} light={lightNode} onBuild={() => void model.build()} onInfo={setMapInfo} highlight={panorama} /> : null}
                </div>
              )}
              {visited.has('network') && (
                <div role="tabpanel" id="net-panel-network" aria-labelledby="net-tab-network" hidden={tab !== 'network'} className="net-panel">
                  {path && <PathChain a={path.a} b={path.b} strictness={strictness} onStrictness={setStrictness} onOpenDoc={setDoc} onBridge={bridgeOf} onClose={() => setPath(null)} />}
                  {pathFrom && (
                    <p className="map-pill vic-pick" role="status" data-testid="path-pick">
                      {t('vicinity.path.pick')}
                      <button type="button" className="link" onClick={() => setPathFrom(null)}>
                        {t('common.cancel')}
                      </button>
                    </p>
                  )}
                  <LinksPanel
                    active={tab === 'network'}
                    start={start}
                    selectedDoc={doc}
                    selectedDocLabel={docTitle}
                    onSelectDoc={setDoc}
                    onStart={startNet}
                    onExplore={exploreDim}
                    onCtl={setCtl}
                    crumbs={crumbsOf(navStack)}
                    onCenter={centerOn}
                    onPath={startPath}
                  />
                </div>
              )}
              {visited.has('explore') && (
                <div role="tabpanel" id="net-panel-explore" aria-labelledby="net-tab-explore" hidden={tab !== 'explore'} className="net-panel">
                  <Explore
                    active={tab === 'explore'}
                    selectedDoc={doc}
                    onOpenDoc={setDoc}
                    dimRequest={dimRequest}
                    onBuild={() => void model.build()}
                    onAddData={() => nav.navigate({ view: 'review' })}
                    onTags={() => nav.navigate({ view: 'library' })}
                    scopes={scopes}
                    selectedEntityId={entity?.node.id ?? null}
                    onSelectEntity={(node, mode) => {
                      setEntity(node ? { node, mode } : null);
                      if (node) setDocState(null);
                    }}
                    onData={setEntityData}
                    onEmpty={onEmpty}
                    mapVersion={model.mapVersion}
                    mapReady={mapReady}
                    onShowInMap={(famId, ids) => {
                      setFamily(famId);
                      setLightNode((cur) => ({ ids, nonce: (cur?.nonce ?? 0) + 1 }));
                      show('map');
                    }}
                  />
                </div>
              )}
              {visited.has('surprising') && (
                <div role="tabpanel" id="net-panel-surprising" aria-labelledby="net-tab-surprising" hidden={tab !== 'surprising'} className="net-panel">
                  <SurprisingList active={tab === 'surprising'} onOpen={setDoc} onShow={(a, b, terms) => {
                    setPanorama({ a, b, terms, nonce: Date.now() });
                    show('map');
                  }} onBack={() => show('map')} />
                </div>
              )}
            </div>
          )}
          {entity && !noModel && <EntityDetail key={entity.node.id} mode={entity.mode} entity={entity.node} peers={entityData?.nodes ?? []} yearRange={entityData?.yearRange} onClose={() => setEntity(null)} onOpenDoc={setDoc} />}
          {doc && !noModel && <DocDetail key={doc} docId={doc} ctl={tab === 'network' ? ctl : null} onClose={() => setDoc(null)} onNetwork={() => centerOn(doc, docTitle ?? t('network.untitled'))} onPathStart={() => setPathFrom(doc)} tagLabel={scopes.tagLabel} onOpenDoc={setDoc} />}
        </div>
        {optionsOpen && (
          <Lazy>
            <ModelOptions seedHint={status?.seed ?? null} busy={!!building} onClose={() => setOptionsOpen(false)} onBuild={(seed) => void model.build(seed)} />
          </Lazy>
        )}
      </div>
    </ChromeCtx.Provider>
  );
}
