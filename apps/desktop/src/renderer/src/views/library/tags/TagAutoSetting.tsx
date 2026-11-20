import { useTranslation } from 'react-i18next';
import type { TagAutoMode, TagAutoState } from '@rl/core';
import { rl } from '../../../lib/rl';
import { useTagChange } from './useTagReview';

/** "Accetta automaticamente le proposte" (D-512) and the notice of the last automatic batch with its Undo. */
export function TagAutoSetting({ auto }: { auto: TagAutoState }) {
  const { t } = useTranslation();
  const { run, undo, changed } = useTagChange();
  const set = async (mode: TagAutoMode) => {
    if (await run(() => rl.invoke('tagReview:setAuto', { mode }))) changed();
  };
  const undoLast = async () => {
    if (!auto.last) return;
    await undo(auto.last.changeId);
    await run(() => rl.invoke('tagReview:setAuto', { dismiss: true }));
  };
  return (
    <div className="tag-review__auto" data-testid="tag-review-auto">
      <label>
        {t('tax.auto.label')}{' '}
        <select value={auto.mode} onChange={(e) => void set(e.target.value as TagAutoMode)} data-testid="tag-review-auto-mode">
          {(['off', 'sure', 'all'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`tax.auto.mode.${m}`)}
            </option>
          ))}
        </select>
      </label>
      {auto.last && (
        <span className="hint" data-testid="tag-review-auto-notice">
          {t('tax.auto.notice', { count: auto.last.n })} ·{' '}
          <button type="button" className="link" onClick={() => void undoLast()} data-testid="tag-review-auto-undo">
            {t('tax.review.undo')}
          </button>
        </span>
      )}
    </div>
  );
}
