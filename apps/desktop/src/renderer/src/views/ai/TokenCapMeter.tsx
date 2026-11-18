import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { ProgressBar } from '../../components/Progress';
import { useCapActions } from './tokenCap';
import { useTokenUsage } from './useTokenUsage';
import './tokenCap.css';

/** Always on (once a library is open): the non-blocking warning at `warnAtPct`, and the notification of a bulk job stopped by the cap. */
function Watcher() {
  const { t, i18n } = useTranslation();
  const notify = useNotify();
  const actions = useCapActions();
  const live = useRef({ t, notify, actions, lang: i18n.language });
  live.current = { t, notify, actions, lang: i18n.language };
  useEffect(() => {
    const seen = new Set<string>();
    const offUsage = rl.on('ai:usageChanged', (u) => {
      if (u.crossedWarn) live.current.notify.info(live.current.t('tokenCap.warn', { pct: u.warnAtPct, tokens: new Intl.NumberFormat(live.current.lang).format(u.monthTokens) }));
    });
    const offJobs = rl.on('jobs:progress', (s) => {
      if (s.state !== 'failed' || s.error?.code !== 'AI_TOKEN_CAP_REACHED' || seen.has(s.jobId)) return;
      seen.add(s.jobId);
      void rl.invoke('ai:tokenUsage', {}).then((u) => {
        const l = live.current;
        l.notify.info(l.t('tokenCap.refusedJob', { cap: new Intl.NumberFormat(l.lang).format(u.tokenCap ?? 0) }), l.actions(() => void rl.invoke('jobs:restart', { jobId: s.jobId }).catch((e) => l.notify.reportError(e))));
      }, () => {});
    });
    return () => {
      offUsage();
      offJobs();
    };
  }, []);
  return null;
}

/** Compact meter in the header of the Claude panel: text and a thin bar (no new control in the top bar). */
function Meter() {
  const { t, i18n } = useTranslation();
  const u = useTokenUsage();
  if (!u) return null;
  const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 });
  const full = new Intl.NumberFormat(i18n.language);
  const text = u.tokenCap === null ? t('tokenCap.meterNone', { used: compact.format(u.monthTokens) }) : t('tokenCap.meter', { used: compact.format(u.monthTokens), cap: compact.format(u.tokenCap), pct: u.pct });
  return (
    <span className="token-meter" data-testid="token-meter" data-level={u.pct !== null && u.pct >= 100 ? 'over' : u.pct !== null && u.pct >= u.warnAtPct ? 'warn' : undefined} title={t('tokenCap.title', { used: full.format(u.monthTokens) })}>
      <span className="token-meter__text">{text}</span>
      {u.tokenCap !== null && <ProgressBar className="token-meter__bar" value={u.monthTokens / u.tokenCap} label={t('tokenCap.label')} />}
    </span>
  );
}

/** The meter in the header of the Claude panel and, with it, the watcher (one lazy chunk, mounted once a library is open). */
export default function TokenCapMeter() {
  return (
    <>
      <Watcher />
      <Meter />
    </>
  );
}
