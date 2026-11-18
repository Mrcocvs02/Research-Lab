import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Switch } from '../components/Switch';
import { ProgressBar } from '../components/ui';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { formatSize } from '../views/library/formatSize';
import { Group, Row, SaveError, useLibraryPatch } from './rows';
import { useAutoSave } from './useAutoSave';

type Plan = { files: number; bytes: number; skipped: number; written: number };
type Copies = { count: number; bytes: number; location: 'data' | 'local' };
type Ask = null | 'migrate' | 'off' | 'restoreAll' | 'deleteCopies';
type Job = { id: string; kind: 'migrate' | 'restore'; done: number; total: number; state: 'running' | 'done' | 'cancelled' };

/**
 * Settings › Library › PDF annotations (§8.3.9, G4a): write highlights into the PDFs (the switch), write the existing ones
 * ("Write them into the PDFs…" with what it will do), who the author is, where the safety copies live, restore the originals.
 * Every change that touches files asks first, says how many, and runs one file at a time with progress and Cancel.
 */
export function LibraryAnnotationsGroup() {
  const { t } = useTranslation();
  const app = useApp();
  const patch = useLibraryPatch();
  const cfg = app.config?.annotations;
  const sw = useAutoSave();
  const author = useAutoSave();
  const where = useAutoSave();
  const [ask, setAsk] = useState<Ask>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [copies, setCopies] = useState<Copies | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(null);
  jobRef.current = job;
  const [error, setError] = useState<unknown>(null);

  const loadCopies = () => void rl.invoke('annotations:backups', {}).then(setCopies, () => setCopies(null));
  useEffect(loadCopies, []);
  useEffect(
    () =>
      rl.on('annotations:pdfProgress', (e) => {
        const j = jobRef.current;
        if (!j || e.jobId !== j.id) return;
        const state = e.state === 'running' || e.state === 'done' || e.state === 'cancelled' ? e.state : j.state;
        setJob({ ...j, done: e.done ?? j.done, total: e.total ?? j.total, state });
        if (state !== 'running') loadCopies();
      }),
    [],
  );

  if (!cfg) return null;
  const guard = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e);
    }
  };
  const start = (kind: 'migrate' | 'restore') =>
    guard(async () => {
      const r = await rl.invoke(kind === 'migrate' ? 'annotations:migrate' : 'annotations:restoreAll', {});
      setJob({ id: r.jobId, kind, done: 0, total: 0, state: 'running' });
    });
  const close = () => setAsk(null);
  const needsConsent = cfg.writeToPdf && cfg.writeToPdfConfirmedAt === null;

  const toggle = (on: boolean) => {
    if (on) {
      // Turning it on from here is the library's consent (D-348: the answer of the user, given in the settings).
      void sw.run(async () => {
        await patch({ annotations: { writeToPdf: true } });
        await rl.invoke('annotations:confirmPdfWrite', { choice: 'pdf' });
        await app.refresh();
      });
    } else {
      void rl.invoke('annotations:backups', {}).then(
        (c) => {
          setCopies(c);
          if (c.count > 0) setAsk('off');
          else void sw.run(() => patch({ annotations: { writeToPdf: false } }));
        },
        () => void sw.run(() => patch({ annotations: { writeToPdf: false } })),
      );
    }
  };

  return (
    <Group title={t('settings.annotations.title')} testId="library-annotations" sid="annotations">
      <Row sid="annotWrite" label={t('settings.annotations.write')} help={needsConsent ? t('settings.annotations.writeUnconfirmed') : t('settings.annotations.writeHint')} save={sw}>
        <Switch aria-label={t('settings.annotations.write')} checked={cfg.writeToPdf && !needsConsent} onChange={toggle} data-testid="annotations-write" />
      </Row>
      <Row sid="annotMigrate" label={t('settings.annotations.migrate')} help={t('settings.annotations.migrateHint')}>
        <Button
          size="sm"
          disabled={!cfg.writeToPdf || needsConsent || job?.state === 'running'}
          disabledReason={t('settings.annotations.needsWrite')}
          onClick={() =>
            void guard(async () => {
              setPlan(await rl.invoke('annotations:migrationPlan', {}));
              setAsk('migrate');
            })
          }
          data-testid="annotations-migrate"
        >
          {t('settings.annotations.migrateButton')}
        </Button>
      </Row>
      <Row sid="annotAuthor" label={t('settings.annotations.author')} help={t('settings.annotations.authorHint')} htmlFor="annotations-author" save={author}>
        <select
          id="annotations-author"
          value={cfg.author}
          onChange={(e) => void author.run(() => patch({ annotations: { author: e.target.value as 'profile' | 'none' } }))}
          data-testid="annotations-author"
        >
          <option value="none">{t('settings.annotations.authorNone')}</option>
          <option value="profile">{t('settings.annotations.authorProfile')}</option>
        </select>
      </Row>
      <Row sid="annotBackupLocation" label={t('settings.annotations.location')} help={t('settings.annotations.locationHint')} htmlFor="annotations-location" save={where}>
        <select
          id="annotations-location"
          value={cfg.backupLocation}
          onChange={(e) => void where.run(() => patch({ annotations: { backupLocation: e.target.value as 'data' | 'local' } }))}
          data-testid="annotations-location"
        >
          <option value="data">{t('settings.annotations.locationData')}</option>
          <option value="local">{t('settings.annotations.locationLocal')}</option>
        </select>
      </Row>
      <Row sid="annotCopies" label={t('settings.annotations.copies')} help={copies ? t('settings.annotations.copiesCount', { count: copies.count, size: formatSize(copies.bytes) }) : undefined}>
        <div className="pdf-info-actions">
          <Button size="sm" onClick={() => setAsk('restoreAll')} disabled={job?.state === 'running'} data-testid="annotations-restore-all">
            {t('settings.annotations.restoreAll')}
          </Button>
          <Button size="sm" onClick={() => setAsk('deleteCopies')} disabled={!copies || copies.count === 0} data-testid="annotations-delete-copies">
            {t('settings.annotations.deleteCopies')}
          </Button>
        </div>
      </Row>
      <SaveError save={sw} />
      {error ? (
        <p className="field-error" role="alert" data-testid="annotations-error">
          {t('settings.annotations.failed')}
        </p>
      ) : null}
      {job && (
        <div data-testid="annotations-job" data-state={job.state}>
          <ProgressBar value={job.done} max={job.total || undefined} label={t(job.kind === 'migrate' ? 'settings.annotations.migrating' : 'settings.annotations.restoring')} />
          <p className="set-help">
            {t(`settings.annotations.job_${job.state}`, { done: job.done, total: job.total })}
            {job.state === 'running' && (
              <>
                {' '}
                <Button size="sm" onClick={() => void rl.invoke('annotations:jobCancel', { jobId: job.id }).catch(() => {})} data-testid="annotations-job-cancel">
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </p>
        </div>
      )}

      {ask === 'migrate' && plan && (
        <Dialog title={t('settings.annotations.migrateTitle')} onClose={close} testId="annotations-migrate-dialog">
          <div className="pdf-dialog">
            <p>{t('settings.annotations.migrateFiles', { count: plan.files })}</p>
            <p>{t('settings.annotations.migrateSpace', { size: formatSize(plan.bytes) })}</p>
            {plan.skipped > 0 && <p>{t('settings.annotations.migrateSkipped', { count: plan.skipped })}</p>}
            <div className="pdf-dialog__actions">
              <Button onClick={close}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                disabled={plan.files === 0}
                onClick={() => {
                  close();
                  void start('migrate');
                }}
                data-testid="annotations-migrate-confirm"
              >
                {t('settings.annotations.migrateConfirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {ask === 'off' && (
        <Dialog title={t('settings.annotations.offTitle')} onClose={close} testId="annotations-off-dialog">
          <div className="pdf-dialog">
            <p>{t('settings.annotations.offBody', { count: copies?.count ?? 0 })}</p>
            <div className="pdf-dialog__actions">
              <Button
                onClick={() => {
                  close();
                  void sw.run(() => patch({ annotations: { writeToPdf: false } }));
                }}
                data-testid="annotations-off-leave"
              >
                {t('settings.annotations.offLeave')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  void sw.run(() => patch({ annotations: { writeToPdf: false } }));
                  void start('restore');
                }}
                data-testid="annotations-off-restore"
              >
                {t('settings.annotations.offRestore', { count: copies?.count ?? 0 })}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {ask === 'restoreAll' && (
        <Dialog title={t('settings.annotations.restoreTitle')} onClose={close} testId="annotations-restore-dialog">
          <div className="pdf-dialog">
            <p>{t('settings.annotations.restoreBody')}</p>
            <div className="pdf-dialog__actions">
              <Button onClick={close}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  close();
                  void start('restore');
                }}
                data-testid="annotations-restore-confirm"
              >
                {t('settings.annotations.restoreConfirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {ask === 'deleteCopies' && (
        <Dialog title={t('settings.annotations.deleteTitle')} onClose={close} testId="annotations-delete-dialog">
          <div className="pdf-dialog">
            <p>{t('settings.annotations.deleteBody', { count: copies?.count ?? 0 })}</p>
            <div className="pdf-dialog__actions">
              <Button onClick={close}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  close();
                  void guard(async () => {
                    await rl.invoke('annotations:deleteBackups', {});
                    loadCopies();
                  });
                }}
                data-testid="annotations-delete-confirm"
              >
                {t('settings.annotations.deleteConfirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Group>
  );
}
