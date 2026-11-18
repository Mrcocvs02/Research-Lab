import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupInfo } from '@rl/core';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { KeyValue } from '../components/KeyValue';
import { CheckField, ErrorNote, ProgressBar, TextField } from '../components/ui';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { safeText } from '../views/library/safeText';
import { formatSize } from '../views/library/formatSize';
import { backupErrorText, jobErrorText, type BackupResultExt } from './backupText';
import { useSettings } from './rows';
import { useBackupJob } from './useBackupJob';
import './backup.css';

/** The same folder as another path (separators and case of Windows paths do not matter). */
const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

/** Dialog body in two parts: the content scrolls, the footer with the actions stays where it is (4.16). */
function Frame({ footer, children }: { footer: ReactNode; children: ReactNode }) {
  return (
    <div className="backup-dialog">
      <div className="backup-body">{children}</div>
      <div className="backup-foot">{footer}</div>
    </div>
  );
}

/**
 * Restore a backup as a NEW library (D-255): the user picks an empty folder for the documents of the library, may keep the
 * local data and the portable settings of the backup, and watches the job. Nothing existing is overwritten. The new library is
 * named "<name> (restored on <date>)" unless the user types another name; the result opens it.
 */
export function RestoreDialog({ info, onClose }: { info: BackupInfo; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const { goTo } = useSettings();
  const [root, setRoot] = useState<{ path: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [restoreLocal, setRestoreLocal] = useState(info.includesLocal);
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const j = useBackupJob();
  const status = j.status;
  const result = (status?.state === 'done' ? status.result : null) as BackupResultExt | null;
  const defaultName = t('backup.restore.defaultName', { name: safeText(info.libraryName).slice(0, 80), date: new Date().toLocaleDateString(i18n.language) });
  const isLibraryRoot = root !== null && app.profiles.some((p) => norm(p.rootPath) === norm(root.path));

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
    if (!root || isLibraryRoot) return;
    setError(null);
    try {
      await j.start(() => rl.invoke('backup:restore', { file: info.file, rootPath: root.path, name: name.trim() || defaultName, restoreLocal: restoreLocal && info.includesLocal, restoreSettings: restoreSettings && info.includesSettings }));
    } catch (e) {
      setError(e);
    }
  };

  const close = () => {
    if (j.running) j.cancel();
    // The new profile (and perhaps the settings) exist now: the window learns about them.
    if (status?.result?.restoredLibraryId) void app.refresh();
    onClose();
  };
  const openRestored = async () => {
    const id = result?.restoredLibraryId;
    if (!id) return;
    setError(null);
    try {
      await rl.invoke('library:setActive', { libraryId: id });
      await app.refresh();
      onClose();
    } catch (e) {
      setError(e);
    }
  };
  const manage = () => {
    close();
    goTo('library');
  };

  const n = (v: number) => v.toLocaleString(i18n.language);
  const cancelFooter = (
    <>
      <Button onClick={close}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={!root || isLibraryRoot || info.newerFormat} disabledReason={!root ? t('backup.restore.needsRoot') : isLibraryRoot ? t('backup.restore.libraryRoot') : undefined} onClick={() => void start()} data-testid="restore-start">
        {t('backup.restore.start')}
      </Button>
    </>
  );

  return (
    <Dialog title={t('backup.restore.title')} onClose={close} testId="restore-dialog">
      {!j.job ? (
        <Frame footer={cancelFooter}>
          <p className="set-help">{t('backup.restore.intro')}</p>
          <div data-testid="restore-source">
            <KeyValue
              items={[
                { label: t('backup.restore.library'), value: safeText(info.libraryName) },
                { label: t('backup.restore.made'), value: new Date(info.createdAt).toLocaleString(i18n.language) },
                { label: t('backup.restore.holds'), value: t('backup.restore.holdsValue', { documents: n(info.documents), files: n(info.files), size: formatSize(info.bytes) }) },
              ]}
            />
          </div>
          <div className="group">
            <h3>{t('backup.restore.root')}</h3>
            <div className="inline-form">
              <Button size="sm" onClick={() => void choose()} data-testid="restore-choose-root">
                {root ? t('backup.restore.changeRoot') : t('backup.restore.chooseRoot')}
              </Button>
              {root && (
                <span className="path" data-testid="restore-root">
                  {safeText(root.path)}
                </span>
              )}
            </div>
            {isLibraryRoot ? (
              <p className="field-error" role="alert" data-testid="restore-root-warning">
                {t('backup.restore.libraryRoot')}
              </p>
            ) : (
              <p className="set-help" data-testid="restore-root-hint">
                {t('backup.restore.rootHint')}
              </p>
            )}
          </div>
          <TextField label={t('backup.restore.name')} hint={t('backup.restore.nameHint')} placeholder={defaultName} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="restore-name" />
          <CheckField label={t('backup.restore.local')} hint={info.includesLocal ? t('backup.restore.localHint') : t('backup.restore.localMissing')} checked={restoreLocal && info.includesLocal} disabled={!info.includesLocal} onChange={(e) => setRestoreLocal(e.target.checked)} data-testid="restore-local" />
          <CheckField label={t('backup.restore.settings')} hint={info.includesSettings ? t('backup.restore.settingsHint') : t('backup.restore.settingsMissing')} checked={restoreSettings && info.includesSettings} disabled={!info.includesSettings} onChange={(e) => setRestoreSettings(e.target.checked)} data-testid="restore-settings" />
          {error ? <ErrorNote testId="restore-error">{backupErrorText(error, t)}</ErrorNote> : null}
        </Frame>
      ) : (
        <div data-testid="restore-progress-panel">
          {!j.finished && (
            <Frame
              footer={
                <Button onClick={j.cancel} data-testid="restore-cancel">
                  {t('backup.cancel')}
                </Button>
              }
            >
              <p>{status ? t(`backup.phase.${status.phase}`) : t('backup.phase.collect')}</p>
              <ProgressBar label={t('backup.progress')} value={status?.done ?? 0} max={status && status.total > 0 ? status.total : undefined} />
              {status && status.total > 0 && (
                <p className="set-help" data-testid="restore-progress-count">
                  {formatSize(status.done)} / {formatSize(status.total)}
                </p>
              )}
            </Frame>
          )}
          {j.finished && status && (
            <Frame
              footer={
                <>
                  {status.state !== 'done' && (
                    <Button onClick={j.reset} data-testid="restore-again">
                      {t('backup.restore.again')}
                    </Button>
                  )}
                  {result?.restoredLibraryId && (
                    <Button variant="primary" onClick={() => void openRestored()} data-testid="restore-open-library">
                      {t('backup.restore.open')}
                    </Button>
                  )}
                  <Button variant={result?.restoredLibraryId ? 'secondary' : 'primary'} onClick={close} data-testid="restore-close">
                    {t('common.close')}
                  </Button>
                </>
              }
            >
              {status.state === 'failed' && <ErrorNote testId="restore-failed">{t('backup.restore.failed', { message: jobErrorText(status.error, t) })}</ErrorNote>}
              {status.state === 'cancelled' && (
                <p className="callout warn" role="status" data-testid="restore-cancelled">
                  {t('backup.restore.cancelled')}
                </p>
              )}
              {result && (
                <div data-testid="restore-result" data-library-id={result.restoredLibraryId ?? ''}>
                  <p className="callout" role="status">
                    {t('backup.restore.done', { name: name.trim() || defaultName })} {result.settingsRestored ? t('backup.restore.settingsApplied') : t('backup.restore.settingsKept')}
                  </p>
                  {result.resetOnRestore && result.resetOnRestore.length > 0 && (
                    <div className="callout warn" role="status" data-testid="restore-reset">
                      <p>{t('backup.restore.resetTitle')}</p>
                      <ul>
                        {result.resetOnRestore.map((s) => (
                          <li key={s} data-reset={s}>
                            {t(`backup.restore.reset.${s}`)}
                          </li>
                        ))}
                      </ul>
                      <p className="set-help">{t('backup.restore.resetHint')}</p>
                    </div>
                  )}
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
                      <p className="set-help">{t('backup.restore.secretsHint')}</p>
                    </div>
                  ) : (
                    <p className="set-help">{t('backup.restore.secretsNone')}</p>
                  )}
                  <p className="set-help">{t('backup.restore.rebuilding')}</p>
                  <p className="set-help">
                    {t('backup.restore.manageHint')}{' '}
                    <button type="button" className="link" onClick={manage} data-testid="restore-manage">
                      {t('backup.restore.manage')}
                    </button>
                  </p>
                </div>
              )}
              {error ? <ErrorNote testId="restore-error">{backupErrorText(error, t)}</ErrorNote> : null}
            </Frame>
          )}
        </div>
      )}
    </Dialog>
  );
}
