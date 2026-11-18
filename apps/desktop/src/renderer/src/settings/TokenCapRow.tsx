import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from '../components/Progress';
import { rl } from '../lib/rl';
import { useTokenUsage } from '../views/ai/useTokenUsage';
import { Row } from './rows';
import { useAutoText } from './useAutoSave';

const PRESETS = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const MAX = 1e12;

/** `''` = no cap; digits (with spaces, dots or commas as separators) = tokens; anything else is invalid (undefined). */
const parse = (v: string): number | null | undefined => {
  const s = v.replace(/[\s.,']/g, '');
  if (s === '') return null;
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  return n >= 1 && n <= MAX ? n : undefined;
};

/** Tokens of the month against the cap of the app (D-442): the figure, a bar and the editable cap (saved by itself, like the other settings). */
export function TokenCapRow() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const u = useTokenUsage();
  const fmt = new Intl.NumberFormat(i18n.language);
  const a = useAutoText(
    u?.tokenCap == null ? '' : String(u.tokenCap),
    async (v) => void (await rl.invoke('ai:setTokenCap', { monthlyTokens: parse(v) ?? null })),
    (v) => (parse(v) === undefined ? t('validation.tokenCap') : undefined),
  );
  const pick = (n: number | null) => {
    a.change(n === null ? '' : String(n));
    a.flush();
  };
  return (
    <Row sid="tokenCap" label={t('settings.account.tokenMonth')} help={t('settings.account.tokenHelp')} htmlFor={id} save={a.save} error={a.problem}>
      <div className="acct__usage" data-testid="token-usage">
        {u ? (
          <span className="num" data-testid="token-usage-text">
            {u.tokenCap === null ? t('settings.account.tokenUsedNoCap', { used: fmt.format(u.monthTokens) }) : t('settings.account.tokenOf', { used: fmt.format(u.monthTokens), cap: fmt.format(u.tokenCap), pct: u.pct })}
          </span>
        ) : (
          <span className="muted">{t('common.loading')}</span>
        )}
      </div>
      {u?.tokenCap != null && <ProgressBar value={u.monthTokens / u.tokenCap} label={t('settings.account.tokenMonth')} />}
      <div className="acct__usage">
        <input id={id} className="is-short" inputMode="numeric" value={a.draft} placeholder={t('settings.account.tokenNoCap')} aria-invalid={a.problem ? true : undefined} data-testid="token-cap-input" onChange={(e) => a.change(e.target.value)} onBlur={a.flush} />
        {PRESETS.map((n) => (
          <button key={n} type="button" className="link" onClick={() => pick(n)} data-testid={`token-cap-preset-${n}`}>
            {new Intl.NumberFormat(i18n.language, { notation: 'compact' }).format(n)}
          </button>
        ))}
        <button type="button" className="link" onClick={() => pick(null)} data-testid="token-cap-none">
          {t('settings.account.tokenNoCap')}
        </button>
      </div>
    </Row>
  );
}
