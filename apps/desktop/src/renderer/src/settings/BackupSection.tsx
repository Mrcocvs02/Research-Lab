import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupAuto, BackupInfo, BackupJobStatus, BackupSettings } from '@rl/core';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { IconButton } from '../components/IconButton';
import { IconMore } from '../components/icons';
import { Menu } from '../components/Menu';
import { Segmented } from '../components/Segmented';
import { CheckField, ErrorNote, ProgressBar } from '../components/ui';
import { useAiUi } from '../lib/aiUi';
import { useLibraryEvents } from '../lib/events';
import { rl } from '../lib/rl';
import { RlError } from '../lib/rl-error';
import { useApp } from '../state/app-context';
import { formatSize } from '../views/library/formatSize';
import { safeText } from '../views/library/safeText';
import { autoErrorText, backupErrorText, daysSince, jobErrorText, STALE_BACKUP_DAYS, type BackupResultExt } from './backupText';
import { RestoreDialog } from './RestoreDialog';
import { Group, Row, SectionHead, useSettings } from './rows';
import { useBackupJob } from './useBackupJob';
import './backup.css';

type Preview = { dataFiles: number; dataBytes: number; localFiles: number; localBytes: number; freeBytes: number | null };

/** A long path as `…\last\two`: the whole path stays in the tooltip. */
export function shortPath(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length <= 3 ? p : `…${sep}${parts.slice(-2).join(sep)}`;
}

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

/** One backup of the list (rows of 48 px): when, size, verification result, "Verify" and "Restore…", and a menu with "Show the file" and "Remove…". */
function BackupRow({ b, listed, busy, verified, onVerify, onRestore, onShow, onRemove }: { b: BackupInfo; listed: boolean; busy: boolean; verified: boolean | undefined; onVerify(): void; onRestore(): void; onShow(): void; onRemove(): void }) {
  const { t, i18n } = useTranslation();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  const label = t('backup.moreFor', { name: safeText(b.name) });
  return (
    <li data-testid="backup-item" data-origin={b.origin}>
      <div className="backup-main">
        <strong>{new Date(b.createdAt).toLocaleString(i18n.language)}</strong>
        <span className="muted">
          {formatSize(b.bytes)} · {t('backup.list.docs', { count: b.documents })} · {t(`backup.list.origin.${b.origin}`)}
          {b.newerFormat ? ` · ${t('backup.list.newer')}` : ''}
        </span>
      </div>
      {verified !== undefined && (
        <span className={verified ? 'badge ok' : 'badge'} data-testid="backup-verified" data-ok={verified}>
          {verified ? t('backup.verifiedOk') : t('backup.verifiedBad')}
        </span>
      )}
      <Button size="sm" onClick={onVerify} disabled={busy || b.newerFormat} data-testid="backup-verify">
        {t('backup.verify')}
      </Button>
      <Button size="sm" onClick={onRestore} disabled={busy || b.newerFormat} data-testid="backup-restore">
        {t('backup.restore.button')}
      </Button>
      <span ref={more}>
        <IconButton label={label} onClick={() => setMenu(true)} data-testid="backup-more">
          <IconMore size={16} />
        </IconButton>
      </span>
      <Menu
        anchor={more}
        open={menu}
        onClose={() => setMenu(false)}
        label={label}
        groups={[
          {
            id: 'file',
            items: [
              { id: 'show', label: t('backup.reveal'), onSelect: onShow },
              !listed ? { id: 'remove', label: t('backup.remove'), disabled: true, disabledReason: t('backup.notListed'), onSelect: () => {} } : busy ? { id: 'remove', label: t('backup.remove'), disabled: true, disabledReason: t('backup.errors.running'), onSelect: () => {} } : { id: 'remove', label: t('backup.remove'), danger: true, onSelect: onRemove },
            ],
          },
        ]}
      />
    </li>
  );
}

/** Reasons that blame the destination folder itself: shown under the path with "Choose another folder…". */
const REFUSALS = ['inside-library', 'no-destination', 'invalid-path'];

/**
 * Backup and restore (4.6, 4.16): three states (no destination, destination refused, valid), the schedule, "Back up now" with
 * progress and cancel, the backups found in the destination (verify, restore, show, remove after confirmation), a notice when the
 * last backup is older than 30 days, and "Options" (how many to keep, chat history). The restore has its own dialog.
 */
