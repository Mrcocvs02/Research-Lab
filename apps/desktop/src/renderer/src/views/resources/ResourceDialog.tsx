import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RESOURCE_KINDS, type ResourceKind } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { ErrorNote, SelectField, TextAreaField, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { RlError } from '../../lib/rl-error';
import { rl } from '../../lib/rl';
import '../chat/dialogs.css';
import './resources.css';
import { guessKind } from './model';

type Kind = Exclude<ResourceKind, 'reference'>;
const KINDS = RESOURCE_KINDS.filter((k): k is Kind => k !== 'reference');

/** "+ Add > Resource or link..." (17.4.4): a web address, or a file or folder of the library. Nothing is fetched here. */
export default function ResourceDialog({ docId, onClose }: { docId?: string; onClose(): void }) {
  const { t } = useTranslation();
  const { info } = useNotify();
  const [kind, setKind] = useState<Kind>('web');
  const [kindTouched, setKindTouched] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<{ path: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const r = RlError.from(e).details?.['reason'];
    const key = typeof r === 'string' ? `resources.add.reason.${r}` : '';
    setError(key !== '' && t(key, { defaultValue: '' }) !== '' ? t(key) : errorMessage(e, t));
  };

  const pick = async (what: 'file' | 'folder') => {
    setError(null);
    try {
      const r =
        what === 'file'
          ? await rl.invoke('dialog:chooseFile', { purpose: 'resource-file', title: t('resources.add.chooseTitle') })
          : await rl.invoke('dialog:chooseFolder', { purpose: 'resource-folder', title: t('resources.add.chooseFolderTitle') });
      if (!r) return;
      setPicked({ path: r.path, name: r.name });
      setUrl('');
      if (what === 'folder') setKind('folder');
      else if (!kindTouched) setKind(/\.ipynb$/i.test(r.name) ? 'notebook' : 'data');
    } catch (e) {
      fail(e);
    }
  };

  const submit = async () => {
    setError(null);
    if (!picked && url.trim() === '') return setError(t('resources.add.need'));
    setBusy(true);
    try {
      await rl.invoke('resources:add', {
        kind,
        ...(picked ? { path: picked.path } : { url: url.trim() }),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        docIds: docId ? [docId] : [],
        projectIds: [],
      });
      info(t('resources.add.done'));
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('resources.add.title')} onClose={onClose} testId="resource-dialog">
      <div className="dlg-scroll resource-dialog">
        {error && <ErrorNote testId="resource-error">{error}</ErrorNote>}
        <TextField
          label={t('resources.add.url')}
          hint={t('resources.add.urlHint')}
          value={url}
          maxLength={2048}
          placeholder="https://"
          disabled={picked !== null}
          onChange={(e) => {
            setUrl(e.target.value);
            if (!kindTouched) setKind(guessKind(e.target.value));
          }}
          data-testid="resource-url"
        />
        <div className="resource-dialog__local">
          <span className="hint">{t('resources.add.orLocal')}</span>
          <Button onClick={() => void pick('file')} data-testid="resource-choose-file">
            {t('resources.add.chooseFile')}
          </Button>
          <Button onClick={() => void pick('folder')} data-testid="resource-choose-folder">
            {t('resources.add.chooseFolder')}
          </Button>
          {picked && (
            <span data-testid="resource-picked">
              {t('resources.add.chosen', { name: picked.name })}{' '}
              <button type="button" className="link" onClick={() => setPicked(null)}>
                {'×'}
              </button>
            </span>
          )}
        </div>
        <SelectField
          label={t('resources.add.kind')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setKindTouched(true);
          }}
          data-testid="resource-kind"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`resources.kind.${k}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('resources.add.name')} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="resource-title" />
        <TextAreaField label={t('resources.add.description')} rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} data-testid="resource-description" />
        <p className="hint">{t('resources.add.previewNote')}</p>
        {docId && <p className="hint">{t('resources.add.linkedTo')}</p>}
      </div>
      <div className="actions dlg-foot">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" busy={busy} onClick={() => void submit()} data-testid="resource-submit">
          {t('resources.add.submit')}
        </Button>
      </div>
    </Dialog>
  );
}
