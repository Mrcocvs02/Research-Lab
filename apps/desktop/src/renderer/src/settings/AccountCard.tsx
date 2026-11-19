import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiAccount, AiAuthMode, ResponseOf, Channels } from '@rl/core';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { IconButton } from '../components/IconButton';
import { IconMore } from '../components/icons';
import { Menu } from '../components/Menu';
import { Segmented } from '../components/Segmented';
import { Spinner } from '../components/Progress';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { Row, useSettings } from './rows';
import { SecretControl } from './SavedKeys';
import { TokenCapRow } from './TokenCapRow';
import { useAutoSave } from './useAutoSave';

/** What "usage of the month" shows: the active library (the unit of the cap, D-330) or, with `'all'`, the total of every library at once. The "all libraries" button works in both cases. */
export const ACCOUNT_USAGE_SCOPE: 'library' | 'all' = 'library';

type Usage = ResponseOf<Channels, 'ai:usage'>;
type UsageAll = ResponseOf<Channels, 'ai:usageAll'>;
type Test = ResponseOf<Channels, 'ai:test'>;

/** Tone of the status dot (4.7): connected, connected with a warning (a key that is saved but not used), not connected. */
export function accountTone(a: AiAccount): 'ok' | 'warn' | 'bad' {
  if (a.effective === 'none') return 'bad';
  return a.authMode === 'claude-code' && a.apiKey.stored ? 'warn' : 'ok';
}

