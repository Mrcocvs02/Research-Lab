import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupInfo } from '@rl/core';
import { Dialog } from '../components/Dialog';
import { CheckField, ErrorNote, ProgressBar, TextField } from '../components/ui';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { safeText } from '../views/library/safeText';
import { formatSize } from '../views/library/formatSize';
import { backupErrorText, jobErrorText } from './backupText';
import { useBackupJob } from './useBackupJob';
import './backup.css';

/**
 * Restore a backup as a NEW library (D-255): the user picks the folder where the documents of the library are on this
 * computer (a library root), may keep the local data and the portable settings of the backup, and watches the job.
 * Nothing existing is overwritten; the result lists the secrets to enter again.
 */
export function RestoreDialog({ info, onClose }: { info: BackupInfo; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const [root, setRoot] = useState<{ path: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [restoreLocal, setRestoreLocal] = useState(info.includesLocal);
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const j = useBackupJob();
  const status = j.status;
  const result = status?.state === 'done' ? status.result : null;

  const choose = async () => {
    setError(null);
    try {
      const picked = await rl.invoke('dialog:chooseFolder', { purpose: 'library-root', title: t('backup.restore.chooseRootTitle') });
      if (picked) setRoot(picked);
    } catch (e) {
      setError(e);
    }
  };

  const start = async () => {
    if (!root) return;
    setError(null);
    try {
      await j.start(() => rl.invoke('backup:restore', { file: info.file, rootPath: root.path, ...(name.trim() ? { name: name.trim() } : {}), restoreLocal: restoreLocal && info.includesLocal, restoreSettings: restoreSettings && info.includesSettings }));
    } catch (e) {
      setError(e);
    }
  };

  const close = () => {
    if (j.running) j.cancel();
    // The new profile (and perhaps the settings) exist now: the window learns about them.
    if (status?.state === 'done') void app.refresh();
    onClose();
  };

  const n = (v: number) => v.toLocaleString(i18n.language);
  return (
    <Dialog title={t('backup.restore.title')} onClose={close} testId="restore-dialog">
      <div className="backup-dialog">
        {!j.job ? (
          <>
            <p className="hint">{t('backup.restore.intro')}</p>
            <dl className="kv" data-testid="restore-source">
              <dt>{t('backup.restore.library')}</dt>
              <dd>{safeText(info.libraryName)}</dd>
              <dt>{t('backup.restore.made')}</dt>
              <dd>{new Date(info.createdAt).toLocaleString(i18n.language)}</dd>
              <dt>{t('backup.restore.holds')}</dt>
              <dd>{t('backup.restore.holdsValue', { documents: n(info.documents), files: n(info.files), size: formatSize(info.bytes) })}</dd>
            </dl>
            <div className="group">
              <h3>{t('backup.restore.root')}</h3>
              <p className="hint">{t('backup.restore.rootHint')}</p>
              <div className="inline-form">
                <button type="button" onClick={() => void choose()} data-testid="restore-choose-root">
                  {root ? t('backup.restore.changeRoot') : t('backup.restore.chooseRoot')}
                </button>
                {root && (
                  <span className="path" data-testid="restore-root">
                    {safeText(root.path)}
                  </span>
                )}
              </div>
            </div>
            <TextField label={t('backup.restore.name')} hint={t('backup.restore.nameHint')} placeholder={safeText(info.libraryName)} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="restore-name" />
            <CheckField label={t('backup.restore.local')} hint={info.includesLocal ? t('backup.restore.localHint') : t('backup.restore.localMissing')} checked={restoreLocal && info.includesLocal} disabled={!info.includesLocal} onChange={(e) => setRestoreLocal(e.target.checked)} data-testid="restore-local" />
            <CheckField label={t('backup.restore.settings')} hint={info.includesSettings ? t('backup.restore.settingsHint') : t('backup.restore.settingsMissing')} checked={restoreSettings && info.includesSettings} disabled={!info.includesSettings} onChange={(e) => setRestoreSettings(e.target.checked)} data-testid="restore-settings" />
            <p className="callout" role="note">
              {t('backup.restore.noOverwrite')}
            </p>
            {error ? <ErrorNote testId="restore-error">{backupErrorText(error, t)}</ErrorNote> : null}
            <div className="actions">
              <button type="button" onClick={close}>
                {t('common.cancel')}
              </button>
              <button type="button" className="primary" disabled={!root || info.newerFormat} onClick={() => void start()} data-testid="restore-start">
                {t('backup.restore.start')}
              </button>
            </div>
          </>
        ) : (
          <div data-testid="restore-progress-panel">
            {!j.finished && (
              <>
                <p>{status ? t(`backup.phase.${status.phase}`) : t('backup.phase.collect')}</p>
                <ProgressBar label={t('backup.progress')} value={status?.done ?? 0} max={status && status.total > 0 ? status.total : undefined} />
                {status && status.total > 0 && (
                  <p className="hint" data-testid="restore-progress-count">
                    {formatSize(status.done)} / {formatSize(status.total)}
                  </p>
                )}
                <div className="actions">
                  <button type="button" onClick={j.cancel} data-testid="restore-cancel">
                    {t('backup.cancel')}
                  </button>
                </div>
              </>
            )}
            {j.finished && status && (
              <>
                {status.state === 'failed' && <ErrorNote testId="restore-failed">{t('backup.restore.failed', { message: jobErrorText(status.error, t) })}</ErrorNote>}
                {status.state === 'cancelled' && (
                  <p className="callout warn" role="status" data-testid="restore-cancelled">
                    {t('backup.restore.cancelled')}
                  </p>
                )}
                {result && (
                  <div data-testid="restore-result" data-library-id={result.restoredLibraryId ?? ''}>
                    <p className="callout" role="status">
                      {t('backup.restore.done')}
                    </p>
                    <p>{result.settingsRestored ? t('backup.restore.settingsApplied') : t('backup.restore.settingsKept')}</p>
                    {result.secretsToEnter.length > 0 ? (
                      <div className="callout warn" data-testid="restore-secrets">
                        <p>{t('backup.restore.secretsTitle')}</p>
                        <ul>
                          {result.secretsToEnter.map((s) => (
                            <li key={s} data-secret={s}>
                              {t(`backup.restore.secrets.${s}`)}
                            </li>
                          ))}
                        </ul>
                        <p className="hint">{t('backup.restore.secretsHint')}</p>
                      </div>
                    ) : (
                      <p className="hint">{t('backup.restore.secretsNone')}</p>
                    )}
                    <p className="hint">{t('backup.restore.rebuilding')}</p>
                  </div>
                )}
                <div className="actions">
                  {status.state !== 'done' && (
                    <button type="button" onClick={j.reset} data-testid="restore-again">
                      {t('backup.restore.again')}
                    </button>
                  )}
                  <button type="button" className="primary" onClick={close} data-testid="restore-close">
                    {t('common.close')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
