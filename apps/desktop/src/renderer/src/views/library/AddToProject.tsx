import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from './safeText';

type Summary = ResponseOf<Channels, 'projects:list'>['items'][number];

/** "Add to project": picks an existing project (or makes a new one) and puts the selected documents in it. */
export function AddToProject({ docIds, onClose }: { docIds: string[]; onClose(): void }) {
  const { t } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { info, reportError } = useNotify();
  const [projects, setProjects] = useState<Summary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'project' | 'collection'>('project');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    rl.invoke('projects:list', {}).then(
      (r) => alive && setProjects(r.items),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, []);

  const done = (projectName: string) => {
    invalidate('projects');
    info(t('projects.added', { count: docIds.length, name: projectName }));
    onClose();
  };

  const addTo = async (p: Summary) => {
    setBusy(true);
    try {
      await rl.invoke('projects:addMembers', { projectId: p.id, docIds });
      done(p.name);
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await rl.invoke('projects:create', { name: name.trim(), kind, docIds });
      done(r.project.name);
    } catch (err) {
      reportError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('projects.addTitle', { count: docIds.length })} onClose={onClose} testId="add-to-project">
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {projects === null && !error && <p className="hint">{t('common.loading')}</p>}
      {projects && projects.length === 0 && <p className="hint">{t('projects.noneYet')}</p>}
      {projects && projects.length > 0 && (
        <ul className="pick-list" aria-label={t('projects.pick')}>
          {projects.map((p) => (
            <li key={p.id}>
              <button type="button" className="pick" disabled={busy} onClick={() => void addTo(p)} data-testid="pick-project" data-project-id={p.id}>
                <span className="pick-name">{safeText(p.name)}</span>
                <span className="hint">{t(`projects.kind.${p.kind}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form stacked" onSubmit={(e) => void create(e)}>
        <h3>{t('projects.newFromSelection')}</h3>
        <div className="field">
          <label htmlFor="new-project-name">{t('projects.name')}</label>
          <input id="new-project-name" type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="new-project-name" />
        </div>
        <div className="radio-row" role="radiogroup" aria-label={t('projects.kindLabel')}>
          {(['project', 'collection'] as const).map((k) => (
            <label key={k} className="radio-chip">
              <input type="radio" name="new-project-kind" checked={kind === k} onChange={() => setKind(k)} />
              <span>{t(`projects.kind.${k}`)}</span>
            </label>
          ))}
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy || !name.trim()} data-testid="create-project-with-selection">
            {t('projects.createWith', { count: docIds.length })}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