function Usage({ account }: { account: AiAccount }) {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [all, setAll] = useState<UsageAll | null>(null);
  const [error, setError] = useState<unknown>(null);
  const libraryId = app.activeLibraryId;
  const money = (n: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' }).format(n);
  const loadAll = () => {
    setError(null);
    rl.invoke('ai:usageAll', {}).then(setAll, setError);
  };
  useEffect(() => {
    setUsage(null);
    if (libraryId) rl.invoke('ai:usage', {}).then(setUsage, () => {});
    if (ACCOUNT_USAGE_SCOPE === 'all') loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, account.effective]);
  const cap = app.config?.ai.usageCap.monthlyUsd ?? null;
  const ratio = usage && cap ? usage.usd / cap : 0;
  const unreachable = all ? all.libraries.filter((l) => !l.reachable).length : 0;
  const shown = ACCOUNT_USAGE_SCOPE === 'all' && all ? { usd: all.totalUsd, sends: all.sends } : usage;
  return (
    <Row sid="usage" label={t('settings.account.usage')} help={ACCOUNT_USAGE_SCOPE === 'all' || !app.activeProfile ? undefined : t('settings.account.usageLibrary', { name: app.activeProfile.name })}>
      <div className="acct__usage" data-testid="ai-usage">
        {shown ? (
          <span className="num">
            {cap ? t('settings.account.usageOf', { usd: money(shown.usd), cap: money(cap) }) : money(shown.usd)}
            {' · '}
            {t('settings.account.sends', { count: shown.sends })}
          </span>
        ) : (
          <span className="muted">{libraryId ? t('common.loading') : t('settings.needsLibrary')}</span>
        )}
        {cap && usage && (
          <span className="set-meter" data-level={ratio >= 1 ? 'over' : ratio > 0.8 ? 'warn' : undefined} role="img" aria-label={`${Math.round(ratio * 100)}%`}>
            <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
        )}
        {ACCOUNT_USAGE_SCOPE === 'library' && (
          <button type="button" className="link" onClick={loadAll} data-testid="ai-usage-all">
            {t('settings.account.usageAll')}
          </button>
        )}
      </div>
      {all && (
        <p className="set-help" data-testid="ai-usage-all-result" role="status">
          {t('settings.account.usageAllResult', { count: all.libraries.length, unreachable, usd: money(all.totalUsd) })}
        </p>
      )}
      {error ? (
        <p className="field-error" role="alert">
          {errorMessage(error, t)}
        </p>
      ) : null}
    </Row>
  );
}

/**
 * The Account card of Claude (4.7, 10.2): how it is connected and as whom, "Test the connection", the mode (Automatic, Claude
 * Code login, API key), "Change account…" (opens the Claude Code window; then "I'm done, check"), the API key and the usage of the month.
 */
export function AccountCard() {
  const { t, i18n } = useTranslation();
  const { account, accountError, reloadAccount, setAccount, goTo } = useSettings();
  const mode = useAutoSave();
  const [test, setTest] = useState<{ busy: boolean; result: Test | 'offline' | null }>({ busy: false, result: null });
  const [askLogin, setAskLogin] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  const [menu, setMenu] = useState(false);
  const [waiting, setWaiting] = useState<{ email: string | null } | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const more = useRef<HTMLSpanElement>(null);

  // The watcher of the login folder (or "I'm done") tells us the account changed: the wait is over.
  const email = account?.claudeCode.account?.email ?? null;
  useEffect(() => {
    if (waiting && account?.claudeCode.loggedIn && email !== waiting.email) {
      setNote({ kind: 'ok', text: t('settings.account.connectedAs', { who: email ?? t('settings.account.unknownAccount') }) });
      setWaiting(null);
    }
  }, [waiting, account, email, t]);

  // W4: the account is read again every time the Claude section is entered, not only when the settings page opens.
  useEffect(() => {
    void reloadAccount();
  }, [reloadAccount]);

  // W3: a test result or a note belongs to the account that was in use; when the account in use changes they are old.
  const effective = account?.effective;
  const authMode = account?.authMode;
  const seen = useRef({ effective, authMode });
  useEffect(() => {
    if (seen.current.effective === effective && seen.current.authMode === authMode) return;
    const modeChanged = seen.current.authMode !== authMode;
    seen.current = { effective, authMode };
    setTest({ busy: false, result: null });
    if (modeChanged || !waiting) setNote(null);
  }, [effective, authMode, waiting]);

  if (!account) {
    return (
      <section className="card set-group" data-testid="ai-account" data-state="loading">
        <p className="muted">{accountError ? errorMessage(accountError, t) : t('common.loading')}</p>
      </section>
    );
  }

  const tone = accountTone(account);
  const cc = account.claudeCode;
  const missing = cc.path === null && account.effective !== 'api-key';
  const state = account.effective === 'claude-code' ? t('settings.account.viaClaudeCode') : account.effective === 'api-key' ? t('settings.account.viaKey') : missing ? t('settings.account.noProgram') : t('settings.account.notConnected');
  const who = [cc.account?.email, cc.account?.plan ? t('settings.account.plan', { plan: cc.account.plan }) : null].filter(Boolean).join(' · ');
  const program = cc.path === null ? null : cc.version ? t('settings.account.programFound', { version: cc.version, where: t(`settings.ai.exe.source_${cc.source}`) }) : t(`settings.ai.exe.source_${cc.source}`);
  // The Claude Code identity is not what is used while the mode is API key: it is shown as "not used", not as the account in use.
  const keyNeeded = account.authMode === 'api-key' && !account.apiKey.stored;
  const identity = account.effective === 'api-key' ? t('settings.account.keyOnly') : account.authMode === 'api-key' && who ? `${who} (${t('settings.account.notUsed')})` : who;
  const sub = [identity, program].filter(Boolean).join(' · ');
  const seconds = (ms: number) => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const runTest = async () => {
    setNote(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setTest({ busy: false, result: 'offline' });
    setTest({ busy: true, result: null });
    try {
      setTest({ busy: false, result: await rl.invoke('ai:test', {}) });
    } catch (e) {
      setTest({ busy: false, result: null });
      setError(e);
    }
  };
  const startLogin = () =>
    guard(async () => {
      await rl.invoke('ai:login', {});
      setAskLogin(false);
      setNote(null);
      setWaiting({ email });
    });
  const verify = () =>
    guard(async () => {
      const next = await rl.invoke('ai:loginDone', {});
      setAccount(next);
      const now = next.claudeCode.account?.email ?? null;
      if (next.claudeCode.loggedIn) {
        setNote({ kind: 'ok', text: t('settings.account.connectedAs', { who: now ?? t('settings.account.unknownAccount') }) });
        setWaiting(null);
      } else setNote({ kind: 'bad', text: t('settings.account.notYet') });
    });
  const logout = () =>
    guard(async () => {
      setAccount(await rl.invoke('ai:logout', {}));
      setAskLogout(false);
      setTest({ busy: false, result: null });
    });
  const result = test.result;
  const modelLabel = typeof result === 'object' && result ? result.model.replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase()) : '';

  return (
    <section className="card set-group acct" data-testid="ai-account" data-state={tone} data-effective={account.effective} data-mode={account.authMode}>
      <div className="acct__top">
        <span className="acct__dot" data-tone={tone === 'bad' ? undefined : tone} aria-hidden="true" />
        <div className="acct__what">
          <p className="acct__state" data-testid="ai-account-state">
            {state}
          </p>
          {sub && (
            <p className="acct__sub" data-testid="ai-account-sub">
              {sub}
            </p>
          )}
          {account.apiKey.stored && account.authMode === 'claude-code' && <p className="acct__sub">{t('settings.account.keyUnused')}</p>}
        </div>
        <div className="acct__test">
          <Button size="sm" busy={test.busy} onClick={() => void runTest()} data-testid="ai-test">
            {test.busy ? t('settings.account.testing') : t('settings.account.test', { cost: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD', minimumFractionDigits: 3 }).format(0.001) })}
          </Button>
          {result && (
            <p className="acct__result" role="status" data-testid="ai-test-result" data-ok={result === 'offline' ? false : result.ok}>
              {result === 'offline' ? t('settings.account.testOffline') : result.ok ? t('settings.account.testOk', { s: seconds(result.ms), model: modelLabel }) : t(`settings.account.testError.${result.error?.code ?? 'error'}`, { defaultValue: t('settings.account.testError.error') })}
            </p>
          )}
        </div>
      </div>

      {missing && (
        <div className="set-help">
          <Button size="sm" onClick={() => goTo('advanced', 'claudeExe')} data-testid="ai-choose-program">
            {t('settings.account.chooseProgram')}
          </Button>
        </div>
      )}

      <Row sid="authMode" label={t('settings.account.use')} help={t(`settings.account.useHelp.${account.authMode}`)} save={mode}>
        <div data-testid="ai-auth-mode">
          <Segmented<AiAuthMode>
            label={t('settings.account.use')}
            options={[
              { value: 'auto', label: t('settings.account.modes.auto') },
              { value: 'claude-code', label: t('settings.account.modes.claude-code') },
              { value: 'api-key', label: t('settings.account.modes.api-key') },
            ]}
            value={account.authMode}
            onChange={(m) => void mode.run(async () => setAccount(await rl.invoke('ai:setAuthMode', { mode: m })))}
          />
        </div>
      </Row>

      {waiting ? (
        <div className="acct__wait" data-testid="ai-login-wait">
          <Spinner />
          <span className="grow">{t(cc.supportsAuthCommands ? 'settings.account.waiting' : 'settings.account.waitingPlain')}</span>
          <Button variant="primary" size="sm" onClick={() => void verify()} data-testid="ai-login-done">
            {t('settings.account.done')}
          </Button>
          <Button size="sm" onClick={() => setWaiting(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <Row sid="account" label={t('settings.account.account')}>
          <Button size="sm" variant={account.effective === 'none' && !missing && !keyNeeded ? 'primary' : 'secondary'} disabled={missing} disabledReason={t('settings.account.noProgram')} onClick={() => setAskLogin(true)} data-testid="ai-change-account">
            {account.claudeCode.loggedIn ? t('settings.account.change') : t('settings.account.login')}
          </Button>
          <span ref={more}>
            <IconButton label={t('settings.account.moreActions')} onClick={() => setMenu(true)} data-testid="ai-account-more">
              <IconMore size={16} />
            </IconButton>
          </span>
          <Menu
            anchor={more}
            open={menu}
            onClose={() => setMenu(false)}
            label={t('settings.account.moreActions')}
            groups={[
              {
                id: 'account',
                items: [
                  { id: 'recheck', label: t('settings.account.recheck'), onSelect: () => void reloadAccount() },
                  cc.loggedIn && cc.supportsAuthCommands
                    ? { id: 'logout', label: t('settings.account.logout'), danger: true, onSelect: () => setAskLogout(true) }
                    : { id: 'logout', label: t('settings.account.logout'), disabled: true, disabledReason: t('settings.account.logoutOff'), onSelect: () => {} },
                ],
              },
            ]}
          />
        </Row>
      )}
      {note && (
        <p className={note.kind === 'ok' ? 'acct__result' : 'field-error'} role="status" data-testid="ai-account-note">
          {note.text}
        </p>
      )}

      <Row sid="secretAnthropic" label={t('settings.keys.names.anthropic-api-key')} help={t('settings.account.keyHelp')}>
        <SecretControl name="anthropic-api-key" scope="app" onChanged={() => void reloadAccount()} primary={keyNeeded} />
      </Row>

      <Usage account={account} />
      <TokenCapRow />

      {error ? (
        <p className="field-error" role="alert" data-testid="ai-account-error">
          {errorMessage(error, t)}
        </p>
      ) : null}

      {askLogin && (
        <Dialog title={t('settings.account.loginTitle')} onClose={() => setAskLogin(false)} testId="ai-login-dialog">
          <p>{t(cc.supportsAuthCommands ? 'settings.account.loginBody' : 'settings.account.loginBodyPlain')}</p>
          <div className="actions">
            <Button onClick={() => setAskLogin(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => void startLogin()} data-testid="ai-login-open">
              {t('settings.account.loginOpen')}
            </Button>
          </div>
        </Dialog>
      )}
      {askLogout && (
        <Dialog title={t('settings.account.logoutTitle')} onClose={() => setAskLogout(false)} testId="ai-logout-dialog">
          <p>{t('settings.account.logoutBody')}</p>
          <div className="actions">
            <Button onClick={() => setAskLogout(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => void logout()} data-testid="ai-logout-yes">
              {t('settings.account.logoutYes')}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
