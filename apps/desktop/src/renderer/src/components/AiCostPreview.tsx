import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { formatTokens } from '../views/chat/format';
import { Dialog } from './Dialog';

/** Money and tokens of the dialog in the language of the app (Intl): "6,2k token" and "0,00 USD" in Italian, "6.2k" and "$0.00" in English. */
function tokensText(n: number, lang: string): string {
  if (n < 1000) return new Intl.NumberFormat(lang).format(n);
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: n < 10_000 ? 1 : 0 }).format(n / 1000)}k`;
}
function usdText(usd: number, lang: string): string {
  const f = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' });
  return usd > 0 && usd < 0.01 ? `<${f.format(0.01)}` : f.format(usd);
}

/**
 * The one rule of cost of every Claude function (D-416, §17.2). The estimate comes from main (`explain:estimate`, and in the
 * same shape from the next functions that adopt it):
 * - under the threshold the estimate sits in the button itself ("✦ Spiega · ≈ 900 token · Haiku") and a click sends;
 * - over the threshold, or the first time the text of a folder is sent, the dialog below shows what goes, how many requests,
 *   the tokens (or the cost with an API key) and the share of the day's cap already used;
 * - past the day's cap nothing is sent: the dialog offers less text or the cheapest model.
 */
export type CostEstimate = ResponseOf<Channels, 'explain:estimate'>;

/** What a click on the button does. */
export type CostGate = 'send' | 'dialog' | 'cap' | 'not-enabled';

export function costGate(e: CostEstimate): CostGate {
  if (!e.folderEnabled) return 'not-enabled';
  if (e.cached) return 'send';
  if (e.overDailyCap) return 'cap';
  return e.needsDialog ? 'dialog' : 'send';
}

/** The text of the button: the action, and the size of the send; a cached request says that nothing is sent. */
export function costLabel(t: TFunction, action: string, e: CostEstimate | null, modelLabel: string): string {
  if (!e) return action;
  if (e.cached) return `${action} · ${t('reader.cost.ready')}`;
  return `${action} · ${t('reader.cost.inButton', { tokens: formatTokens(e.approxTokens), model: modelLabel })}`;
}

/** The share of the day's cap (this send included), as the dialog shows it; `null` without a cap. */
export function dayShareText(t: TFunction, e: CostEstimate): string | null {
  return e.todayPct === null ? null : t('reader.cost.today', { pct: e.todayPct });
}

interface Props {
  /** The function asking ("Comparison table"): the title then says which function wants to send. */
  title?: string;
  /** What goes, in one line ("The selected text and the paragraph around it"). */
  what: string;
  requests: number;
  estimate: CostEstimate;
  modelLabel: string;
  /** The models the user can switch to, cheapest first is the caller's choice; the dialog shows a select when there are several. */
  models: ReadonlyArray<{ id: string; label: string }>;
  model: string;
  onModel(id: string): void;
  onConfirm(): void;
  onCancel(): void;
}

export function AiCostPreview({ title, what, requests, estimate: e, modelLabel, models, model, onModel, onConfirm, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const blocked = e.overDailyCap;
  const day = dayShareText(t, e);
  return (
    <Dialog title={title ? t('reader.cost.titleFor', { name: title }) : t('reader.cost.title')} onClose={onCancel} testId="ai-cost-dialog">
      <div className="dlg-scroll">
        <p data-testid="ai-cost-what">{what}</p>
        <ul className="hint" data-testid="ai-cost-facts">
          <li>{t('reader.cost.requests', { count: requests })}</li>
          <li data-testid="ai-cost-tokens">
            {t('reader.cost.tokens', { tokens: tokensText(e.approxTokens, lang) })} · {e.estimatedUsd === null ? t('reader.cost.noPrice') : t('reader.cost.usd', { usd: usdText(e.estimatedUsd, lang) })}
          </li>
          {day && <li data-testid="ai-cost-today">{day}</li>}
        </ul>
        {e.firstFolderSend && <p className="callout" data-testid="ai-cost-first">{t('reader.cost.first')}</p>}
        {!blocked && e.approxTokens > e.thresholdTokens && <p className="callout" data-testid="ai-cost-over">{t('reader.cost.over', { threshold: tokensText(e.thresholdTokens, lang) })}</p>}
        {blocked && (
          <p className="callout" role="alert" data-testid="ai-cost-cap">
            {t('reader.cost.cap')}
          </p>
        )}
        {models.length > 1 && (
          <div className="field">
            <label htmlFor="ai-cost-model">{t('reader.cost.model')}</label>
            <select id="ai-cost-model" value={model} onChange={(ev) => onModel(ev.target.value)} data-testid="ai-cost-model">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="actions dlg-foot">
        <button type="button" onClick={onCancel} data-testid="ai-cost-cancel">
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" disabled={blocked} onClick={onConfirm} data-testid="ai-cost-confirm">
          {t('reader.cost.send', { model: modelLabel })}
        </button>
      </div>
    </Dialog>
  );
}
