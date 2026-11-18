import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { ErrorNote, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { bibFileName } from './importModel';
import '../chat/dialogs.css';
import './import.css';

type Status = ResponseOf<Channels, 'bib:link'>;

/** "Link a .bib file…" (17.4.2): the folder (chosen with the folder dialog) and the file name; the app rewrites it when the project changes. */
export default function LinkBibDialog({ projectId, projectName, status, onClose, onDone }: { projectId: string; projectName: string; status: Status | null; onClose(): void; onDone(linked: boolean): void }) {
  const { t } = useTranslation();
  const [dir, setDir] = useState<{ path: string; name: string } | null>(null);
  const [name, setName] = useState(status?.file ?? bibFileName(projectName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const f = await rl.invoke('dialog:chooseFolder', { purpose: 'export-destination', title: t('import.linkFolderTitle') }).catch(() => null);
    if (f) setDir(f);
  };
  const reason = (e: unknown): string => {
    const err = RlError.from(e);
    const r = typeof err.details?.reason === 'string' ? err.details.reason : '';
    return ['not-ours', 'inside-library', 'invalid-name'].includes(r) ? t(`import.linkError.${r}`) : errorMessage(e, t);
  };
  const link = async () => {
    if (!dir) return;
    setBusy(true);
    setError(null);
    try {
      await rl.invoke('bib:link', { projectId, op: 'link', destination: dir.path, fileName: name });
      onDone(true);
      onClose();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    setBusy(true);
    try {
      await rl.invoke('bib:link', { projectId, op: 'unlink' });
      onDone(false);
      onClose();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('import.linkTitle')} onClose={onClose} testId="link-bib-dialog">
      <div className="dlg-scroll import-dialog">
        <p className="hint">{t('import.linkHint')}</p>
        {status?.linked && <p data-testid="link-bib-current">{t('import.linkCurrent', { file: status.file })}</p>}
        {error && <ErrorNote testId="link-bib-error">{error}</ErrorNote>}
        <div className="group">
          <Button onClick={() => void pick()} data-testid="link-bib-folder">
            {t('import.linkChoose')}
          </Button>
          {dir && <p data-testid="link-bib-dir">{dir.name}</p>}
          <TextField label={t('import.linkName')} value={name} onChange={(e) => setName(e.target.value)} data-testid="link-bib-name" />
        </div>
      </div>
      <div className="actions dlg-foot">
        {status?.linked && (
          <Button onClick={() => void unlink()} busy={busy} data-testid="link-bib-unlink">
            {t('import.unlink')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" busy={busy} disabled={!dir || name.trim() === ''} disabledReason={t('import.linkNeedsFolder')} onClick={() => void link()} data-testid="link-bib-run">
          {t('import.link')}
        </Button>
      </div>
    </Dialog>
  );
}
