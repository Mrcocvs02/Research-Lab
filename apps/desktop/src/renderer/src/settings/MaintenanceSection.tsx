import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAINTENANCE_TARGETS, type Channels, type ResponseOf } from '@rl/core';
import { CheckField, ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { RlError } from '../lib/rl-error';
import { useApp } from '../state/app-context';
import { formatSize } from '../views/library/formatSize';
import './backup.css';

type Report = ResponseOf<Channels, 'maintenance:report'>;

/** Regenerable data that `maintenance:clean` may delete, in the order shown (labels: `maintenance.targets.<id>`). */
type MaintenanceTarget = (typeof MAINTENANCE_TARGETS)[number];
const TARGETS: readonly MaintenanceTarget[] = MAINTENANCE_TARGETS;

/**
 * Maintenance and performance (D-258): sizes of the data of the active library and of the logs, a snapshot of the app
 * process, cleaning of the regenerable data only, the log folder, and the diagnostics text for a bug report (it is
 * shown here as well as copied, so the user sees what would be shared: no paths, titles or keys).
 */
export function MaintenanceSection() {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const headId = useId();
  const [report, setReport] = useState<Report | null>(null);
  const [picked, setPicked] = useState<Set<MaintenanceTarget>>(() => new Set(TARGETS));
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const libraryId = app.activeLibraryId;

  const load = useCallback(async () => {
    try {
      setReport(await rl.invoke('maintenance:report', {}));
    } catch (e) {
      setReport(null);
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, libraryId]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const clean = () =>
    run(async () => {
      const targets = TARGETS.filter((x) => picked.has(x));
      if (targets.length === 0) return;
      const r = await rl.invoke('maintenance:clean', { targets });
      setNote(t('maintenance.cleaned', { size: formatSize(r.freedBytes) }));
      await load();
    });
  const copy = () =>
    run(async () => {
      const r = await rl.invoke('maintenance:copyDiagnostics', {});
      setDiagnostics(r.text);
      setNote(t('maintenance.copied'));
    });

  const n = (v: number) => v.toLocaleString(i18n.language);
  const message = (e: unknown) => (RlError.from(e).code === 'CONFLICT' ? t('maintenance.busy') : errorMessage(e, t));
  const sizeRows: Array<[string, string]> = report
    ? [
        ['documents', n(report.documents)],
        ['data', formatSize(report.dataBytes)],
        ['index', formatSize(report.local.index)],
        ['cache', formatSize(report.local.cache)],
        ['thumbs', formatSize(report.local.thumbs)],
        ['graph', formatSize(report.local.graph)],
        ['chats', formatSize(report.local.chats)],
        ['logs', formatSize(report.logsBytes)],
      ]
    : [];

  return (
    <section className="card" aria-labelledby={headId} data-testid="maintenance-section">
      <h2 id={headId}>{t('maintenance.title')}</h2>
      <p className="hint">{t('maintenance.intro')}</p>

      <div className="group">
        <h3>{t('maintenance.sizes')}</h3>
        {report ? (
          <dl className="kv" data-testid="maintenance-report">
            {sizeRows.map(([k, v]) => (
              <div key={k} className="fact-row">
                <dt>{t(`maintenance.rows.${k}`)}</dt>
                <dd data-testid={`maintenance-${k}`}>{v}</dd>
              </div>
            ))}
            <div className="fact-row">
              <dt>{t('maintenance.rows.memory')}</dt>
              <dd data-testid="maintenance-memory">{t('maintenance.memoryValue', { rss: n(Math.round(report.process.rssMb)), heap: n(Math.round(report.process.heapMb)) })}</dd>
            </div>
            {report.process.startupMs !== null && (
              <div className="fact-row">
                <dt>{t('maintenance.rows.startup')}</dt>
                <dd>{t('maintenance.startupValue', { ms: n(Math.round(report.process.startupMs)) })}</dd>
              </div>
            )}
            <div className="fact-row">
              <dt>{t('maintenance.rows.workers')}</dt>
              <dd>{n(report.workers)}</dd>
            </div>
          </dl>
        ) : (
          <p className="hint">{libraryId ? t('maintenance.loading') : t('maintenance.needsLibrary')}</p>
        )}
        <div className="actions start">
          <button type="button" onClick={() => void load()} disabled={busy} data-testid="maintenance-refresh">
            {t('maintenance.refresh')}
          </button>
        </div>
      </div>

      <div className="group">
        <h3>{t('maintenance.clean.title')}</h3>
        <p className="hint">{t('maintenance.clean.hint')}</p>
        <div className="backup-targets" role="group" aria-label={t('maintenance.clean.title')}>
          {TARGETS.map((x) => (
            <CheckField
              key={x}
              label={t(`maintenance.targets.${x}`)}
              checked={picked.has(x)}
              onChange={(e) =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (e.target.checked) next.add(x);
                  else next.delete(x);
                  return next;
                })
              }
              data-testid={`maintenance-target-${x}`}
            />
          ))}
        </div>
        <div className="actions start">
          <button type="button" onClick={() => void clean()} disabled={busy || picked.size === 0 || !libraryId} data-testid="maintenance-clean">
            {t('maintenance.clean.button')}
          </button>
        </div>
      </div>

      <div className="group">
        <h3>{t('maintenance.support.title')}</h3>
        <p className="hint">{t('maintenance.support.hint')}</p>
        <div className="actions start">
          <button type="button" onClick={() => void run(async () => void (await rl.invoke('maintenance:openLogs', {})))} disabled={busy} data-testid="maintenance-logs">
            {t('maintenance.support.openLogs')}
          </button>
          <button type="button" onClick={() => void copy()} disabled={busy} data-testid="maintenance-diagnostics">
            {t('maintenance.support.copy')}
          </button>
        </div>
        {diagnostics !== null && (
          <details open>
            <summary>{t('maintenance.support.shown')}</summary>
            <textarea readOnly rows={8} value={diagnostics} aria-label={t('maintenance.support.shown')} data-testid="maintenance-diagnostics-text" />
          </details>
        )}
      </div>

      {note ? (
        <p className="callout" role="status" data-testid="maintenance-note">
          {note}
        </p>
      ) : null}
      {error ? <ErrorNote testId="maintenance-error">{message(error)}</ErrorNote> : null}
    </section>
  );
}
