import { useEffect, useState } from 'react';
import { GRAPH_LIMITS } from '@rl/core';
import { useTranslation } from 'react-i18next';
import { ErrorNote, ProgressBar } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { canRead, useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { useDocTitle } from '../chat/useLabels';
import { safeText } from '../library/safeText';
import { Explore } from './Explore';
import { GraphNet, type NetStart } from './GraphNet';
import { MapPanel } from './MapPanel';
import { SimilarPanel, SurprisingList } from './SimilarPanel';
import { useGraphModel, type Phase } from './useGraphModel';
import { useScopeOptions } from './useScopes';
import './network.css';

const TABS = ['map', 'network', 'explore', 'surprising'] as const;
type Tab = (typeof TABS)[number];
const PHASES: Phase[] = ['vectors', 'similarity', 'clusters', 'layout'];

function DocDetail({ docId, onClose, onNetwork, tagLabel, onOpenDoc }: { docId: string; onClose(): void; onNetwork(): void; tagLabel(id: string): string; onOpenDoc(docId: string): void }) {
  const { t } = useTranslation();
  const title = useDocTitle(docId);
  const { openReader } = useReader();
  const [readable, setReadable] = useState(false);
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
        <h2 data-testid="net-detail-title">{safeText(title ?? docId.slice(0, 8))}</h2>
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
        <button type="button" onClick={onNetwork} data-testid="net-detail-network">
          {t('network.net.fromDoc')}
        </button>
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
  const [doc, setDoc] = useState<string | null>(null);
  const [start, setStart] = useState<NetStart | null>(null);
  const [seedText, setSeedText] = useState('');
  const docTitle = useDocTitle(doc);
  const { status, building } = model;

  const show = (next: Tab) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  };
  const startNet = (s: Omit<NetStart, 'nonce'>) => {
    setStart((cur) => ({ ...s, nonce: (cur?.nonce ?? 0) + 1 }));
    show('network');
  };
  const seed = /^\d{1,10}$/.test(seedText.trim()) && Number(seedText) <= 2_147_483_647 ? Number(seedText) : undefined;
  const seedBad = seedText.trim() !== '' && seed === undefined;
  const phase = building?.phase ?? null;

  return (
    <div className="network-page" data-testid="section-network">
      <header className="net-head">
        <h1>{t('sections.network')}</h1>
        <div className="net-status" data-testid="graph-status" data-state={status?.state ?? 'unknown'} data-pending={status?.pending ?? 0} aria-live="polite">
          {status && !building && (
            <span data-testid="graph-status-text">
              {status.state === 'none' ? t('network.status.none') : status.state === 'stale' ? (status.pending > 0 ? t('network.status.stale', { count: status.pending }) + (status.removed > 0 ? ` · ${t('network.status.alsoRemoved', { count: status.removed })}` : '') : t('network.status.removed', { count: status.removed })) : t('network.status.ready', { count: status.documents })}
              {status.builtAt && status.state !== 'none' ? ` · ${t('network.status.builtAt', { date: status.builtAt.slice(0, 16).replace('T', ' ') })}` : ''}
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
          {!building && (
            <>
              <label className="net-field">
                <span>{t('network.seed')}</span>
                <input type="text" inputMode="numeric" value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder={status?.seed !== null && status?.seed !== undefined ? String(status.seed) : t('network.seedAuto')} aria-invalid={seedBad || undefined} data-testid="graph-seed" size={10} />
              </label>
              <button type="button" className={status?.state === 'stale' ? 'primary' : undefined} onClick={() => void model.build(seed)} disabled={seedBad || status === null} data-testid="graph-build">
                {status && status.state !== 'none' ? t('network.rebuild') : t('network.build')}
              </button>
            </>
          )}
          {building && (
            <button type="button" onClick={() => void model.cancel()} disabled={building.jobId === null} data-testid="graph-cancel">
              {t('common.cancel')}
            </button>
          )}
        </div>
      </header>
      {model.error ? <ErrorNote testId="graph-error">{errorMessage(model.error, t)}</ErrorNote> : null}
      {model.failed && <ErrorNote testId="graph-failed">{t(model.failReason ? `network.buildFailed_${model.failReason}` : 'network.buildFailed', { limit: GRAPH_LIMITS.buildDocuments.toLocaleString(i18n.language) })}</ErrorNote>}
      {model.trimmed > 0 && !building && (
        <p className="note" role="status" data-testid="graph-trimmed">
          {t('network.citationsTrimmed', { count: model.trimmed, max: GRAPH_LIMITS.citationKeys })}
        </p>
      )}
      <div role="tablist" aria-label={t('network.tabs')} className="tabs">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" id={`net-tab-${id}`} aria-selected={tab === id} aria-controls={`net-panel-${id}`} className={tab === id ? 'tab on' : 'tab'} onClick={() => show(id)} data-testid={`net-tab-${id}`}>
            {t(`network.tab.${id}`)}
          </button>
        ))}
      </div>
      <div className="net-main">
        <div className="net-panels">
          {visited.has('map') && (
            <div role="tabpanel" id="net-panel-map" aria-labelledby="net-tab-map" hidden={tab !== 'map'} className="net-panel">
              {status && status.state === 'none' && !building ? (
                <div className="callout" data-testid="graph-empty">
                  <p>{t('network.empty')}</p>
                  <button type="button" className="primary" onClick={() => void model.build(seed)} disabled={seedBad} data-testid="graph-build-empty">
                    {t('network.build')}
                  </button>
                </div>
              ) : status ? (
                <MapPanel status={status} mapVersion={model.mapVersion} scopes={scopes} selected={doc} onSelect={setDoc} onMapChanged={model.bumpMap} />
              ) : null}
            </div>
          )}
          {visited.has('network') && (
            <div role="tabpanel" id="net-panel-network" aria-labelledby="net-tab-network" hidden={tab !== 'network'} className="net-panel">
              <GraphNet start={start} scopes={scopes} selectedDoc={doc} selectedDocLabel={docTitle} onSelectDoc={setDoc} onStart={startNet} />
            </div>
          )}
          {visited.has('explore') && (
            <div role="tabpanel" id="net-panel-explore" aria-labelledby="net-tab-explore" hidden={tab !== 'explore'} className="net-panel">
              <Explore selectedDoc={doc} onOpenDoc={setDoc} />
            </div>
          )}
          {visited.has('surprising') && (
            <div role="tabpanel" id="net-panel-surprising" aria-labelledby="net-tab-surprising" hidden={tab !== 'surprising'} className="net-panel">
              <SurprisingList onOpen={setDoc} />
            </div>
          )}
        </div>
        {doc && <DocDetail key={doc} docId={doc} onClose={() => setDoc(null)} onNetwork={() => startNet({ kind: 'doc', id: doc, label: docTitle ?? doc.slice(0, 8) })} tagLabel={scopes.tagLabel} onOpenDoc={setDoc} />}
      </div>
    </div>
  );
}
