import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_LIMITS, type AiJobField, type Channels, type ReasoningLevel, type ResponseOf } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { CheckField, ErrorNote } from '../../components/ui';
import { useJobs } from '../../lib/jobs';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { formatTokens, formatUsd } from '../chat/format';
import { safeText } from '../library/safeText';
import { aiErrorText } from './aiErrors';
import { useAiAvailability } from './useAiAvailability';

type Estimate = ResponseOf<Channels, 'jobs:estimate'>;

export const JOB_FIELDS: AiJobField[] = ['tags', 'description', 'summary', 'keywords', 'synonyms'];
const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];

/**
 * Bulk AI job (selection of the library, or one document): choose fields, model and reasoning, see what would go and
 * what it would cost (`jobs:estimate`, nothing is sent), then confirm (`jobs:start`). Progress follows in the status bar.
 */
export function JobDialog({ docIds, onClose }: { docIds: string[]; onClose(): void }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const { refresh } = useJobs();
  const { info } = useNotify();
  const ids = { model: useId(), reasoning: useId() };
  const models = config?.ai.models ?? [];
  const [fields, setFields] = useState<AiJobField[]>(['tags', 'description']);
  const [modelChoice, setModel] = useState<string | null>(null);
  const [reasoningChoice, setReasoning] = useState<ReasoningLevel | null>(null);
  const model = modelChoice ?? config?.ai.defaultModel ?? models[0]?.id ?? '';
  const reasoning = reasoningChoice ?? config?.ai.defaultReasoning ?? 'low';
  const [regenerate, setRegenerate] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const ticket = useRef(0);
  // The estimate needs no network, but the job does: say it at once instead of after the confirmation.
  const { reason: unavailable } = useAiAvailability();
  const blocked = unavailable !== null && unavailable !== 'no-folders';

  const tooMany = docIds.length > AI_LIMITS.jobDocs;
  const request = useMemo(() => ({ kind: 'suggest' as const, docIds, fields, model, reasoning, regenerate }), [docIds, fields, model, reasoning, regenerate]);

  useEffect(() => {
    setEstimate(null);
    setError(null);
    if (tooMany || fields.length === 0 || model === '') return;
    const mine = ++ticket.current;
    rl.invoke('jobs:estimate', request).then(
      (r) => mine === ticket.current && setEstimate(r),
      (e: unknown) => mine === ticket.current && setError(e),
    );
  }, [request, tooMany, fields.length, model]);

  const toggle = (f: AiJobField) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : JOB_FIELDS.filter((x) => x === f || cur.includes(x))));
  const p = estimate?.preview;
  const canStart = Boolean(estimate && p && estimate.toSend > 0 && !p.overCap && !blocked && !starting);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await rl.invoke('jobs:start', { ...request, confirmed: true });
      info(t('jobs.started'));
      void refresh();
      onClose();
    } catch (e) {
      setError(e);
      setStarting(false);
    }
  };

  return (
    <Dialog title={t('jobs.dialog.title')} onClose={onClose} testId="job-dialog">
      <div className="dialog-body">
        <p>{t('jobs.dialog.intro', { count: docIds.length })}</p>
        <fieldset className="group">
          <legend>{t('jobs.dialog.fields')}</legend>
          {JOB_FIELDS.map((f) => (
            <CheckField key={f} label={t(`jobs.fields.${f}`)} checked={fields.includes(f)} onChange={() => toggle(f)} data-testid={`job-field-${f}`} />
          ))}
        </fieldset>
        <div className="two-col">
          <div className="field">
            <label htmlFor={ids.model}>{t('chat.model')}</label>
            <select id={ids.model} value={model} onChange={(e) => setModel(e.target.value)} data-testid="job-model">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.reasoning}>{t('chat.reasoning')}</label>
            <select id={ids.reasoning} value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningLevel)} data-testid="job-reasoning">
              {REASONING.map((r) => (
                <option key={r} value={r}>
                  {t(`settings.library.reasoning${r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <CheckField label={t('jobs.dialog.regenerate')} hint={t('jobs.dialog.regenerateHint')} checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} data-testid="job-regenerate" />

        <section className="group" aria-live="polite" data-testid="job-estimate">
          <h3>{t('jobs.dialog.estimate')}</h3>
          {blocked && (
            <div className="callout" role="status" data-testid="job-unavailable" data-reason={unavailable}>
              <p>{t(`chat.unavailable.${unavailable}`)}</p>
              <p className="hint">{t(`chat.unavailable.fix_${unavailable}`)}</p>
            </div>
          )}
          {tooMany && <ErrorNote testId="job-too-many">{t('jobs.dialog.tooMany', { limit: AI_LIMITS.jobDocs })}</ErrorNote>}
          {fields.length === 0 && <p className="hint">{t('jobs.dialog.noFields')}</p>}
          {!estimate && !error && !tooMany && fields.length > 0 && <p className="hint">{t('common.loading')}</p>}
          {estimate && p && (
            <>
              <p data-testid="job-to-send">{t('jobs.dialog.toSend', { count: estimate.toSend })}</p>
              <p data-testid="job-allowed">{t('jobs.dialog.allowed', { count: p.allowed.length })}</p>
              {estimate.skipped > 0 && <p data-testid="job-skipped">{t('jobs.dialog.skipped', { count: estimate.skipped })}</p>}
              {p.refused.length > 0 && (
                <p data-testid="job-refused">
                  {t('jobs.dialog.refused', { count: p.refused.length })}{' '}
                  {[...new Set(p.refused.map((r) => t(`chat.preview.reason_${r.reason}`)))].join('; ')}
                </p>
              )}
              {p.folders.length > 0 && (
                <p data-testid="job-folders">
                  {t('chat.preview.folders')} {p.folders.map((f) => safeText(f || '/')).join(', ')}
                </p>
              )}
              <p data-testid="job-size">
                {t('chat.preview.tokens', { tokens: formatTokens(p.approxInputTokens) })} ·{' '}
                {p.estimatedUsd === null ? t('chat.preview.noPrice') : t('chat.preview.cost', { usd: formatUsd(p.estimatedUsd) })}
              </p>
              {p.overCap && <ErrorNote testId="job-over-cap">{t('jobs.dialog.overCap')}</ErrorNote>}
              {p.needsConfirmation && !p.overCap && <p className="callout" data-testid="job-needs-confirmation">{t('jobs.dialog.bigJob')}</p>}
              {estimate.toSend === 0 && <p className="hint" data-testid="job-nothing">{t('jobs.dialog.nothing')}</p>}
            </>
          )}
          {error ? <ErrorNote testId="job-error-note">{aiErrorText(error, t)}</ErrorNote> : null}
        </section>
        <p className="hint">{t('jobs.dialog.note')}</p>
      </div>
      <div className="actions">
        <button type="button" onClick={onClose} data-testid="job-cancel-dialog">
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" onClick={() => void start()} disabled={!canStart} data-testid="job-confirm">
          {t('jobs.dialog.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
