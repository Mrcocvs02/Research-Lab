import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagAiPlan, TagAiRunResult } from '@rl/core';
import { Dialog } from '../../../components/Dialog';
import { ProgressBar } from '../../../components/Progress';
import { errorMessage } from '../../../lib/errors';
import { haikuRunning, useElapsed, useHaikuProgress } from '../../../lib/haikuProgress';
import { rl } from '../../../lib/rl';

/**
 * The optional Claude confirmation of the uncertain pairs (D-416): the exact text that would go (names and counts only), the cost
 * of ALL the pending questions and the cap, then the send. While it runs the dialog shows the calls, the time and a Cancel, and at
 * the end the summary (D-515); closing it does not stop the run: the Activity chip follows it.
 */
export function TagAiConfirm({ onClose, onDone, decide = false }: { onClose(): void; onDone(): void; /** Haiku decides (D-512): its sure answers are applied as one change. */ decide?: boolean }) {
  const { t, i18n } = useTranslation();
  const [plan, setPlan] = useState<TagAiPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TagAiRunResult | null>(null);
  const progress = useHaikuProgress();
  const running = busy && haikuRunning(progress);
  const elapsed = useElapsed(progress?.startedAt, running);
  useEffect(() => {
    rl.invoke('tagReview:aiPreview', {}).then(setPlan, (e) => setError(errorMessage(e, t)));
  }, [t]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await rl.invoke('tagReview:aiRun', { ...(plan ? { model: plan.model } : {}), confirmed: true, ...(decide ? { decide: true } : {}) }));
    } catch (e) {
      setError(errorMessage(e, t));
    }
    setBusy(false);
  };
  const stop = () => void rl.invoke('tagReview:aiCancel', {}).catch(() => undefined);
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' });
  const usd = plan?.estimatedUsd == null ? t('tax.review.ai.noPrice') : money.format(plan.estimatedUsd);
  const total = progress?.total ?? plan?.fitsPairs ?? 0;
  return (
    <Dialog title={decide ? t('tax.haiku.title') : t('tax.review.ai.title')} onClose={onClose} testId="tag-review-ai-dialog">
      <div className="dlg-scroll">
        {error && <p className="callout" role="alert">{error}</p>}
        {plan?.disabled && <p className="callout" data-testid="tag-review-ai-off">{t(`tax.review.ai.off.${plan.disabled}`)}</p>}
        {plan && !plan.disabled && !busy && !result && (
          <>
            <p>{t('tax.review.ai.what', { count: plan.pairs, model: plan.model })}</p>
            {decide && <p className="hint" data-testid="tag-haiku-note">{t('tax.haiku.what')}</p>}
            <p className="hint" data-testid="tag-review-ai-batches">{t('tax.review.ai.batches', { count: plan.batches, size: plan.batchSize })}</p>
            <pre className="tag-ai-text" data-testid="tag-review-ai-text">{plan.text}</pre>
            <p className="hint">{t('tax.review.ai.cost', { tokens: plan.approxInputTokens, usd })}</p>
            {plan.overCap && plan.fitsPairs > 0 && (
              <p className="callout" role="alert" data-testid="tag-review-ai-fit">
                {t('tax.review.ai.capFits', { fits: plan.fitsPairs, count: plan.pairs, cap: plan.capUsd === null ? '' : money.format(plan.capUsd), spent: money.format(plan.monthUsd) })}
              </p>
            )}
            {plan.overCap && plan.fitsPairs === 0 && <p className="callout" role="alert">{t('tax.review.ai.cap')}</p>}
          </>
        )}
        {busy && (
          <div role="status" data-testid="tag-haiku-progress">
            <p>
              <b>{t('tax.haiku.progress', { done: progress?.done ?? 0, total })}</b>
            </p>
            <ProgressBar value={total > 0 ? (progress?.done ?? 0) / total : undefined} label={t('tax.haiku.progress', { done: progress?.done ?? 0, total })} />
            <p className="hint">{t('tax.haiku.progressDetail', { batch: Math.max(1, progress?.batch ?? 1), batches: progress?.batches ?? plan?.batches ?? 1, time: elapsed, decided: progress?.decided ?? 0 })}</p>
            <p className="hint">{t('tax.haiku.background')}</p>
          </div>
        )}
        {result && !busy && (
          <div role="status" data-testid="tag-haiku-result">
            <p>
              <b>{t(result.cancelled ? 'tax.haiku.stopped' : 'tax.haiku.finished')}</b>
            </p>
            <p>{decide ? t('tax.haiku.summary', { decided: result.decided?.items.length ?? 0, left: result.left ?? result.asked, errors: result.errors ?? 0 }) : t('tax.review.ai.answered', { count: result.asked, errors: result.errors ?? 0 })}</p>
            {(result.capped ?? 0) > 0 && <p className="hint">{t('tax.haiku.capped', { count: result.capped })}</p>}
          </div>
        )}
      </div>
      <div className="actions dlg-foot">
        {busy ? (
          <>
            <button type="button" onClick={onClose} data-testid="tag-haiku-close">
              {t('tax.haiku.hide')}
            </button>
            <button type="button" className="primary" onClick={stop} data-testid="tag-haiku-stop">
              {t('tax.haiku.stop')}
            </button>
          </>
        ) : result ? (
          <button type="button" className="primary" onClick={onDone} data-testid="tag-haiku-done">
            {t('common.close')}
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" disabled={!plan || !!plan.disabled || (plan.overCap && plan.fitsPairs === 0)} onClick={() => void send()} data-testid="tag-review-ai-send">
              {decide ? t('tax.haiku.send') : t('tax.review.ai.send')}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
