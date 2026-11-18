import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, McpStatus, ResponseOf } from '@rl/core';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { KeyValue } from '../components/KeyValue';
import { Switch } from '../components/Switch';
import { ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { RlError } from '../lib/rl-error';
import { useApp } from '../state/app-context';
import { safeText } from '../views/library/safeText';
import { Row } from './rows';
import '../views/export/export.css';
import './settings.css';

type LogPage = ResponseOf<Channels, 'mcp:log'>;
const PAGE = 25;
const PORT_MIN = 1024;
const PORT_MAX = 65535;

/** What the server could not do, in words the user can act on (`error.code` of the status). */
function problemKey(code: string): string {
  return code === 'PORT_IN_USE' || code === 'SECRET_UNAVAILABLE' ? code : 'OTHER';
}

/** `stamp` changes with every counted call, also once the log is full (the count then stays at its cap). */
function CallLog({ stamp }: { stamp: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<LogPage['items']>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const loaded = useRef(0);
  loaded.current = items.length;

  const load = useCallback(async (offset: number) => {
    setError(null);
    try {
      const r = await rl.invoke('mcp:log', { limit: PAGE, offset });
      setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items]));
      setTotal(r.total);
    } catch (e) {
      setError(e);
    }
  }, []);
  // The first page again whenever the server counted calls (the status event comes at most every 2 s).
  useEffect(() => {
    void load(0);
  }, [load, stamp]);

  return (
    <details data-testid="mcp-log" data-set="mcpLog">
      <summary>{t('mcp.log.title')}</summary>
      <p className="set-help">{t('mcp.log.hint')}</p>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {items.length === 0 && !error && <p className="hint">{t('mcp.log.empty')}</p>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th scope="col">{t('mcp.log.when')}</th>
                <th scope="col">{t('mcp.log.tool')}</th>
                <th scope="col">{t('mcp.log.outcome')}</th>
                <th scope="col">{t('mcp.log.ms')}</th>
                <th scope="col">{t('mcp.log.docs')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, k) => (
                <tr key={`${i.at}-${k}`} data-testid="mcp-log-row">
                  <td>{new Date(i.at).toLocaleString(i18n.language)}</td>
                  <td>
                    <code>{safeText(i.tool)}</code>
                  </td>
                  <td>{i.ok ? t('mcp.log.ok') : t('mcp.log.failed', { code: safeText(i.code ?? '?') })}</td>
                  <td>{i.ms}</td>
                  <td>{i.docIds.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length < total && (
        <div className="actions start">
          <button type="button" onClick={() => void load(loaded.current)} data-testid="mcp-log-more">
            {t('mcp.log.more', { shown: items.length, total })}
          </button>
        </div>
      )}
    </details>
  );
}

/**
 * MCP server settings (lazy chunk): the server for Claude Code on this library. Status and errors come from `mcp:status`
 * and stay current through `mcp:changed`; the token never reaches this window (the main process copies the line for
 * Claude Code to the clipboard and only a masked preview comes back).
 */
export function McpSection({ embedded = false }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const [fresh, setFresh] = useState<string[] | null>(null);
  const aiFolders = fresh ?? app.config?.aiEnabledFolders ?? [];
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askWrite, setAskWrite] = useState(false);
  const [askRotate, setAskRotate] = useState(false);
  const [copied, setCopied] = useState<{ format: 'cli' | 'json'; preview: string } | null>(null);
  const [rotated, setRotated] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [port, setPort] = useState('');

  useEffect(() => {
    setStatus(null);
    setCopied(null);
    setAskWrite(false);
    setAskRotate(false);
    setRotated(false);
    setFresh(null);
    if (!libraryId) return;
    let live = true;
    // The AI folders are read here too: they can change elsewhere while this page is open.
    const folders = () => void rl.invoke('library:getConfig', {}).then((c) => live && setFresh(c.aiEnabledFolders), () => {});
    folders();
    rl.invoke('mcp:status', {}).then(
      (s) => live && setStatus(s),
      (e: unknown) => live && setError(e),
    );
    const off = rl.on('mcp:changed', (s) => {
      if (!live) return;
      setStatus(s);
      folders();
    });
    return () => {
      live = false;
      off();
    };
  }, [libraryId]);

  // The field shows the port in use; typing is kept until the status changes.
  useEffect(() => {
    if (status) setPort(status.port === null ? '' : String(status.port));
  }, [status?.port]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<McpStatus | void>) => {
    setError(null);
    setBusy(true);
    try {
      const s = await fn();
      if (s) setStatus(s);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!libraryId) {
    return (
      <section className={embedded ? undefined : 'card set-group'}>
        {!embedded && <h2 id="settings-mcp">{t('mcp.title')}</h2>}
        <p className="set-help">{t('settings.needsLibrary')}</p>
      </section>
    );
  }

  const portNumber = port.trim() === '' ? null : Number(port);
  const portValid = portNumber === null || (Number.isInteger(portNumber) && portNumber >= PORT_MIN && portNumber <= PORT_MAX);
  const portChanged = status !== null && portNumber !== status.port;
  const problem = status?.enabled && !status.running ? status.error : null;

  const copy = async (format: 'cli' | 'json') => {
    setError(null);
    setCopied(null);
    setCopyError(null);
    try {
      const r = await rl.invoke('mcp:copyConfig', { format });
      setCopied({ format, preview: r.preview });
    } catch (e) {
      if (RlError.from(e).code === 'CONFLICT') setCopyError(t('mcp.copy.notRunning'));
      else setError(e);
    }
  };

  const sees = aiFolders.length === 0 ? t('mcp.seesNothing') : aiFolders.includes('') ? t('mcp.seesAll') : t('mcp.seesFolders', { count: aiFolders.length });
  const Wrap = embedded ? 'div' : 'section';

  return (
    <Wrap className={embedded ? undefined : 'card set-group'} data-testid="mcp-settings">
      {!embedded && <h2 id="settings-mcp">{t('mcp.title')}</h2>}
      <p className="set-help">{t('mcp.intro')}</p>
      <p className={aiFolders.length === 0 ? 'callout' : 'set-help'} data-testid="mcp-sees">
        {sees}
      </p>

      {!status && !error && <p className="hint">{t('common.loading')}</p>}
      {status && (
        <>
          <Row sid="mcpEnable" label={t('mcp.enable')} help={t('mcp.enableHint')}>
            <Switch aria-label={t('mcp.enable')} checked={status.enabled} disabled={busy} onChange={(v) => void run(() => rl.invoke('mcp:setEnabled', { enabled: v }))} data-testid="mcp-enable" />
          </Row>
          <div data-testid="mcp-status" data-running={status.running ? 'true' : 'false'}>
            <KeyValue
              items={[
                { label: t('mcp.status.label'), value: <span className={status.running ? 'badge ok' : 'badge'} data-testid="mcp-state">{status.running ? t('mcp.status.running') : status.enabled ? t('mcp.status.failed') : t('mcp.status.off')}</span> },
                ...(status.running && status.url ? [{ label: t('mcp.status.address'), value: <code data-testid="mcp-url">{status.url}</code> }] : []),
                { label: t('mcp.status.calls'), value: <span data-testid="mcp-calls">{status.lastCallAt ? t('mcp.status.callsLast', { count: status.calls, when: new Date(status.lastCallAt).toLocaleString(i18n.language) }) : t('mcp.status.callsCount', { count: status.calls })}</span> },
              ]}
            />
          </div>
          {problem && (
            <div data-testid="mcp-problem" data-code={problem.code}>
              <Banner tone="warning" action={problemKey(problem.code) === 'PORT_IN_USE' ? { label: t('mcp.port.useAuto'), onClick: () => void run(() => rl.invoke('mcp:setPort', { port: null })) } : undefined}>
                <strong>{t(`mcp.problem.${problemKey(problem.code)}.title`)}</strong> {t(`mcp.problem.${problemKey(problem.code)}.what`, { port: status.port ?? '' })}
                {problemKey(problem.code) === 'OTHER' && <> {safeText(problem.message)}</>}
              </Banner>
            </div>
          )}
          {status.enabled && status.tools.length > 0 && (
            <details data-testid="mcp-tools">
              <summary>{t('mcp.toolsTitle')}</summary>
              <p className="set-help">{t('mcp.tools', { list: status.tools.join(', ') })}</p>
            </details>
          )}

          <div data-testid="mcp-write-group">
            <Row sid="mcpWrite" label={t('mcp.write.label')}>
              <Switch
                aria-label={t('mcp.write.label')}
                checked={status.writeEnabled}
                disabled={busy || !status.enabled}
                onChange={(v) => {
                  if (v) setAskWrite(true);
                  else {
                    setAskWrite(false);
                    void run(() => rl.invoke('mcp:setWriteEnabled', { writeEnabled: false }));
                  }
                }}
                data-testid="mcp-write"
              />
            </Row>
            <p className="set-help" data-testid="mcp-write-warning">
              {t('mcp.write.warning')} {t('mcp.write.reconnect')}
            </p>
            {askWrite && !status.writeEnabled && (
              <div className="callout warn" role="alertdialog" aria-label={t('mcp.write.confirmTitle')} data-testid="mcp-write-confirm">
                <p>
                  <strong>{t('mcp.write.confirmTitle')}</strong>
                </p>
                <p>{t('mcp.write.confirmBody')}</p>
                <div className="actions start">
                  <Button
                    variant="danger"
                    onClick={() => {
                      setAskWrite(false);
                      void run(() => rl.invoke('mcp:setWriteEnabled', { writeEnabled: true }));
                    }}
                    data-testid="mcp-write-yes"
                  >
                    {t('mcp.write.confirmYes')}
                  </Button>
                  <Button onClick={() => setAskWrite(false)}>{t('common.cancel')}</Button>
                </div>
              </div>
            )}
          </div>

          <div data-testid="mcp-port-group">
            <Row sid="mcpPort" label={t('mcp.port.label')} help={t('mcp.port.hint', { min: PORT_MIN, max: PORT_MAX })} htmlFor="mcp-port" error={portValid ? undefined : t('mcp.port.invalid', { min: PORT_MIN, max: PORT_MAX })}>
              <input id="mcp-port" className="is-short" inputMode="numeric" value={port} placeholder={t('mcp.port.auto')} onChange={(e) => setPort(e.target.value)} data-testid="mcp-port" />
              <Button size="sm" disabled={busy || !portValid || !portChanged} onClick={() => void run(() => rl.invoke('mcp:setPort', { port: portNumber }))} data-testid="mcp-port-apply">
                {portNumber === null ? t('mcp.port.useAuto') : t('mcp.port.apply')}
              </Button>
            </Row>
            <p className="set-help" data-testid="mcp-port-squat">
              {t('mcp.port.squat')}
            </p>
          </div>

          <div data-testid="mcp-copy-group">
            <Row sid="mcpCopy" label={t('mcp.copy.title')} help={t('mcp.copy.hint')}>
              <Button size="sm" disabled={!status.running} onClick={() => void copy('cli')} data-testid="mcp-copy-cli">
                {t('mcp.copy.cli')}
              </Button>
              <Button size="sm" disabled={!status.running} onClick={() => void copy('json')} data-testid="mcp-copy-json">
                {t('mcp.copy.json')}
              </Button>
            </Row>
            <p className="set-help" data-testid="mcp-json-warning">
              {t('mcp.copy.jsonWarning')}
            </p>
            {!status.running && <p className="set-help">{t('mcp.copy.notRunning')}</p>}
            {copyError && <ErrorNote testId="mcp-copy-error">{copyError}</ErrorNote>}
            {copied && (
              <div role="status" data-testid="mcp-copied">
                <p>{t('mcp.copy.done', { format: t(`mcp.copy.${copied.format}`) })}</p>
                <code data-testid="mcp-preview">{copied.preview}</code>
              </div>
            )}
          </div>

          <div data-testid="mcp-rotate-group">
            <Row sid="mcpRotate" label={t('mcp.rotate.title')} help={t('mcp.rotate.hint')}>
              <Button size="sm" disabled={busy || !status.enabled} onClick={() => setAskRotate(true)} data-testid="mcp-rotate">
                {t('mcp.rotate.button')}
              </Button>
            </Row>
            {askRotate && (
              <div className="callout warn" role="alertdialog" aria-label={t('mcp.rotate.confirmTitle')} data-testid="mcp-rotate-confirm">
                <p>
                  <strong>{t('mcp.rotate.confirmTitle')}</strong>
                </p>
                <p>{t('mcp.rotate.confirmBody')}</p>
                <div className="actions start">
                  <Button
                    variant="danger"
                    onClick={() => {
                      setAskRotate(false);
                      setCopied(null);
                      void run(async () => {
                        const s = await rl.invoke('mcp:rotateToken', {});
                        setRotated(true);
                        return s;
                      });
                    }}
                    data-testid="mcp-rotate-yes"
                  >
                    {t('mcp.rotate.confirmYes')}
                  </Button>
                  <Button onClick={() => setAskRotate(false)}>{t('common.cancel')}</Button>
                </div>
              </div>
            )}
            {rotated && (
              <p className="callout" role="status" data-testid="mcp-rotated">
                {t('mcp.rotate.done')}
              </p>
            )}
          </div>
        </>
      )}
      {error ? <ErrorNote testId="mcp-error">{errorMessage(error, t)}</ErrorNote> : null}
      {status && <CallLog stamp={`${status.calls}|${status.lastCallAt ?? ''}`} />}
    </Wrap>
  );
}
