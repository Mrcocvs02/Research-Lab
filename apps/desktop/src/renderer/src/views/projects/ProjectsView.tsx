import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { IconPlus } from '../../components/icons';
import { IconProject } from '../../components/icons-shell';
import { Popover } from '../../components/Popover';
import { Segmented } from '../../components/Segmented';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { ProjectDetailView } from './ProjectDetailView';
import { ProjectMoreMenu } from './ProjectMoreMenu';
import { ViewHead } from './ViewHead';
import './projects.css';

type Summary = ResponseOf<Channels, 'projects:list'>['items'][number];
type Kind = 'project' | 'collection';

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

/** A row of 56 px: name, kind, documents and last change; the actions are Open (the name) and the menu. */
function ProjectRow({ p, onOpen }: { p: Summary; onOpen(): void }) {
  const { t, i18n } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { reportError } = useNotify();
  const { openExport } = useAiUi();
  const archived = p.status === 'archived';
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
      <div className="project-row__main">
        <button type="button" className="link project-name" onClick={onOpen} data-testid="project-open">
          {safeText(p.name)}
        </button>
        <span className="project-row__kind">{t(`projects.kind.${p.kind}`)}</span>
        {p.status !== 'active' && <Chip kind="status">{t(`projects.status.${p.status}`)}</Chip>}
        <time className="project-row__date" dateTime={p.updatedAt} title={t('projects.updated')}>
          {new Date(p.updatedAt).toLocaleDateString(i18n.language)}
        </time>
      </div>
      <p className="project-summary" data-testid="project-summary" title={p.description ? safeText(p.description) : undefined}>
        {t('projects.counts', { total: p.counts.total, toRead: p.counts.toRead, reading: p.counts.reading, read: p.counts.read })}
      </p>
      <Progress counts={p.counts} />
      <div className="project-row__more">
        <ProjectMoreMenu archived={archived} size="sm" testId="project-row-more" label={t('projects.moreOf', { name: safeText(p.name) })} onExport={() => openExport({ projectId: p.id, name: p.name })} onToggleArchive={() => void toggleArchive()} />
      </div>
    </li>
  );
}

/** The popover behind "+ New project": a name, Project or Collection with a sentence for each, and Create. */
function NewProject({ anchor, open, onClose, onCreated }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose(): void; onCreated(id: string): void }) {
  const { t } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { reportError } = useNotify();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('project');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await rl.invoke('projects:create', { name: name.trim(), kind });
      setName('');
      onClose();
      invalidate('projects');
      onCreated(r.project.id);
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} label={t('projects.new')} width={340} placement="bottom-end">
      <form className="project-create" onSubmit={(e) => void create(e)} data-testid="project-create-form">
        <div className="field">
          <label htmlFor="project-new-name">{t('projects.name')}</label>
          <input id="project-new-name" type="text" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="project-create-name" />
        </div>
        <Segmented<Kind>
          label={t('projects.kindLabel')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'project', label: t('projects.kind.project'), testId: 'project-kind-project' },
            { value: 'collection', label: t('projects.kind.collection'), testId: 'project-kind-collection' },
          ]}
        />
        <p className="hint" data-testid="project-kind-hint">
          {t(`projects.kindHint.${kind}`)}
        </p>
        <div className="project-create__foot">
          <Button type="submit" variant="primary" disabled={!name.trim()} data-testid="project-create">
            {t('projects.create')}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

/** The Projects section: the list (state and reading summary, one primary to create), and the detail of the open one. The open project is a place of the window (`loc.projectId`), so Back and the crumbs work. */
export function ProjectsView() {
  const { t } = useTranslation();
  const app = useApp();
  const nav = useNav();
  const version = useChangeVersion('projects');
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const newAnchor = useRef<HTMLSpanElement>(null);
  const openId = nav.loc.view === 'projects' ? (nav.loc.projectId ?? null) : null;
  const open = (id: string) => nav.navigate({ view: 'projects', projectId: id });

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

  if (openId) {
    return (
      <div className="view projects-page" data-testid="section-projects">
        <ProjectDetailView key={openId} id={openId} />
      </div>
    );
  }

  return (
    <div className="view projects-page" data-testid="section-projects">
      <ViewHead title={t('sections.projects')} sub={items ? t('projects.count', { count: items.length }) : undefined}>
        <span ref={newAnchor}>
          <Button variant="primary" icon={<IconPlus size={16} />} aria-haspopup="dialog" aria-expanded={creating} onClick={() => setCreating(!creating)} data-testid="project-new">
            {t('projects.new')}
          </Button>
        </span>
      </ViewHead>
      <NewProject anchor={newAnchor} open={creating} onClose={() => setCreating(false)} onCreated={open} />
      <div className="vbar">
        <span data-testid="show-archived">
          <Chip selected={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {t('projects.showArchived')}
          </Chip>
        </span>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {items && items.length === 0 && (
        <div data-testid="projects-empty">
          <EmptyState
            icon={<IconProject size={24} />}
            title={showArchived ? t('projects.none') : t('projects.emptyTitle')}
            action={
              <Button variant="secondary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)} data-testid="projects-empty-new">
                {t('projects.new')}
              </Button>
            }
          >
            {t('projects.createHint')}
          </EmptyState>
        </div>
      )}
      <ul className="project-list" data-testid="projects-list">
        {items?.map((p) => (
          <ProjectRow key={p.id} p={p} onOpen={() => open(p.id)} />
        ))}
      </ul>
    </div>
  );
}
