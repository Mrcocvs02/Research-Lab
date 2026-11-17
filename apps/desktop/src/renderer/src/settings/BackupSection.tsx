import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupInfo, BackupJobStatus, BackupSettings } from '@rl/core';
import { CheckField, ErrorNote, ProgressBar, SelectField } from '../components/ui';
import { useAiUi } from '../lib/aiUi';
import { rl } from '../lib/rl';
import { useLibraryEvents } from '../lib/events';
import { useApp } from '../state/app-context';
import { formatSize } from '../views/library/formatSize';
import { safeText } from '../views/library/safeText';
import { autoErrorText, backupErrorText, daysSince, jobErrorText, STALE_BACKUP_DAYS, type BackupResultExt } from './backupText';
import { RestoreDialog } from './RestoreDialog';
import { useBackupJob } from './useBackupJob';
import './backup.css';

type Preview = { dataFiles: number; dataBytes: number; localFiles: number; localBytes: number; freeBytes: number | null };

function ProblemList({ status }: { status: BackupJobStatus }) {
  const { t } = useTranslation();
  const r = status.result;
  if (!r || r.problemCount === 0) return null;
  return (
    <details open data-testid="backup-problems">
      <summary>{t('backup.result.problems', { count: r.problemCount })}</summary>
      <ul>
        {r.problems.slice(0, 50).map((p, i) => (
          <li key={`${p.path}-${i}`}>
            <code>{safeText(p.path)}</code> {t(`backup.result.reason.${p.reason}`)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Backup and restore (D-255, D-256, D-262, D-264): destination, schedule, "Back up now" with progress and cancel, the
 * backups found in the destination (verify, restore, show, remove after confirmation), the last automatic error, and a
 * notice when the last backup is older than 30 days. The restore has its own dialog.
 */
export function BackupSection() {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const { navigation } = useAiUi();
  const { versions } = useLibraryEvents();
  const [bs, setBs] = useState<BackupSettings | null>(null);
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [picked, setPicked] = useState<BackupInfo | null>(null);
  const [includeLocal, setIncludeLocal] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [target, setTarget] = useState<{ kind: 'create' | 'verify'; name: string } | null>(null);
  const j = useBackupJob();
  const status = j.status;
  const headId = useId();
  const section = useRef<HTMLElement>(null);
  const libraryId = app.activeLibraryId;

  const loadList = useCallback(async () => {
    try {
      setItems((await rl.invoke('backup:list', {})).items);
    } catch {
      setItems([]); // no destination yet, or the folder is gone: the list is just empty
    }
  }, []);
  const loadSettings = useCallback(async () => {
    try {
      setBs(await rl.invoke('backup:settings', {}));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadList();
  }, [loadSettings, loadList, libraryId]);

  // What a backup would hold (and the free space of the destination), again when the destination or the choice changes.
  const destination = bs?.destination ?? null;
  useEffect(() => {
    if (!libraryId) return setPreview(null);
    let live = true;
    rl.invoke('backup:preview', { includeLocal }).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [libraryId, includeLocal, destination, versions.documents]);

  // A finished job changes the list and the "last backup" date.
  useEffect(() => {
    if (j.finished) {
      void loadList();
      void loadSettings();
    }
  }, [j.finished, loadList, loadSettings]);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };

  const chooseDestination = () =>
    guard(async () => {
      const next = await rl.invoke('backup:chooseDestination', {});
      if (next) {
        setBs(next);
        await loadList();
      }
    });
  const configure = (patch: { auto?: BackupSettings['auto']; keep?: number; clearDestination?: boolean }) =>
    guard(async () => {
      setBs(await rl.invoke('backup:configure', patch));
      if (patch.clearDestination) setItems([]);
    });
  const backupNow = useCallback(async () => {
    setError(null);
    setTarget({ kind: 'create', name: '' });
    try {
      await j.start(() => rl.invoke('backup:create', { includeLocal }));
    } catch (e) {
      setTarget(null);
      setError(e);
    }
  }, [includeLocal, j.start]);
  const verify = (info: BackupInfo) =>
    guard(async () => {
      setTarget({ kind: 'verify', name: info.name });
      await j.start(() => rl.invoke('backup:verify', { file: info.file }));
    });
  const openFile = () =>
    guard(async () => {
      const f = await rl.invoke('dialog:chooseFile', { purpose: 'backup-file', title: t('backup.list.fileDialogTitle') });
      if (f) setPicked(await rl.invoke('backup:inspect', { file: f.path }));
    });
  const remove = (info: BackupInfo) =>
    guard(async () => {
      await rl.invoke('backup:remove', { file: info.file });
      setConfirmRemove(null);
      await loadList();
      await loadSettings();
    });

  // "Back up now" of the palette: the settings page opens here, the backup starts once (or asks for a folder first).
  const handled = useRef(0);
  useEffect(() => {
    if (!navigation || navigation.focus !== 'backup' || handled.current === navigation.nonce || !bs) return;
    handled.current = navigation.nonce;
    section.current?.scrollIntoView?.({ block: 'start' });
    if (navigation.run === 'backupNow' && bs.destination && libraryId && !j.running) void backupNow();
  }, [navigation, bs, libraryId, j.running, backupNow]);

  const n = (v: number) => v.toLocaleString(i18n.language);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const age = bs?.lastBackupAt ? daysSince(bs.lastBackupAt) : null;
  const stale = age !== null && age > STALE_BACKUP_DAYS;
  const shown = picked && !items.some((i) => i.file === picked.file) ? [picked, ...items] : items;
  const finished = j.finished && status !== null;

  return (
    <section className="card" aria-labelledby={headId} ref={section} data-testid="backup-section">
      <h2 id={headId}>{t('backup.title')}</h2>
      <p className="hint">{t('backup.intro')}</p>
      <p className="hint" data-testid="backup-internal-note">
        {t('backup.internalNote')}
      </p>

      <div className="group">
        <h3>{t('backup.destination.label')}</h3>
        <div className="inline-form">
          <button type="button" onClick={() => void chooseDestination()} disabled={j.running} data-testid="backup-choose">
            {destination ? t('backup.destination.change') : t('backup.destination.choose')}
          </button>
          {destination ? (
            <>
              <span className="path" data-testid="backup-destination">
                {safeText(destination)}
              </span>
              <button type="button" className="link" onClick={() => void configure({ clearDestination: true })} disabled={j.running} data-testid="backup-clear">
                {t('backup.destination.clear')}
              </button>
            </>
          ) : (
            <span className="hint" data-testid="backup-no-destination">
              {t('backup.destination.none')}
            </span>
          )}
        </div>
        <p className="hint">{t('backup.destination.hint')}</p>
        <p className="hint" data-testid="backup-sync-note">
          {t('backup.destination.syncNote')}
        </p>
      </div>

      <div className="group">
        <h3>{t('backup.schedule.title')}</h3>
        <div className="backup-schedule">
          <SelectField label={t('backup.schedule.label')} hint={t('backup.schedule.hint')} value={bs?.auto ?? 'off'} onChange={(e) => void configure({ auto: e.target.value as BackupSettings['auto'] })} data-testid="backup-auto">
            <option value="off">{t('backup.schedule.off')}</option>
            <option value="daily">{t('backup.schedule.daily')}</option>
            <option value="weekly">{t('backup.schedule.weekly')}</option>
            <option value="monthly">{t('backup.schedule.monthly')}</option>
          </SelectField>
          <div className="field">
            <label htmlFor={`${headId}-keep`}>{t('backup.schedule.keep')}</label>
            <input
              id={`${headId}-keep`}
              type="number"
              min={1}
              max={50}
              value={bs?.keep ?? 5}
              disabled={bs?.auto === 'off'}
              onChange={(e) => {
                const v = Math.max(1, Math.min(50, Math.round(Number(e.target.value))));
                if (Number.isFinite(v)) void configure({ keep: v });
              }}
              data-testid="backup-keep"
            />
            <p className="hint">{t('backup.schedule.keepHint')}</p>
          </div>
        </div>
        {bs?.lastAutoError ? (
          <p className="callout warn" role="status" data-testid="backup-auto-error">
            {t('backup.autoError', { reason: autoErrorText(bs.lastAutoError, t) })}
          </p>
        ) : null}
      </div>

      <div className="group">
        <h3>{t('backup.now.title')}</h3>
        {bs?.lastBackupAt ? (
          <p data-testid="backup-last">{t('backup.last', { when: when(bs.lastBackupAt) })}</p>
        ) : (
          <p className="hint" data-testid="backup-last">
            {t('backup.lastNone')}
          </p>
        )}
        {stale ? (
          <p className="callout warn" role="status" data-testid="backup-stale">
            {t('backup.stale', { days: age, limit: STALE_BACKUP_DAYS })}
          </p>
        ) : null}
        <CheckField label={t('backup.includeLocal.label')} hint={t('backup.includeLocal.hint')} checked={includeLocal} disabled={j.running} onChange={(e) => setIncludeLocal(e.target.checked)} data-testid="backup-include-local" />
        {preview && (
          <p className="hint" data-testid="backup-preview">
            {t('backup.preview', { files: n(preview.dataFiles + (includeLocal ? preview.localFiles : 0)), size: formatSize(preview.dataBytes + (includeLocal ? preview.localBytes : 0)) })}
            {preview.freeBytes !== null ? ` ${t('backup.previewFree', { free: formatSize(preview.freeBytes) })}` : ''}
          </p>
        )}
        <div className="actions start">
          <button type="button" className="primary" onClick={() => void backupNow()} disabled={!libraryId || !destination || j.running} data-testid="backup-now">
            {t('backup.now.button')}
          </button>
          {!destination && <span className="hint">{t('backup.now.needsDestination')}</span>}
          {!libraryId && <span className="hint">{t('backup.now.needsLibrary')}</span>}
        </div>

        {j.job && (
          <div className="backup-job" data-testid="backup-job" data-state={status?.state ?? 'running'} data-kind={target?.kind}>
            {!finished && (
              <>
                <p role="status">{status ? t(`backup.phase.${status.phase}`) : t('backup.phase.collect')}</p>
                <ProgressBar label={t('backup.progress')} value={status?.done ?? 0} max={status && status.total > 0 ? status.total : undefined} />
                {status && status.total > 0 && (
                  <p className="hint" data-testid="backup-progress-count">
                    {formatSize(status.done)} / {formatSize(status.total)}
                  </p>
                )}
                <div className="actions start">
                  <button type="button" onClick={j.cancel} data-testid="backup-cancel">
                    {t('backup.cancel')}
                  </button>
                </div>
              </>
            )}
            {finished && status && (
              <>
                {status.state === 'failed' && <ErrorNote testId="backup-failed">{t('backup.result.failed', { message: jobErrorText(status.error, t) })}</ErrorNote>}
                {status.state === 'cancelled' && (
                  <p className="callout warn" role="status" data-testid="backup-cancelled">
                    {t('backup.result.cancelled')}
                  </p>
                )}
                {status.state === 'done' && status.result && (
                  <div data-testid="backup-result" data-kind={target?.kind}>
                    {target?.kind === 'verify' ? (
                      <p className={status.result.problemCount === 0 ? 'callout' : 'callout warn'} role="status" data-testid="backup-verify-result" data-ok={status.result.problemCount === 0}>
                        {status.result.problemCount === 0 ? t('backup.result.verifyOk', { name: safeText(target.name), files: n(status.result.files) }) : t('backup.result.verifyBad', { name: safeText(target.name) })}
                      </p>
                    ) : (
                      <p className="callout" role="status">
                        {t('backup.result.created', { files: n(status.result.files), size: formatSize(status.result.bytes) })}
                      </p>
                    )}
                    {target?.kind !== 'verify' && ((status.result as BackupResultExt).skipped ?? 0) > 0 && (
                      <p className="callout warn" role="status" data-testid="backup-skipped">
                        {t('backup.result.skipped', { count: (status.result as BackupResultExt).skipped })}
                      </p>
                    )}
                    <ProblemList status={status} />
                  </div>
                )}
                <div className="actions start">
                  {status.state === 'done' && target?.kind === 'create' && (
                    <button type="button" onClick={() => void guard(() => rl.invoke('backup:reveal', { jobId: j.jobId! }))} data-testid="backup-reveal">
                      {t('backup.reveal')}
                    </button>
                  )}
                  <button type="button" onClick={j.reset} data-testid="backup-job-close">
                    {t('common.close')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {error ? <ErrorNote testId="backup-error">{backupErrorText(error, t)}</ErrorNote> : null}
      </div>

      <div className="group">
        <h3>{t('backup.list.title')}</h3>
        {shown.length === 0 ? (
          <p className="hint" data-testid="backup-empty">
            {destination ? t('backup.list.empty') : t('backup.list.noDestination')}
          </p>
        ) : (
          <ul className="backup-list" data-testid="backup-list">
            {shown.map((b) => {
              const listed = items.some((i) => i.file === b.file);
              return (
                <li key={b.file} data-testid="backup-item" data-origin={b.origin}>
                  <div className="backup-main">
                    <strong>{safeText(b.name)}</strong>
                    <span className="hint">
                      {when(b.createdAt)} · {formatSize(b.bytes)} · {t('backup.list.docs', { count: b.documents })}
                    </span>
                    <span className="backup-badges">
                      <span className="badge">{t(`backup.list.origin.${b.origin}`)}</span>
                      {b.includesLocal && <span className="badge">{t('backup.list.local')}</span>}
                      {b.includesSettings && <span className="badge">{t('backup.list.settings')}</span>}
                      {b.newerFormat && <span className="badge badge-warn">{t('backup.list.newer')}</span>}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => void verify(b)} disabled={j.running || b.newerFormat} data-testid="backup-verify">
                      {t('backup.verify')}
                    </button>
                    <button type="button" onClick={() => setRestoring(b)} disabled={j.running || b.newerFormat} data-testid="backup-restore">
                      {t('backup.restore.button')}
                    </button>
                    <button type="button" onClick={() => void guard(() => rl.invoke('backup:reveal', { file: b.file }))} data-testid="backup-show">
                      {t('backup.reveal')}
                    </button>
                    {listed && (
                      <button type="button" onClick={() => setConfirmRemove(b.file)} disabled={j.running} data-testid="backup-remove">
                        {t('backup.remove')}
                      </button>
                    )}
                  </div>
                  {confirmRemove === b.file && (
                    <div className="confirm" role="alertdialog" aria-label={t('backup.removeTitle')} data-testid="backup-remove-confirm">
                      <p>{t('backup.removeBody', { name: safeText(b.name) })}</p>
                      <div className="actions start">
                        <button type="button" className="danger" onClick={() => void remove(b)} data-testid="backup-remove-yes">
                          {t('backup.removeConfirm')}
                        </button>
                        <button type="button" onClick={() => setConfirmRemove(null)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="actions start">
          <button type="button" onClick={() => void openFile()} disabled={j.running} data-testid="backup-open-file">
            {t('backup.list.openFile')}
          </button>
        </div>
      </div>

      {restoring && <RestoreDialog info={restoring} onClose={() => setRestoring(null)} />}
    </section>
  );
}
