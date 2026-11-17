import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_LIMITS, type Channels, type ReasoningLevel, type ResponseOf } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { formatTokens, formatUsd } from '../chat/format';
import { safeText } from '../library/safeText';
import { aiErrorText } from './aiErrors';
import { useAiAvailability } from './useAiAvailability';

type Preview = ResponseOf<Channels, 'ai:preview'>;

const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];
/** Characters added to the request for the system prompt, the fixed instruction and typical search results (approximate). */
export const SEARCH_ALLOWANCE_CHARS = 12_000;

/**
 * The advanced search of the library ("Ask Claude"): the request, model and reasoning, an approximate estimate of the
 * input size and cost (`ai:preview`, nothing is sent), then "Search" hands the request to the chat panel, which runs it as
 * a new conversation and streams the answer. No document content goes with the request itself. When the AI cannot be used
 * the dialog says why and does not search; the normal search is not involved.
 */
export function AdvancedSearchDialog({ initialText, onClose }: { initialText: string; onClose(): void }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const ui = useAiUi();
  const availability = useAiAvailability();
  const ids = { text: useId(), model: useId(), reasoning: useId() };
  const models = config?.ai.models ?? [];
  const [text, setText] = useState(initialText);
  const [modelChoice, setModel] = useState<string | null>(null);
  const [reasoningChoice, setReasoning] = useState<ReasoningLevel | null>(null);
  const model = modelChoice ?? config?.ai.defaultModel ?? models[0]?.id ?? '';
  const reasoning = reasoningChoice ?? config?.ai.defaultReasoning ?? 'low';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ticket = useRef(0);

  const trimmed = text.trim();
  const unavailable = availability.reason;

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (unavailable !== null || availability.loading || trimmed === '' || model === '') return;
    const mine = ++ticket.current;
    const timer = setTimeout(() => {
      rl.invoke('ai:preview', { purpose: 'search', model, docIds: [], promptChars: trimmed.length + SEARCH_ALLOWANCE_CHARS }).then(
        (p) => mine === ticket.current && setPreview(p),
        (e: unknown) => mine === ticket.current && setError(e),
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [unavailable, availability.loading, trimmed, model]);

  const busy = ui.chatBusy;
  const canSearch = !busy && !availability.loading && unavailable === null && trimmed !== '' && model !== '' && !preview?.overCap;
  const go = () => {
    if (!canSearch) return;
    ui.startSearch({ text: trimmed, model, reasoning });
    onClose();
  };

  return (
    <Dialog title={t('advSearch.title')} onClose={onClose} testId="adv-search-dialog">
      <div className="dialog-body">
        <p>{t('advSearch.intro')}</p>
        {unavailable !== null && (
          <div className="callout" role="status" data-testid="adv-search-unavailable" data-reason={unavailable}>
            <p>{unavailable === 'no-folders' ? t('chat.noFolders') : t(`chat.unavailable.${unavailable}`)}</p>
            <p className="hint">{unavailable === 'no-folders' ? t('advSearch.fix_no-folders') : t(`chat.unavailable.fix_${unavailable}`)}</p>
            {(unavailable === 'no-access' || unavailable === 'cap-reached' || unavailable === 'no-folders') && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  ui.openSettings();
                  onClose();
                }}
              >
                {t('chat.openSettings')}
              </button>
            )}
          </div>
        )}
        {busy && (
          <div className="callout" role="status" data-testid="adv-search-busy">
            <p>{t('chat.errors.turnRunning')}</p>
          </div>
        )}
        <div className="field">
          <label htmlFor={ids.text}>{t('advSearch.text')}</label>
          <textarea id={ids.text} rows={3} value={text} maxLength={AI_LIMITS.message} placeholder={t('advSearch.placeholder')} onChange={(e) => setText(e.target.value)} data-testid="adv-search-text" />
        </div>
        <div className="two-col">
          <div className="field">
            <label htmlFor={ids.model}>{t('chat.model')}</label>
            <select id={ids.model} value={model} onChange={(e) => setModel(e.target.value)} data-testid="adv-search-model">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.reasoning}>{t('chat.reasoning')}</label>
            <select id={ids.reasoning} value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningLevel)} data-testid="adv-search-reasoning">
              {REASONING.map((r) => (
                <option key={r} value={r}>
                  {t(`settings.library.reasoning${r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {unavailable === null && (
          <section className="group" aria-live="polite" data-testid="adv-search-estimate">
            {preview ? (
              <>
                <p>
                  {t('chat.preview.tokens', { tokens: formatTokens(preview.approxInputTokens) })} ·{' '}
                  {preview.estimatedUsd === null ? t('chat.preview.noPrice') : t('chat.preview.cost', { usd: formatUsd(preview.estimatedUsd) })}
                </p>
                <p data-testid="adv-search-model-line">{t('advSearch.sentTo', { model: models.find((m) => m.id === preview.model)?.label || preview.model })}</p>
                {preview.folders.length > 0 && (
                  <p data-testid="adv-search-folders">
                    {t('advSearch.folders')} {preview.folders.map((f) => safeText(f || '/')).join(', ')}
                  </p>
                )}
                <p className="hint">{t('advSearch.estimateNote')}</p>
                {preview.overCap && <ErrorNote testId="adv-search-over-cap">{t('chat.errors.cap')}</ErrorNote>}
              </>
            ) : error ? (
              <ErrorNote testId="adv-search-error">{aiErrorText(error, t)}</ErrorNote>
            ) : (
              <p className="hint">{trimmed === '' ? t('advSearch.needText') : t('common.loading')}</p>
            )}
          </section>
        )}
      </div>
      <div className="actions">
        <button type="button" onClick={onClose} data-testid="adv-search-cancel">
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" onClick={go} disabled={!canSearch} data-testid="adv-search-go">
          {t('advSearch.go')}
        </button>
      </div>
    </Dialog>
  );
}
