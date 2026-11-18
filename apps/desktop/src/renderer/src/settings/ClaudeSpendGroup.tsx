import { useTranslation } from 'react-i18next';
import { useApp } from '../state/app-context';
import { TextRow, useLibraryPatch } from './rows';

/** `''` = none (null); digits (spaces, dots, commas and apostrophes allowed as separators) = tokens; anything else is invalid (undefined). */
export const parseTokens = (v: string, min: number, max: number): number | null | undefined => {
  const s = v.replace(/[\s.,']/g, '');
  if (s === '') return null;
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  return n >= min && n <= max ? n : undefined;
};

/**
 * Two rows of Settings › Claude › Spending (D-416): the size above which a send shows the cost dialog (default 5 000 tokens)
 * and the cap of tokens per day (empty: no cap), after which the dialog offers less text or the cheapest model.
 */
export function ClaudeSpendGroup() {
  const { t } = useTranslation();
  const config = useApp().config;
  const patch = useLibraryPatch();
  if (!config) return null;
  return (
    <>
      <TextRow
        sid="costThreshold"
        label={t('settings.claude.costThreshold')}
        help={t('settings.claude.costThresholdHelp')}
        short
        inputMode="numeric"
        testId="ai-cost-threshold"
        value={String(config.ai.costThresholdTokens)}
        validate={(v) => (parseTokens(v, 100, 10_000_000) == null ? t('validation.tokenCap') : undefined)}
        commit={(v) => patch({ ai: { costThresholdTokens: parseTokens(v, 100, 10_000_000) ?? 5000 } })}
      />
      <TextRow
        sid="dailyTokenCap"
        label={t('settings.claude.dailyCap')}
        help={t('settings.claude.dailyCapHelp')}
        short
        inputMode="numeric"
        testId="ai-daily-cap"
        value={config.ai.dailyTokenCap === null ? '' : String(config.ai.dailyTokenCap)}
        validate={(v) => (parseTokens(v, 1, 1e12) === undefined ? t('validation.tokenCap') : undefined)}
        commit={(v) => patch({ ai: { dailyTokenCap: parseTokens(v, 1, 1e12) ?? null } })}
      />
    </>
  );
}
