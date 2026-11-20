import { useTranslation } from 'react-i18next';
import type { TagAutoMode, TagAutoState } from '@rl/core';
import { rl } from '../../../lib/rl';
import { safeText } from '../safeText';
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
  const undoHaiku = async () => {
    if (!auto.haiku) return;
    await undo(auto.haiku.changeId);
    await run(() => rl.invoke('tagReview:setAuto', { dismiss: true }));
  };
  return (
    <div className="tag-review__auto" data-testid="tag-review-auto">
      <label>
        {t('tax.auto.label')}{' '}
        <select value={auto.mode} onChange={(e) => void set(e.target.value as TagAutoMode)} data-testid="tag-review-auto-mode">
          {(['off', 'sure', 'sureHaiku', 'all'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`tax.auto.mode.${m}`)}
            </option>
          ))}
        </select>
      </label>
      {auto.mode === 'sureHaiku' && <span className="hint">{t('tax.haiku.autoHint')}</span>}
      {auto.haiku && (
        <details className="tag-review__haiku" data-testid="tag-haiku-batch">
          <summary>{t('tax.haiku.batch', { count: auto.haiku.items.length })}</summary>
          <ul>
            {auto.haiku.items.map((it, i) => (
              <li key={i} data-testid="tag-haiku-item" data-kind={it.kind}>
                <b>{t('tax.haiku.decided')}</b> · {t(`tax.haiku.kind.${it.kind}`, { a: safeText(it.labels[0] ?? ''), b: safeText(it.labels[1] ?? '') })} — {safeText(it.note)}
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => void undoHaiku()} data-testid="tag-haiku-undo">
            {t('tax.review.undo')}
          </button>
        </details>
      )}
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
