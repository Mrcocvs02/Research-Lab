import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { EmptyState } from '../../components/EmptyState';
import { Lazy, lazyView } from '../../components/Lazy';
import { Segmented } from '../../components/Segmented';
import { ErrorNote } from '../../components/ui';
import { MapIllustration, RowPortal } from './NetChrome';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { safeText } from '../library/safeText';
import { DIMS, locKey, parentFromPath, pushBack, type BackEntry, type Dim, type Loc } from './exploreNav';
import { DocLink } from './SimilarPanel';
import { EntityNet, type EmptyKind } from './EntityNet';
import type { EntityMode, EntityNetwork, EntityNode } from './entityTypes';
import type { ScopeOptions } from './useScopes';

const VocabularyTree = lazyView(() => import('./VocabularyTree').then((m) => ({ default: m.VocabularyTree })), ['network', 'vicinity']);

type Level = ResponseOf<Channels, 'explore:level'> & { key: string };
type ENode = Level['nodes'][number];
type Related = ResponseOf<Channels, 'explore:related'>['nodes'][number];
const PAGE = 25;

interface RelState {
  from: { dim: Dim; id: string; label: string };
  to: Dim;
  nodes: Related[];
}

function Docs({ dim, id, onOpen, selectedDoc }: { dim: Dim; id: string; onOpen(docId: string): void; selectedDoc: string | null }) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(0);

  const load = useCallback(
    (offset: number) => {
      const mine = live.current;
      setLoading(true);
      rl.invoke('explore:documents', { dimension: dim, id, limit: PAGE, offset }).then(
        (r) => {
          if (mine !== live.current) return;
          setIds((cur) => (offset === 0 ? r.docIds : [...cur, ...r.docIds]));
          setTotal(r.total);
          setLoading(false);
        },
        (e: unknown) => {
          if (mine !== live.current) return;
          setError(e);
          setLoading(false);
        },
      );
    },
    [dim, id],
  );
  useEffect(() => {
    live.current++;
    setIds([]);
    setTotal(0);
    setError(null);
    load(0);
    return () => void live.current++;
  }, [load]);

  return (
    <section className="explore-docs" aria-label={t('network.explore.documents')} data-testid="explore-docs">
      <h3>
        {t('network.explore.documents')} <span className="hint" data-testid="explore-docs-total">({total})</span>
      </h3>
      {error ? <ErrorNote testId="explore-docs-error">{errorMessage(error, t)}</ErrorNote> : null}
      {!loading && ids.length === 0 && !error && <p className="hint">{t('network.explore.noDocuments')}</p>}
      <ul className="sim-list">
        {ids.map((d) => (
          <li key={d} className={d === selectedDoc ? 'sim-row on' : 'sim-row'} data-testid="explore-doc" data-doc-id={d}>
            <DocLink docId={d} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {loading && <p className="hint">{t('common.loading')}</p>}
      {!loading && ids.length < total && (
        <button type="button" onClick={() => load(ids.length)} data-testid="explore-docs-more">
          {t('network.explore.more', { count: total - ids.length })}
        </button>
      )}
    </section>
  );
}

interface ColumnsProps {
  active: boolean;
  onBuild(): void;
  onAddData(): void;
  onTags(): void;
  selectedDoc: string | null;
  onOpenDoc(docId: string): void;
  /** `L` on the map: show this dimension (a new `nonce` asks again). */
  dimRequest?: { dim: Dim; nonce: number } | undefined;
}

/**
 * The columns of Explore: zoomable exploration of topics, authors and venues: each level lists the children of a node (the taxonomy has free
 * depth), the breadcrumb and Back keep the way down, the selection and the scroll position of every level, and a node
 * leads to its documents or, through "Related", to the nodes of another dimension aligned on it (Back returns to the start).
 */
function Columns({ active, onAddData, onTags, selectedDoc, onOpenDoc, dimRequest }: ColumnsProps) {
  const { t } = useTranslation();
  const [loc, setLoc] = useState<Loc>({ dim: 'topic', parentId: null, selected: null });
  const [back, setBack] = useState<BackEntry[]>([]);
  const [data, setData] = useState<Level | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rel, setRel] = useState<RelState | null>(null);
  const [relError, setRelError] = useState<unknown>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const cache = useRef(new Map<string, Level>());
  const asked = useRef(0);
  useEffect(() => {
    if (!dimRequest || dimRequest.nonce === asked.current) return;
    asked.current = dimRequest.nonce;
    setLoc({ dim: dimRequest.dim, parentId: null, selected: null });
  }, [dimRequest]);
  // The first visit opens on the first dimension that has something: Themes, then Authors, then Venues.
  const probed = useRef(false);
  useEffect(() => {
    if (probed.current) return;
    probed.current = true;
    let live = true;
    (async () => {
      for (const d of DIMS) {
        try {
          const r = await rl.invoke('explore:level', { dimension: d, parentId: null });
          if (!live || asked.current > 0) return;
          cache.current.set(locKey(d, null), { ...r, key: locKey(d, null) });
          if (r.nodes.length > 0) return void (d !== 'topic' && setLoc({ dim: d, parentId: null, selected: null }));
        } catch {
          /* try the next one */
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const scroll = useRef(new Map<string, number>());
  const list = useRef<HTMLUListElement>(null);
  const key = locKey(loc.dim, loc.parentId);
  const loadedKey = data?.key ?? '';

  // Load the level of the current place (cached: coming back is instant and keeps what was there).
  useEffect(() => {
    const cached = cache.current.get(key);
    if (cached) {
      setData({ ...cached });
      return;
    }
    let live = true;
    setData(null);
    rl.invoke('explore:level', { dimension: loc.dim, parentId: loc.parentId }).then(
      (r) => {
        if (!live) return;
        const withLoc = { ...r, key };
        cache.current.set(key, withLoc);
        setData(withLoc);
        setError(null);
      },
      (e: unknown) => {
        if (!live) return;
        // A node that no longer exists: go to the top of the dimension.
        if (RlError.from(e).code === 'NOT_FOUND' && loc.parentId !== null) setLoc({ dim: loc.dim, parentId: null, selected: null });
        else setError(e);
      },
    );
    return () => {
      live = false;
    };
  }, [key, loc.dim, loc.parentId]);

  // Restore the scroll position of the level when it shows again.
  useLayoutEffect(() => {
    if (list.current && data) list.current.scrollTop = scroll.current.get(key) ?? 0;
  }, [data, key, rel]);

  const nodeLabel = useCallback(
    (l: Loc): string => {
      const lv = cache.current.get(locKey(l.dim, l.parentId));
      const sel = l.selected !== null ? lv?.nodes.find((n) => n.id === l.selected)?.label : undefined;
      return sel ?? lv?.path[lv.path.length - 1]?.label ?? t(`network.dim.${l.dim}`);
    },
    [t],
  );

  /** Goes to another place, remembering the current one (with its selection and scroll) to come back to. */
  const go = (next: Loc) => {
    setBack((s) => pushBack(s, { loc, label: nodeLabel(loc) }));
    setRel(null);
    setRelError(null);
    setLoc(next);
  };
  const goBack = () => {
    const top = back[back.length - 1];
    if (!top) return;
    setBack((s) => s.slice(0, -1));
    setRel(null);
    setRelError(null);
    setLoc(top.loc);
  };

  const ready = data !== null && loadedKey === key;
  const nodes = ready ? data.nodes : [];
  const selNode: ENode | undefined = nodes.find((n) => n.id === loc.selected);
  const pathLast = ready ? data.path[data.path.length - 1] : undefined;
  // The documents shown are those of the chosen node, or else of the node being explored.
  const docsOf = selNode ? selNode.id : (pathLast?.id ?? null);

  const relate = async (to: Dim, row?: ENode) => {
    const from = row ?? selNode ?? (pathLast ? { id: pathLast.id, label: pathLast.label } : null);
    if (!from) return;
    setRelError(null);
    try {
      const r = await rl.invoke('explore:related', { from: { dimension: loc.dim, id: from.id }, to, limit: 20 });
      setRel({ from: { dim: loc.dim, id: from.id, label: from.label }, to, nodes: r.nodes });
    } catch (e) {
      setRelError(e);
    }
  };

  const jumpTo = (n: Related) => {
    if (!rel) return;
    go({ dim: rel.to, parentId: parentFromPath(n.path, n.id), selected: n.id });
  };

  const topBack = back[back.length - 1];
  const others = DIMS.filter((d) => d !== loc.dim);

  return (
    <div className="net-tab explore-tab" onKeyDown={(e) => e.key === 'Escape' && rel && setRel(null)} data-testid="explore-panel" data-dim={loc.dim} data-depth={ready ? data.path.length : 0}>
      <RowPortal active={active}>
        <div role="tablist" aria-label={t('network.explore.dimension')} className="rl-seg rl-seg--sm">
          {DIMS.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={loc.dim === d} className={loc.dim === d ? 'rl-seg__opt is-on' : 'rl-seg__opt'} onClick={() => loc.dim !== d && go({ dim: d, parentId: null, selected: null })} data-testid={`explore-dim-${d}`}>
              {t(`network.dim.${d}`)}
            </button>
          ))}
        </div>
        {topBack && (
          <button type="button" onClick={goBack} data-testid="explore-back" title={t('network.explore.backTo', { label: topBack.label })}>
            {t('network.explore.back')}
          </button>
        )}
      </RowPortal>
      <nav aria-label={t('network.explore.breadcrumb')} data-testid="explore-breadcrumb">
        <ol className="crumbs">
          <li>
            {loc.parentId === null ? (
              <span aria-current="location" data-testid="crumb-current">
                {t(`network.dim.${loc.dim}`)}
              </span>
            ) : (
              <button type="button" className="link" onClick={() => go({ dim: loc.dim, parentId: null, selected: null })} data-testid="crumb">
                {t(`network.dim.${loc.dim}`)}
              </button>
            )}
          </li>
          {(ready ? data.path : []).map((p, i, all) => (
            <li key={p.id}>
              <span aria-hidden="true"> › </span>
              {i === all.length - 1 ? (
                <span aria-current="location" data-testid="crumb-current">
                  {safeText(p.label)}
                </span>
              ) : (
                <button type="button" className="link" onClick={() => go({ dim: loc.dim, parentId: p.id, selected: null })} data-testid="crumb">
                  {safeText(p.label)}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {error ? <ErrorNote testId="explore-error">{errorMessage(error, t)}</ErrorNote> : null}
      {relError ? <ErrorNote testId="explore-related-error">{errorMessage(relError, t)}</ErrorNote> : null}

      <div className="explore-body">
        <div className="explore-main">
          {rel ? (
            <section className="explore-related" aria-label={t('network.explore.related')} data-testid="explore-related" data-to={rel.to}>
              <header className="net-toolbar">
                <h3>{t('network.explore.relatedTitle', { to: t(`network.dim.${rel.to}`), label: safeText(rel.from.label) })}</h3>
                <button type="button" onClick={() => setRel(null)} data-testid="explore-related-back">
                  {t('network.explore.backTo', { label: safeText(rel.from.label) })}
                </button>
              </header>
              {rel.nodes.length === 0 && <p className="hint">{t('network.explore.noRelated')}</p>}
              <ul className="explore-list">
                {rel.nodes.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="explore-node" onClick={() => jumpTo(n)} data-testid="related-node" data-id={n.id}>
                      <span className="explore-label">{safeText(n.label)}</span>
                      <span className="hint">{n.path.map((p) => safeText(p.label)).join(' › ')}</span>
                      <span className="badge">{Math.round(n.score * 100)}%</span>
                      <span className="hint">{n.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <>
              {!ready && !error && <p className="hint">{t('common.loading')}</p>}
              {ready && nodes.length === 0 && loc.parentId === null && (
                <div className="explore-empty-box" data-testid="explore-empty">
                  <EmptyState
                    icon={<MapIllustration />}
                    title={t(`network.explore.emptyTitle.${loc.dim}`)}
                    action={
                      <>
                        <button type="button" className="primary" onClick={loc.dim === 'topic' ? onTags : onAddData} data-testid="explore-empty-action">
                          {loc.dim === 'topic' ? t('network.explore.createTags') : t('network.ent.empty.review.action')}
                        </button>
                        {loc.dim !== 'author' && (
                          <button type="button" className="link" onClick={() => go({ dim: 'author', parentId: null, selected: null })} data-testid="explore-empty-authors">
                            {t('network.explore.byAuthors')}
                          </button>
                        )}
                      </>
                    }
                  >
                    {t(`network.explore.emptyText.${loc.dim}`)}
                  </EmptyState>
                </div>
              )}
              {ready && nodes.length === 0 && loc.parentId !== null && <p className="hint">{t('network.explore.leaf')}</p>}
              <ul
                className="explore-list"
                ref={list}
                onScroll={(e) => scroll.current.set(key, e.currentTarget.scrollTop)}
                aria-label={t('network.explore.nodes')}
                data-testid="explore-nodes"
              >
                {nodes.map((n) => (
                  <li key={n.id} className="explore-row" onMouseEnter={() => setHoverId(n.id)} onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))} onFocus={() => setHoverId(n.id)}>
                    <button
                      type="button"
                      className={n.id === loc.selected ? 'explore-node on' : 'explore-node'}
                      aria-pressed={n.id === loc.selected}
                      onClick={() => setLoc({ ...loc, selected: n.id })}
                      onDoubleClick={() => n.hasChildren && go({ dim: loc.dim, parentId: n.id, selected: null })}
                      data-testid="explore-node"
                      data-id={n.id}
                      data-has-children={n.hasChildren ? 'true' : 'false'}
                    >
                      <span className="explore-label">{safeText(n.label)}</span>
                      <span className="hint">{t(`network.explore.kind.${n.kind}`)}</span>
                      <span className="badge" title={t('network.explore.count')}>
                        {n.count}
                      </span>
                      {n.hasChildren && <span aria-hidden="true">▸</span>}
                    </button>
                    {(n.id === loc.selected || n.id === hoverId) && (
                      <span className="explore-actions" data-testid="explore-actions">
                        {n.hasChildren && (
                          <button type="button" onClick={() => go({ dim: loc.dim, parentId: n.id, selected: null })} data-testid="explore-zoom">
                            {t('network.explore.zoomIn')}
                          </button>
                        )}
                        {others.map((d) => (
                          <button key={d} type="button" onClick={() => void relate(d, n)} data-testid={`explore-related-${d}`}>
                            {t('network.explore.showRelated', { dim: t(`network.dim.${d}`) })}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {docsOf !== null && !rel && <Docs key={`${loc.dim}|${docsOf}`} dim={loc.dim} id={docsOf} onOpen={onOpenDoc} selectedDoc={selectedDoc} />}
      </div>
    </div>
  );
}

type ExploreMode = 'columns' | 'vocab' | 'authors';
const EXPLORE_MODES: ExploreMode[] = ['columns', 'vocab', 'authors'];

interface Props extends ColumnsProps {
  scopes: ScopeOptions;
  selectedEntityId: string | null;
  onSelectEntity(node: EntityNode | null, mode: EntityMode): void;
  onData(d: EntityNetwork | null): void;
  onEmpty(kind: EmptyKind): void;
  mapVersion: number;
  mapReady: boolean;
  /** "Show on the Map" from the vocabulary: the Map grouped by that family. */
  onShowInMap(family: string): void;
}

/**
 * Explore (section 19.2.7): the columns of today, the Vocabulary (the tree of a family, the only place for the tag hierarchy as a graph)
 * and the network of the Authors (an advanced view moved here from the Links). A mode that was opened is kept while the others show.
 */
export function Explore({ scopes, selectedEntityId, onSelectEntity, onData, onEmpty, mapVersion, mapReady, onShowInMap, ...columns }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ExploreMode>('columns');
  const [seen, setSeen] = useState<Set<ExploreMode>>(() => new Set(['columns']));
  const pick = (m: ExploreMode) => {
    setMode(m);
    setSeen((cur) => (cur.has(m) ? cur : new Set(cur).add(m)));
  };
  // `L` on the Map asks for a dimension: the authors have their own mode, the topics the columns.
  const asked = useRef(0);
  const request = columns.dimRequest;
  useEffect(() => {
    if (!request || request.nonce === asked.current) return;
    asked.current = request.nonce;
    pick(request.dim === 'author' ? 'authors' : 'columns');
  }, [request]);
  useEffect(() => {
    if (mode === 'authors') return;
    onSelectEntity(null, 'author');
    onData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  return (
    <div className="explore-modes" data-testid="explore-modes" data-mode={mode}>
      <RowPortal active={columns.active}>
        <span data-testid="explore-mode">
          <Segmented<ExploreMode>
            size="sm"
            label={t('vicinity.explore.mode')}
            value={mode}
            onChange={pick}
            options={EXPLORE_MODES.map((m) => ({ value: m, label: t(`vicinity.explore.${m}`), testId: `explore-mode-${m}` }))}
          />
        </span>
      </RowPortal>
      <div className="explore-mode-pane" hidden={mode !== 'columns'}>
        <Columns {...columns} active={columns.active && mode === 'columns'} />
      </div>
      {seen.has('vocab') && (
        <div className="explore-mode-pane" hidden={mode !== 'vocab'}>
          <Lazy>
            <VocabularyTree onShowInMap={onShowInMap} />
          </Lazy>
        </div>
      )}
      {mode === 'authors' && (
        <div className="explore-mode-pane">
          <EntityNet active={columns.active} scopes={scopes} selectedId={selectedEntityId} onSelect={(n) => onSelectEntity(n, 'author')} onSelectDoc={columns.onOpenDoc} onExplore={() => pick('columns')} onEmpty={onEmpty} onData={onData} mapVersion={mapVersion} mapReady={mapReady} />
        </div>
      )}
    </div>
  );
}
