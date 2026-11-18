import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { HistoryControls } from '../../lib/history';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { ProjectDetailView } from './ProjectDetailView';
import './projects.css';

type Summary = ResponseOf<Channels, 'projects:list'>['items'][number];

function Progress({ counts }: { counts: Summary['counts'] }) {
  const { t } = useTranslation();
  const total = Math.max(1, counts.total);
  return (
    <div className="study-bar" role="img" aria-label={t('projects.counts', { total: counts.total, toRead: counts.toRead, reading: counts.reading, read: counts.read })}>
      <span className="study-bar-read" style={{ width: `${(counts.read / total) * 100}%` }} />
      <span className="study-bar-reading" style={{ width: `${(counts.reading / total) * 100}%` }} />
    </div>
  );
}

function ProjectRow({ p, onOpen }: { p: Summary; onOpen(): void }) {
  const { t } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { reportError } = useNotify();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  useEffect(() => setName(p.name), [p.name]);

  const archived = p.status === 'archived';
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    setRenaming(false);
    if (!name.trim() || name.trim() === p.name) return;
    try {
      await rl.invoke('projects:update', { id: p.id, patch: { name: name.trim() }, expectedRevision: p.revision });
      invalidate('projects');
    } catch (err) {
      reportError(err);
    }
  };
  const toggleArchive = async () => {
    try {
      await rl.invoke(archived ? 'projects:restore' : 'projects:delete', { id: p.id });
      invalidate('projects');
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <li className={archived ? 'project-row archived' : 'project-row'} data-testid="project-row" data-project-id={p.id} data-status={p.status}>
      <div className="project-main">
        {renaming ? (
          <form className="inline-form" onSubmit={(e) => void rename(e)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}>
            <input type="text" autoFocus value={name} maxLength={200} aria-label={t('projects.name')} onChange={(e) => setName(e.target.value)} data-testid="project-rename-input" />
            <button type="submit" className="primary">
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </button>
          </form>
        ) : (
          <button type="button" className="link project-name" onClick={onOpen} data-testid="project-open">
            {safeText(p.name)}
          </button>
        )}
        <span className="badge">{t(`projects.kind.${p.kind}`)}</span>
        <span className={`badge badge-status-${p.status}`}>{t(`projects.status.${p.status}`)}</span>
      </div>
      {p.description && <p className="hint">{safeText(p.description)}</p>}
      <p className="project-summary" data-testid="project-summary">
        {t('projects.counts', { total: p.counts.total, toRead: p.counts.toRead, reading: p.counts.reading, read: p.counts.read })}
      </p>
      <Progress counts={p.counts} />
      <div className="row-actions">
        {!renaming && (
          <button type="button" className="link" onClick={() => setRenaming(true)} data-testid="project-rename">
            {t('projects.rename')}
          </button>
        )}
        <button type="button" className="link" onClick={() => void toggleArchive()} data-testid={archived ? 'project-restore' : 'project-archive'}>
          {archived ? t('projects.restore') : t('projects.archive')}
        </button>
      </div>
    </li>
  );
}

/** The Projects section: list with state and reading summary, a form to create one, and the detail of the open one. */
/** The last chat link to a project this view acted on, so that an old link does not reopen it later. */
let consumedNavigation = 0;

export function ProjectsView() {
  const { t } = useTranslation();
  const app = useApp();
  const version = useChangeVersion('projects');
  const { invalidate } = useLibraryEvents();
  const { reportError } = useNotify();
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { navigation } = useAiUi();
  useEffect(() => {
    if (navigation?.to === 'project' && navigation.projectId && navigation.nonce !== consumedNavigation) {
      consumedNavigation = navigation.nonce;
      setOpenId(navigation.projectId);
    }
  }, [navigation]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'project' | 'collection'>('project');

  useEffect(() => {
    if (!app.activeLibraryId) return;
    let alive = true;
    rl.invoke('projects:list', { includeArchived: showArchived }).then(
      (r) => {
        if (!alive) return;
        setItems(r.items);
        setError(null);
      },
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [app.activeLibraryId, showArchived, version]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await rl.invoke('projects:create', { name: name.trim(), kind });
      setName('');
      invalidate('projects');
      setOpenId(r.project.id);
    } catch (err) {
      reportError(err);
    }
  };

  if (openId) {
    return (
      <div className="view projects-page" data-testid="section-projects">
        <ProjectDetailView key={openId} id={openId} onBack={() => setOpenId(null)} />
      </div>
    );
  }

  return (
    <div className="view projects-page" data-testid="section-projects">
      <header className="library-head">
        <h1>{t('sections.projects')}</h1>
        <HistoryControls />
      </header>
      <form className="card project-create" onSubmit={(e) => void create(e)}>
        <h2>{t('projects.new')}</h2>
        <div className="inline-form">
          <div className="field grow">
            <label htmlFor="project-new-name">{t('projects.name')}</label>
            <input id="project-new-name" type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="project-create-name" />
          </div>
          <div className="radio-row" role="radiogroup" aria-label={t('projects.kindLabel')}>
            {(['project', 'collection'] as const).map((k) => (
              <label key={k} className="radio-chip">
                <input type="radio" name="project-kind" checked={kind === k} onChange={() => setKind(k)} data-testid={`project-kind-${k}`} />
                <span>{t(`projects.kind.${k}`)}</span>
              </label>
            ))}
          </div>
          <button type="submit" className="primary" disabled={!name.trim()} data-testid="project-create">
            {t('projects.create')}
          </button>
        </div>
        <p className="hint">{t('projects.createHint')}</p>
      </form>

      <div className="check">
        <input id="show-archived" type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="show-archived" />
        <label htmlFor="show-archived">{t('projects.showArchived')}</label>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {items && items.length === 0 && (
        <p className="empty" data-testid="projects-empty">
          {t('projects.none')}
        </p>
      )}
      <ul className="project-list" data-testid="projects-list">
        {items?.map((p) => (
          <ProjectRow key={p.id} p={p} onOpen={() => setOpenId(p.id)} />
        ))}
      </ul>
    </div>
  );
}
