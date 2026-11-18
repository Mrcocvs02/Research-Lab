import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { safeText } from '../library/safeText';
import { DIMS, locKey, parentFromPath, pushBack, type BackEntry, type Dim, type Loc } from './exploreNav';
import { DocLink } from './SimilarPanel';

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

interface Props {
  selectedDoc: string | null;
  onOpenDoc(docId: string): void;
  /** `L` on the map: show this dimension (a new `nonce` asks again). */
  dimRequest?: { dim: Dim; nonce: number } | undefined;
}

/**
 * Zoomable exploration of topics, authors and venues: each level lists the children of a node (the taxonomy has free
 * depth), the breadcrumb and Back keep the way down, the selection and the scroll position of every level, and a node
 * leads to its documents or, through "Related", to the nodes of another dimension aligned on it (Back returns to the start).
 */
export function Explore({ selectedDoc, onOpenDoc, dimRequest }: Props) {
  const { t } = useTranslation();
  const [loc, setLoc] = useState<Loc>({ dim: 'topic', parentId: null, selected: null });
  const [back, setBack] = useState<BackEntry[]>([]);
  const [data, setData] = useState<Level | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rel, setRel] = useState<RelState | null>(null);
  const [relError, setRelError] = useState<unknown>(null);
  const cache = useRef(new Map<string, Level>());
  const asked = useRef(0);
  useEffect(() => {
    if (!dimRequest || dimRequest.nonce === asked.current) return;
    asked.current = dimRequest.nonce;
    setLoc({ dim: dimRequest.dim, parentId: null, selected: null });
  }, [dimRequest]);
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

  const relate = async (to: Dim) => {
    const from = selNode ?? (pathLast ? { id: pathLast.id, label: pathLast.label } : null);
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
      <div className="net-toolbar">
        <div role="tablist" aria-label={t('network.explore.dimension')} className="seg">
          {DIMS.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={loc.dim === d} className={loc.dim === d ? 'tab on' : 'tab'} onClick={() => loc.dim !== d && go({ dim: d, parentId: null, selected: null })} data-testid={`explore-dim-${d}`}>
              {t(`network.dim.${d}`)}
            </button>
          ))}
        </div>
        <button type="button" onClick={goBack} disabled={!topBack} data-testid="explore-back" title={topBack ? t('network.explore.backTo', { label: topBack.label }) : undefined}>
          {topBack ? t('network.explore.backTo', { label: safeText(topBack.label) }) : t('network.explore.back')}
        </button>
      </div>
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
              {ready && nodes.length === 0 && <p className="hint" data-testid="explore-empty">{t('network.explore.empty')}</p>}
              <ul
                className="explore-list"
                ref={list}
                onScroll={(e) => scroll.current.set(key, e.currentTarget.scrollTop)}
                aria-label={t('network.explore.nodes')}
                data-testid="explore-nodes"
              >
                {nodes.map((n) => (
                  <li key={n.id}>
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
                  </li>
                ))}
              </ul>
            </>
          )}
          {!rel && (
            <div className="net-toolbar explore-actions" data-testid="explore-actions">
              <button type="button" onClick={() => selNode && go({ dim: loc.dim, parentId: selNode.id, selected: null })} disabled={!selNode?.hasChildren} data-testid="explore-zoom">
                {t('network.explore.zoomIn')}
              </button>
              <span className="hint">{t('network.explore.relatedLabel')}</span>
              {others.map((d) => (
                <button key={d} type="button" onClick={() => void relate(d)} disabled={!selNode && !pathLast} data-testid={`explore-related-${d}`}>
                  {t(`network.dim.${d}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        {docsOf !== null && !rel && <Docs key={`${loc.dim}|${docsOf}`} dim={loc.dim} id={docsOf} onOpen={onOpenDoc} selectedDoc={selectedDoc} />}
      </div>
    </div>
  );
}
