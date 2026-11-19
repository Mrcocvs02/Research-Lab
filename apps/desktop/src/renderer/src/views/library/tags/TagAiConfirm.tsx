import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagAiPlan } from '@rl/core';
import { Dialog } from '../../../components/Dialog';
import { errorMessage } from '../../../lib/errors';
import { rl } from '../../../lib/rl';

/** The optional Claude confirmation of the uncertain pairs (D-416): the exact text that would go (names and counts only), the cost, then the send. */
export function TagAiConfirm({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { t, i18n } = useTranslation();
  const [plan, setPlan] = useState<TagAiPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rl.invoke('tagReview:aiPreview', {}).then(setPlan, (e) => setError(errorMessage(e, t)));
  }, [t]);
  const send = async () => {
    setBusy(true);
    try {
      await rl.invoke('tagReview:aiRun', { ...(plan ? { model: plan.model } : {}), confirmed: true });
      onDone();
    } catch (e) {
      setError(errorMessage(e, t));
      setBusy(false);
    }
  };
  const usd = plan?.estimatedUsd == null ? t('tax.review.ai.noPrice') : new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' }).format(plan.estimatedUsd);
  return (
    <Dialog title={t('tax.review.ai.title')} onClose={onClose} testId="tag-review-ai-dialog">
      <div className="dlg-scroll">
        {error && <p className="callout" role="alert">{error}</p>}
        {plan?.disabled && <p className="callout" data-testid="tag-review-ai-off">{t(`tax.review.ai.off.${plan.disabled}`)}</p>}
        {plan && !plan.disabled && (
          <>
            <p>{t('tax.review.ai.what', { count: plan.pairs, model: plan.model })}</p>
            <pre className="tag-ai-text" data-testid="tag-review-ai-text">{plan.text}</pre>
            <p className="hint">{t('tax.review.ai.cost', { tokens: plan.approxInputTokens, usd })}</p>
            {plan.overCap && <p className="callout" role="alert">{t('tax.review.ai.cap')}</p>}
          </>
        )}
      </div>
      <div className="actions dlg-foot">
        <button type="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" disabled={!plan || !!plan.disabled || plan.overCap || busy} onClick={() => void send()} data-testid="tag-review-ai-send">
          {t('tax.review.ai.send')}
        </button>
      </div>
    </Dialog>
  );
}
