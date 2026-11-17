import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GRAPH_LIMITS, type Channels, type ReasoningLevel, type ResponseOf } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { Lazy, lazyView } from '../../components/Lazy';
import { CheckField, ErrorNote } from '../../components/ui';
import { useNotify } from '../../lib/notify';
import { RlError } from '../../lib/rl-error';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { aiErrorText } from '../ai/aiErrors';
import { useAiAvailability } from '../ai/useAiAvailability';
import { safeText } from '../library/safeText';
import { clusterText, type ClusterView } from './mapModel';

const PreviewDialog = lazyView(() => import('../chat/PreviewDialog').then((m) => ({ default: m.PreviewDialog })), ['chat-preview']);
const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];
type Preview = ResponseOf<Channels, 'graph:previewLabels'>;

interface Props {
  /** Clusters of every level, as in the map. */
  levels: ClusterView[][];
  /** Level the map shows: its clusters are the ones ticked at first. */
  level: number;
  onClose(): void;
  /** Called after labels were written (the map reloads). */
  onDone(): void;
}

/**
 * Cluster labels by Claude: choose the clusters (one level or several), see what would be sent (`graph:previewLabels`,
 * nothing leaves yet), confirm, then `graph:labelClusters` writes labels stored locally and marked as AI output.
 */
export function LabelsDialog({ levels, level, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { config } = useApp();
  const { info } = useNotify();
  const ids = { model: useId(), reasoning: useId() };
  const models = config?.ai.models ?? [];
  const [picked, setPicked] = useState<Set<string>>(() => new Set((levels[level] ?? []).slice(0, GRAPH_LIMITS.labelClusters).map((c) => c.id)));
  const [modelChoice, setModel] = useState<string | null>(null);
  const [reasoningChoice, setReasoning] = useState<ReasoningLevel | null>(null);
  const model = modelChoice ?? config?.ai.defaultModel ?? models[0]?.id ?? '';
  const reasoning = reasoningChoice ?? config?.ai.defaultReasoning ?? 'low';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);
  const { reason: unavailable } = useAiAvailability();
  const blocked = unavailable !== null && unavailable !== 'no-folders';
  const chosen = useMemo(() => [...picked], [picked]);
  const tooMany = chosen.length > GRAPH_LIMITS.labelClusters;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const setLevel = (l: number, on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur);
      for (const c of levels[l] ?? []) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });

  const ask = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      setPreview(await rl.invoke('graph:previewLabels', { clusterIds: chosen, model }));
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const send = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    let again = false;
    try {
      const r = await rl.invoke('graph:labelClusters', { clusterIds: chosen, model, reasoning, confirmed: true });
      info(t('network.labels.done', { count: r.labelled }));
      onDone();
      onClose();
    } catch (e) {
      const err = RlError.from(e);
      setPreview(null);
      // The library asks for another look (what would go changed): show the preview again.
      if (err.code === 'CONFLICT' && err.details?.reason === 'needs-confirmation') again = true;
      else setError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (again) await ask();
  };

  const overCap = preview?.overCap === true;

  return (
    <>
      <Dialog title={t('network.labels.title')} onClose={onClose} testId="labels-dialog">
        <div className="dialog-body">
          <p>{t('network.labels.intro')}</p>
          <div className="actions-inline">
            {levels.map((cl, l) => (
              <span key={l} className="inline-actions">
                <button type="button" onClick={() => setLevel(l, true)} data-testid={`labels-level-${l}`}>
                  {t('network.labels.selectLevel', { level: l + 1 })}
                </button>
                <button type="button" className="link" onClick={() => setLevel(l, false)} aria-label={t('network.labels.clearLevel', { level: l + 1 })}>
                  {t('network.labels.none')}
                </button>
                <span className="hint">({cl.length})</span>
              </span>
            ))}
          </div>
          <fieldset className="group labels-list" data-testid="labels-list">
            <legend>{t('network.labels.clusters', { count: chosen.length })}</legend>
            {levels.map((cl, l) => (
              <div key={l}>
                <h4>{t('network.level', { level: l + 1 })}</h4>
                {cl.slice(0, 200).map((c) => {
                  const txt = clusterText(c);
                  return <CheckField key={c.id} label={`${safeText(txt.text || c.id)} (${c.size})`} checked={picked.has(c.id)} onChange={() => toggle(c.id)} data-testid="labels-cluster" />;
                })}
              </div>
            ))}
          </fieldset>
          {tooMany && <ErrorNote testId="labels-too-many">{t('network.labels.tooMany', { limit: GRAPH_LIMITS.labelClusters })}</ErrorNote>}
          <div className="two-col">
            <div className="field">
              <label htmlFor={ids.model}>{t('chat.model')}</label>
              <select id={ids.model} value={model} onChange={(e) => setModel(e.target.value)} data-testid="labels-model">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label || m.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.reasoning}>{t('chat.reasoning')}</label>
              <select id={ids.reasoning} value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningLevel)} data-testid="labels-reasoning">
                {REASONING.map((r) => (
                  <option key={r} value={r}>
                    {t(`settings.library.reasoning${r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {blocked && (
            <div className="callout" role="status" data-testid="labels-unavailable" data-reason={unavailable}>
              <p>{t(`chat.unavailable.${unavailable}`)}</p>
              <p className="hint">{t(`chat.unavailable.fix_${unavailable}`)}</p>
            </div>
          )}
          {overCap && <ErrorNote testId="labels-over-cap">{t('chat.errors.cap')}</ErrorNote>}
          {error ? <ErrorNote testId="labels-error">{aiErrorText(error, t)}</ErrorNote> : null}
          <p className="hint">{t('network.labels.note')}</p>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose} data-testid="labels-cancel">
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={() => void ask()} disabled={busy || chosen.length === 0 || tooMany || model === '' || blocked} data-testid="labels-preview">
            {t('network.labels.preview')}
          </button>
        </div>
      </Dialog>
      {preview && !overCap && (
        <Lazy>
          <PreviewDialog preview={preview} models={models} busy={busy} title={t('network.labels.previewTitle')} confirmLabel={t('network.labels.send')} onConfirm={() => void send()} onCancel={() => setPreview(null)} />
        </Lazy>
      )}
    </>
  );
}