export function BackupSection() {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const { navigation } = useAiUi();
  const { versions } = useLibraryEvents();
  const { reloadBackup } = useSettings();
  const [bs, setBs] = useState<BackupSettings | null>(null);
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [picked, setPicked] = useState<BackupInfo | null>(null);
  const [includeLocal, setIncludeLocal] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BackupInfo | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<{ kind: 'create' | 'verify'; name: string; file: string } | null>(null);
  const j = useBackupJob();
  const status = j.status;
  const section = useRef<HTMLDivElement>(null);
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
      void reloadBackup();
    } catch (e) {
      setError(e);
    }
  }, [reloadBackup]);

  useEffect(() => {
    void loadSettings();
    void loadList();
  }, [loadSettings, loadList, libraryId]);

  // What a backup would hold (and the free space of the destination), again when the destination or the choice changes.
  const destination = bs?.destination ?? null;
  useEffect(() => {
    if (!libraryId || !destination) return setPreview(null);
    let live = true;
    rl.invoke('backup:preview', { includeLocal }).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [libraryId, includeLocal, destination, versions.documents]);

  // A finished job changes the list and the "last backup" date; a verification leaves its result on the row.
  useEffect(() => {
    if (!j.finished || !status) return;
    void loadList();
    void loadSettings();
    if (target?.kind === 'verify' && status.state === 'done' && status.result) setVerified((v) => ({ ...v, [target.file]: status.result!.problemCount === 0 }));
  }, [j.finished, loadList, loadSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const refusal = (e: unknown) => {
    const reason = RlError.from(e).details?.reason;
    if (typeof reason === 'string' && REFUSALS.includes(reason)) {
      setRefused(reason);
      return true;
    }
    return false;
  };
  const chooseDestination = async () => {
    setError(null);
    try {
      const next = await rl.invoke('backup:chooseDestination', {});
      if (next) {
        setRefused(null);
        setBs(next);
        await loadList();
        void reloadBackup();
      }
    } catch (e) {
      if (!refusal(e)) setError(e);
    }
  };
  const configure = (patch: { auto?: BackupAuto; keep?: number; clearDestination?: boolean }) =>
    guard(async () => {
      setBs(await rl.invoke('backup:configure', patch));
      if (patch.clearDestination) setItems([]);
    });
  const backupNow = useCallback(async () => {
    setError(null);
    setTarget({ kind: 'create', name: '', file: '' });
    try {
      await j.start(() => rl.invoke('backup:create', { includeLocal }));
    } catch (e) {
      setTarget(null);
      if (!refusal(e)) setError(e);
    }
  }, [includeLocal, j.start]);
  const verify = (info: BackupInfo) =>
    guard(async () => {
      setTarget({ kind: 'verify', name: info.name, file: info.file });
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
  const refusedText = refused ? backupErrorText(new RlError('CONFLICT', refused, { reason: refused }), t) : null;
  const valid = destination !== null && refusedText === null;
  const options: Array<{ value: BackupAuto; label: string }> = [
    { value: 'off', label: t('backup.schedule.off') },
    { value: 'daily', label: t('backup.schedule.daily') },
    { value: 'weekly', label: t('backup.schedule.weekly') },
    { value: 'monthly', label: t('backup.schedule.monthly') },
  ];

  return (
    <div ref={section} data-testid="backup-section">
      <SectionHead title={t('backup.title')} intro={t('backup.intro')} />
      {stale && (
        <div data-testid="backup-stale">
          <Banner tone="warning">{t('backup.stale', { days: age, limit: STALE_BACKUP_DAYS })}</Banner>
        </div>
      )}
      {bs?.lastAutoError && (
        <div data-testid="backup-auto-error">
          <Banner tone="warning">{t('backup.autoError', { reason: autoErrorText(bs.lastAutoError, t) })}</Banner>
        </div>
      )}
      <Group title={t('backup.destination.label')}>
        {valid ? (
          <Row sid="backupDestination" label={t('backup.destination.label')} help={t('backup.destination.syncNote')}>
            <span className="path" data-testid="backup-destination" title={destination}>
              {shortPath(safeText(destination))}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void chooseDestination()} disabled={j.running} data-testid="backup-choose">
              {t('backup.destination.change')}
            </Button>
          </Row>
        ) : (
          <>
            <Row sid="backupDestination" label={refusedText ? t('backup.destination.refused') : t('backup.destination.pick')} help={t('backup.destination.hint')}>
              <Button variant="primary" size="sm" onClick={() => void chooseDestination()} disabled={j.running} data-testid="backup-choose">
                {refusedText ? t('backup.destination.another') : t('backup.destination.choose')}
              </Button>
              {!destination && !refusedText && (
                <span className="muted" data-testid="backup-no-destination">
                  {t('backup.destination.none')}
                </span>
              )}
              {destination && (
                <span className="path" data-testid="backup-destination" title={destination}>
                  {shortPath(safeText(destination))}
                </span>
              )}
            </Row>
            {refusedText && (
              <p className="field-error" role="alert" data-testid="backup-refused">
                {refusedText}
              </p>
            )}
          </>
        )}
        {error && !valid ? <ErrorNote testId="backup-error">{backupErrorText(error, t)}</ErrorNote> : null}
      </Group>

      {valid && (
        <>
          <Group title={t('backup.now.title')}>
            <Row sid="backupAuto" label={t('backup.schedule.label')} help={t('backup.schedule.hint')}>
              <div data-testid="backup-auto">
                <Segmented<BackupAuto> label={t('backup.schedule.label')} options={options} value={bs?.auto ?? 'off'} onChange={(v) => void configure({ auto: v })} />
              </div>
            </Row>
            <Row sid="backupNow" label={t('backup.now.button')} help={bs?.lastBackupAt ? t('backup.last', { when: when(bs.lastBackupAt) }) : t('backup.lastNone')}>
              <Button variant="primary" onClick={() => void backupNow()} disabled={!libraryId || j.running} disabledReason={libraryId ? undefined : t('backup.now.needsLibrary')} data-testid="backup-now">
                {t('backup.now.button')}
              </Button>
            </Row>
            {preview && (
              <p className="set-help" data-testid="backup-preview">
                {t('backup.preview', { files: n(preview.dataFiles + (includeLocal ? preview.localFiles : 0)), size: formatSize(preview.dataBytes + (includeLocal ? preview.localBytes : 0)) })}
                {preview.freeBytes !== null ? ` ${t('backup.previewFree', { free: formatSize(preview.freeBytes) })}` : ''}
              </p>
            )}
            {j.job && (
              <div className="backup-job" data-testid="backup-job" data-state={status?.state ?? 'running'} data-kind={target?.kind}>
                {!finished && (
                  <>
                    <p role="status">{status ? t(`backup.phase.${status.phase}`) : t('backup.phase.collect')}</p>
                    <ProgressBar label={t('backup.progress')} value={status?.done ?? 0} max={status && status.total > 0 ? status.total : undefined} />
                    {status && status.total > 0 && (
                      <p className="set-help" data-testid="backup-progress-count">
                        {formatSize(status.done)} / {formatSize(status.total)}
                      </p>
                    )}
                    <div className="actions start">
                      <Button size="sm" onClick={j.cancel} data-testid="backup-cancel">
                        {t('backup.cancel')}
                      </Button>
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
                        <Button size="sm" onClick={() => void guard(() => rl.invoke('backup:reveal', { jobId: j.jobId! }))} data-testid="backup-reveal">
                          {t('backup.reveal')}
                        </Button>
                      )}
                      <Button size="sm" onClick={j.reset} data-testid="backup-job-close">
                        {t('common.close')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
            {error ? <ErrorNote testId="backup-error">{backupErrorText(error, t)}</ErrorNote> : null}
          </Group>

          <Group title={t('backup.list.title')} sid="backupList">
            {shown.length === 0 ? (
              <p className="set-help" data-testid="backup-empty">
                {t('backup.list.empty')}
              </p>
            ) : (
              <ul className="backup-list" data-testid="backup-list">
                {shown.map((b) => (
                  <BackupRow
                    key={b.file}
                    b={b}
                    listed={items.some((i) => i.file === b.file)}
                    busy={j.running}
                    verified={verified[b.file]}
                    onVerify={() => void verify(b)}
                    onRestore={() => setRestoring(b)}
                    onShow={() => void guard(() => rl.invoke('backup:reveal', { file: b.file }))}
                    onRemove={() => setConfirmRemove(b)}
                  />
                ))}
              </ul>
            )}
            <div className="actions start">
              <Button size="sm" variant="ghost" onClick={() => void openFile()} disabled={j.running} data-testid="backup-open-file">
                {t('backup.list.openFile')}
              </Button>
            </div>
          </Group>

          <Group>
            <details className="set-fold" data-testid="backup-options">
              <summary>{t('backup.options.title')}</summary>
              <div className="set-fold__body">
                <Row sid="backupKeep" label={t('backup.schedule.keep')} help={t('backup.options.keepHelp')} htmlFor="backup-keep">
                  <input
                    id="backup-keep"
                    className="is-short"
                    type="number"
                    min={1}
                    max={50}
                    value={bs?.keep ?? 5}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(50, Math.round(Number(e.target.value))));
                      if (Number.isFinite(v)) void configure({ keep: v });
                    }}
                    data-testid="backup-keep"
                  />
                </Row>
                <div data-set="backupLocal">
                  <CheckField label={t('backup.includeLocal.label')} hint={t('backup.includeLocal.hint')} checked={includeLocal} disabled={j.running} onChange={(e) => setIncludeLocal(e.target.checked)} data-testid="backup-include-local" />
                </div>
                <p className="set-help" data-testid="backup-internal-note">
                  {t('backup.internalNote')}
                </p>
                <Button size="sm" variant="ghost" onClick={() => void configure({ clearDestination: true })} disabled={j.running} data-testid="backup-clear">
                  {t('backup.destination.clear')}
                </Button>
              </div>
            </details>
          </Group>
        </>
      )}

      {confirmRemove && (
        <Dialog title={t('backup.removeTitle')} onClose={() => setConfirmRemove(null)} testId="backup-remove-confirm">
          <p>{t('backup.removeBody', { name: safeText(confirmRemove.name) })}</p>
          <div className="actions">
            <Button onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => void remove(confirmRemove)} data-testid="backup-remove-yes">
              {t('backup.removeConfirm')}
            </Button>
          </div>
        </Dialog>
      )}
      {restoring && <RestoreDialog info={restoring} onClose={() => setRestoring(null)} />}
    </div>
  );
}
