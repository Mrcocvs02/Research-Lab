import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiUi } from '../../lib/aiUi';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';

export interface CapAction {
  label: string;
  run(): void;
}

/** New cap: the larger of the cap and the tokens used, times `factor` (the request refused would otherwise still not fit). */
async function raise(factor: number) {
  const u = await rl.invoke('ai:tokenUsage', {});
  return rl.invoke('ai:setTokenCap', { monthlyTokens: Math.min(1e12, Math.ceil(Math.max(u.tokenCap ?? 0, u.monthTokens) * factor)) });
}

/**
 * The actions of the notification "request not run: monthly token cap reached" (D-442): +25 %, double, "Set…" (the row in
 * Settings). After a raise a notice offers `retry` (re-send the chat message, restart the job) when there is one.
 */
export function useCapActions(): (retry?: () => void) => CapAction[] {
  const { t, i18n } = useTranslation();
  const notify = useNotify();
  const { goTo } = useAiUi();
  return useCallback(
    (retry) => {
      const bump = (f: number) => () =>
        void raise(f).then(
          (u) => notify.info(t('tokenCap.raised', { cap: new Intl.NumberFormat(i18n.language).format(u.tokenCap ?? 0) }), retry ? { label: t('tokenCap.retry'), run: retry } : undefined),
          (e) => notify.reportError(e),
        );
      return [
        { label: t('tokenCap.plus25'), run: bump(1.25) },
        { label: t('tokenCap.double'), run: bump(2) },
        { label: t('tokenCap.set'), run: () => goTo('settings', { focus: 'tokenCap' }) },
      ];
    },
    [t, i18n.language, notify, goTo],
  );
}
