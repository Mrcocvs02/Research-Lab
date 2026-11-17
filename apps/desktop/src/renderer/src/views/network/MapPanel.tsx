import { isDarkTheme } from '../../lib/theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { Lazy, lazyView } from '../../components/Lazy';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useAiUi } from '../../lib/aiUi';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { safeText } from '../library/safeText';
import { groupColor } from './geometry';
import { MapCanvas, type MapHandle } from './MapCanvas';
import { clusterText, prepareMap, type PreparedMap } from './mapModel';
import type { ScopeOptions } from './useScopes';
import type { GraphStatus } from './useGraphModel';

const LabelsDialog = lazyView(() => import('./LabelsDialog').then((m) => ({ default: m.LabelsDialog })), ['network']);

type ScopeKind = 'all' | 'folder' | 'project' | 'tag';
type MapScope = NonNullable<RequestOf<Channels, 'graph:map'>['scope']>;

interface Props {
  status: GraphStatus;
  mapVersion: number;
  scopes: ScopeOptions;
  selected: string | null;
  onSelect(docId: string | null): void;
  onMapChanged(): void;
}

/** The map tab: scope, level, the canvas, the legend of clusters and the labels by Claude. */
export function MapPanel({ status, mapVersion, scopes, selected, onSelect, onMapChanged }: Props) {
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

  const scope = useMemo<MapScope | undefined>(() => {
    if (kind === 'all' || value === '') return undefined;
    return kind === 'folder' ? { folder: value } : kind === 'project' ? { projectId: value } : { tagId: value };
  }, [kind, value]);
  const usable = status.state === 'ready' || status.state === 'stale';
  const dark = typeof window !== 'undefined' && isDarkTheme();

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

  const depth = map?.levels.length ?? 0;
  const lvl = Math.min(level, Math.max(depth - 1, 0));
  const clusters = map?.levels[lvl] ?? [];

  const scopeValues = kind === 'folder' ? scopes.folders.map((f) => ({ id: f, label: f || '/' })) : kind === 'project' ? scopes.projects.map((p) => ({ id: p.id, label: p.name })) : kind === 'tag' ? scopes.tags : [];

  return (
    <div className="net-tab map-tab" data-testid="map-panel">
      <div className="net-toolbar">
        <label className="net-field">
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
          <label className="net-field">
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
        <label className="net-field">
          <span>{t('network.colorBy')}</span>
          <select value={lvl} onChange={(e) => setLevel(Number(e.target.value))} disabled={depth === 0} data-testid="map-level">
            {Array.from({ length: depth }, (_, l) => (
              <option key={l} value={l}>
                {t('network.level', { level: l + 1 })}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => handle.current?.fit()} disabled={!map} data-testid="map-fit">
          {t('network.fit')}
        </button>
        <button type="button" onClick={() => setLabelsOpen(true)} disabled={!map || depth === 0} data-testid="map-label-clusters">
          {t('network.labels.open')}
        </button>
        {map && (
          <span className="hint" data-testid="map-info" data-seed={map.seed}>
            {t('network.mapInfo', { count: map.n, seed: map.seed })}
          </span>
        )}
      </div>
      {error ? <ErrorNote testId="map-error">{errorMessage(error, t)}</ErrorNote> : null}
      {!map && !loading && !error && <p className="hint" data-testid="map-empty">{t('network.noMap')}</p>}
      {map && map.omitted > 0 && (
        <p className="hint" role="status" data-testid="map-omitted">
          {t('network.mapOmitted', { count: map.omitted, shown: map.n })}
        </p>
      )}
      {map && map.n === 0 && <p className="hint" data-testid="map-no-points">{t('network.noPoints')}</p>}
      {map && (
        <div className="map-body">
          <MapCanvas map={map} level={lvl} selected={selected} onSelect={onSelect} aiBadge={t('ai.badge')} label={t('network.mapLabel')} fitKey={mapKey} handle={handle} />
          <ul className="legend" data-testid="cluster-legend" aria-label={t('network.legend')}>
            {clusters.slice(0, 60).map((c, i) => {
              const txt = clusterText(c);
              return (
                <li key={c.id}>
                  <button type="button" className="legend-item" onClick={() => handle.current?.focusCluster(c.id)} data-testid="cluster-item" data-cluster={c.id} data-ai={txt.ai ? 'true' : 'false'}>
                    <span className="swatch" style={{ background: groupColor(i, dark) }} aria-hidden="true" />
                    <span className="legend-text">{safeText(txt.text || c.id)}</span>
                    {txt.ai && <span className="ai-badge">{t('ai.badge')}</span>}
                    <span className="hint">{c.size}</span>
                  </button>
                  <button type="button" className="link legend-export" onClick={() => openExport({ clusters: [{ id: c.id, label: txt.text || c.id }], name: txt.text })} aria-label={t('secondBrain.clusterAria', { name: safeText(txt.text || c.id) })} data-testid="cluster-export">
                    {t('secondBrain.clusterButton')}
                  </button>
                </li>
              );
            })}
            {clusters.length > 60 && <li className="hint">{t('network.moreClusters', { count: clusters.length - 60 })}</li>}
          </ul>
        </div>
      )}
      {labelsOpen && map && (
        <Lazy>
          <LabelsDialog
            levels={map.levels}
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
