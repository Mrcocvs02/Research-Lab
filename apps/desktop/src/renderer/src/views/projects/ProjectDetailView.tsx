import { useCallback, useDeferredValue, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Lazy, lazyRetry, lazyView } from '../../components/Lazy';
import { useTranslation } from 'react-i18next';
import type { Channels, ProjectDetail, ResponseOf, StudyState } from '@rl/core';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { IconChevronDown, IconPlus } from '../../components/icons';
import { IconProject } from '../../components/icons-shell';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Segmented } from '../../components/Segmented';
import { Tabs, tabIds } from '../../components/Tabs';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useAiUi } from '../../lib/aiUi';
import { useLibraryEvents } from '../../lib/events';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { BibBanner } from './BibBanner';
import { ProjectMoreMenu } from './ProjectMoreMenu';
import { useBibStatus } from './useBibStatus';
import { ReadingPlanPanel } from './ReadingPlanPanel';
import { ViewHead } from './ViewHead';
import { toRequestItems, type PlanItemView } from './readingPlan';
import './projects.css';
import '../notes/notes.css';

/** At most four tabs (D-411): Schema appears once the project has a research outline or a claim (§17.4.13). */
type Tab = 'members' | 'plan' | 'notes' | 'schema';
type SchemaInfo = ResponseOf<Channels, 'project:schema'>;
const STATES: StudyState[] = ['to-read', 'reading', 'read'];

// The Markdown renderer is loaded when the preview is first shown; the add-documents dialog when it is first asked for.
const Markdown = lazyRetry(() => import('../../lib/markdown').then((m) => ({ default: m.Markdown })));
const AddDocuments = lazyRetry(() => import('./AddDocumentsDialog'));
// The Schema tab, the report and the citation suggestions: three lazy chunks, loaded when first shown (X7).
const SchemaTab = lazyView(() => import('./SchemaTab'), ['projects']);
const ReportDialog = lazyView(() => import('./ReportDialog'), ['projects']);
const CiteDialog = lazyView(() => import('./CiteDialog'), ['projects']);
const PrismaDialog = lazyView(() => import('./PrismaDialog'), ['projects', 'discover', 'export']);
const LinkBibDialog = lazyView(() => import('../import/LinkBibDialog'), ['import']);

/** Notes in Markdown: a plain text box, a preview next to it (rendered without any raw HTML), saved on demand or on leaving the box. */
function NotesEditor({ detail, onSave }: { detail: ProjectDetail; onSave(notes: string): Promise<void> }) {
  const { t } = useTranslation();
  const saved = detail.project.notes;
  const [text, setText] = useState(saved);
  const [layout, setLayout] = useState<'split' | 'edit' | 'preview'>('split');
  const preview = useDeferredValue(text);
  const id = useId();
  // The saved notes changed under us (reload, undo): show them unless the user has unsaved typing.
  const lastSaved = useRef(saved);
  useEffect(() => {
    setText((cur) => (cur === lastSaved.current ? saved : cur));
    lastSaved.current = saved;
  }, [saved]);
  const dirty = text !== saved;
  const save = () => {
    if (dirty) void onSave(text);
  };
  return (
    <div className="notes" data-testid="project-notes">
      <div className="notes-bar">
        <Segmented<'split' | 'edit' | 'preview'>
          label={t('notes.layout')}
          size="sm"
          value={layout}
          onChange={setLayout}
          options={(['split', 'edit', 'preview'] as const).map((l) => ({ value: l, label: t(`notes.layout_${l}`), testId: `notes-layout-${l}` }))}
        />
        <span className="spacer" />
        <span className="hint" data-testid="notes-state">
          {dirty ? t('notes.unsaved') : t('notes.saved')}
        </span>
        <Button variant="primary" size="sm" onClick={save} disabled={!dirty} data-testid="notes-save">
          {t('common.save')}
        </Button>
      </div>
      <div className={`notes-panes notes-${layout}`}>
        {layout !== 'preview' && (
          <div className="field notes-edit">
            <label htmlFor={id}>{t('notes.label')}</label>
            <textarea id={id} value={text} maxLength={200_000} onChange={(e) => setText(e.target.value)} onBlur={save} spellCheck data-testid="notes-input" />
            <p className="hint">{t('notes.markdownHint')}</p>
          </div>
        )}
        {layout !== 'edit' && (
          <div className="notes-preview" aria-label={t('notes.preview')} data-testid="notes-preview">
            {preview.trim() === '' ? <p className="hint">{t('notes.empty')}</p> : <Lazy><Markdown source={preview} /></Lazy>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Name and description of a project, edited in a dialog from "Rename" and saved with one button. */
function RenameDialog({ project, onSave, onClose }: { project: ProjectDetail['project']; onSave(patch: Record<string, unknown>): Promise<unknown>; onClose(): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== project.name) patch.name = name.trim();
    if (description !== project.description) patch.description = description;
    onClose();
    if (Object.keys(patch).length > 0) void onSave(patch);
  };
  return (
    <Dialog title={t('projects.renameTitle')} onClose={onClose} testId="project-rename-dialog">
      <form className="project-rename" onSubmit={submit}>
        <div className="field">
          <label htmlFor="project-name">{t('projects.name')}</label>
          <input id="project-name" type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="project-name" />
        </div>
        <div className="field">
          <label htmlFor="project-desc">{t('projects.description')}</label>
          <textarea id="project-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="project-description" />
        </div>
        <div className="actions">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()} data-testid="project-rename-save">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The status badge: a button with the three states for a live project, a plain badge once archived. */
function StatusBadge({ project, onChange }: { project: ProjectDetail['project']; onChange(status: string): void }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (project.status === 'archived') {
    return (
      <span data-testid="project-status">
        <Chip kind="status">{t('projects.status.archived')}</Chip>
      </span>
    );
  }
  const groups: MenuGroups = [{ id: 'status', label: t('projects.statusLabel'), items: (['active', 'paused', 'done'] as const).map((s) => ({ id: s, testId: `project-state-${s}`, label: t(`projects.status.${s}`), onSelect: () => project.status !== s && onChange(s) })) }];
  return (
    <>
      <button ref={anchor} type="button" className={`project-status badge-status-${project.status}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={t('projects.statusLabel')} data-testid="project-status">
        {t(`projects.status.${project.status}`)}
        <IconChevronDown size={16} />
      </button>
      <Menu anchor={anchor} open={open} onClose={() => setOpen(false)} groups={groups} label={t('projects.statusLabel')} placement="bottom-start" width={200} />
    </>
  );
}

/** A project: crumbs "Projects > Name" in the top bar, a status badge, the documents with their study state, the reading plan, and notes. */
export function ProjectDetailView({ id }: { id: string }) {
  const { t } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { info, reportError } = useNotify();
  const { openExport } = useAiUi();
  const bib = useBibStatus(id);
  const [linking, setLinking] = useState(false);
  const nav = useNav();
  const setNavTitle = nav.setTitle;
  const [detail, setDetailState] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('members');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  /** The Schema tab was asked for ("Write it now") before there is an outline to show. */
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'report'; open?: string } | { kind: 'cite' } | { kind: 'prisma' } | null>(null);
  const detailRef = useRef<ProjectDetail | null>(null);
  /** The ref is what writes read their revision from; it moves with the state, never back to an older render. */
  const setDetail = useCallback((d: ProjectDetail) => {
    detailRef.current = d;
    setDetailState(d);
  }, []);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const writes = useRef(0);
  /** A read was dropped because a write was in flight: read again when the writes are done. */
  const stale = useRef(false);

  // Own writes answer with the new detail; what comes from elsewhere arrives as `library:changed` (a scan, the document panel, undo): reload only when it names this project or one of its members.
  const [pushed, setPushed] = useState(0);
  const memberIds = useRef<Set<string>>(new Set());
  memberIds.current = new Set(detail?.members.map((m) => m.docId));
  useEffect(
    () =>
      rl.on('library:changed', (e) => {
        if (e.kind === 'projects' ? !e.ids || e.ids.includes(id) : e.kind === 'documents' && (!e.ids || e.ids.some((d) => memberIds.current.has(d)))) setPushed((n) => n + 1);
      }),
    [id],
  );

  useEffect(() => {
    let alive = true;
    rl.invoke('projects:get', { id }).then(
      (d) => {
        // A write is in flight: its answer is newer than this read (which may be the echo of an earlier write).
        if (!alive) return;
        if (writes.current > 0) {
          stale.current = true;
          return;
        }
        setDetail(d);
        setError(null);
      },
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [id, pushed]);

  // The research outline, claims and reports of the project (nothing leaves the machine).
  useEffect(() => {
    let alive = true;
    rl.invoke('project:schema', { projectId: id }).then((r) => alive && setSchema(r), () => alive && setSchema(null));
    return () => {
      alive = false;
    };
  }, [id, pushed]);

  // The last crumb of the top bar is the project's name.
  const title = detail?.project.name;
  useEffect(() => {
    if (title !== undefined) setNavTitle(title);
  }, [title, setNavTitle]);

  /** Runs one write after the previous one, so each uses the revision the last answer carried. */
  const run = useCallback(
    (op: (current: ProjectDetail) => Promise<ProjectDetail>): Promise<boolean> => {
      writes.current++;
      const job = queue.current.then(async (): Promise<boolean> => {
        const current = detailRef.current;
        try {
          if (!current) return false;
          const next = await op(current);
          // Later writes are queued: keep what the user sees (their optimistic order) until the last answer; only the revision moves on.
          if (writes.current > 1) detailRef.current = next;
          else setDetail(next);
          invalidate('projects');
          return true;
        } catch (e) {
          reportError(e);
          return false;
        } finally {
          if (--writes.current === 0 && stale.current) {
            stale.current = false;
            setPushed((n) => n + 1);
          }
        }
      });
      queue.current = job;
      return job;
    },
    [invalidate, reportError, setDetail],
  );

  const update = (patch: Record<string, unknown>) => run((d) => rl.invoke('projects:update', { id, patch, expectedRevision: d.project.revision }));
  const savePlan = (items: PlanItemView[]) => {
    // Show the new order at once; the answer replaces it.
    if (detailRef.current) setDetail({ ...detailRef.current, readingPlan: items });
    return run((d) => rl.invoke('projects:setReadingPlan', { projectId: id, items: toRequestItems(items), expectedRevision: d.project.revision }));
  };
  const setDocState = async (docId: string, state: StudyState) => {
    try {
      await rl.invoke('documents:update', { docId, patch: { studyState: state } });
      invalidate('projects');
      invalidate('documents');
      setPushed((n) => n + 1);
    } catch (e) {
      reportError(e);
    }
  };
  const removeMembers = async () => {
    const docIds = [...picked];
    setConfirmRemove(false);
    setPicked(new Set());
    const ok = await run(() => rl.invoke('projects:removeMembers', { projectId: id, docIds }));
    if (ok) info(t('projects.removed', { count: docIds.length }));
  };
  const toggleArchive = async () => {
    try {
      await rl.invoke(detailRef.current?.project.status === 'archived' ? 'projects:restore' : 'projects:delete', { id });
      invalidate('projects');
      setPushed((n) => n + 1);
    } catch (e) {
      reportError(e);
    }
  };

  if (error && !detail) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (!detail) return <p className="hint">{t('common.loading')}</p>;
  const p = detail.project;
  const archived = p.status === 'archived';
  const allPicked = detail.members.length > 0 && detail.members.every((m) => picked.has(m.docId));
  const tabs = [
    { id: 'members', label: t('projects.tabs.members') },
    { id: 'plan', label: t('projects.tabs.plan') },
    { id: 'notes', label: t('projects.tabs.notes') },
    ...(schemaOpen || (schema && (schema.outline !== null || schema.claims.length > 0)) ? [{ id: 'schema', label: t('schema.tab') }] : []),
  ];
  const hasOutline = !!schema?.outline && schema.outline.idea.trim() !== '';
  const addButton = (variant: 'primary' | 'secondary', testId: string) => (
    <Button variant={variant} icon={<IconPlus size={16} />} disabled={archived} disabledReason={t('projects.archivedNoAdd')} onClick={() => setAdding(true)} data-testid={testId}>
      {t('projects.addDocs')}
    </Button>
  );

  return (
    <div className="project-detail" data-testid="project-detail" data-project-id={id}>
      <ViewHead
        title={safeText(p.name)}
        titleTestId="project-title"
        sub={
          <>
            <StatusBadge project={p} onChange={(status) => void update({ status })} />
            {p.kind !== 'project' && <span>{t(`projects.kind.${p.kind}`)}</span>}
            <span data-testid="project-counts">
              {t('projects.counts', { total: p.counts.total, toRead: p.counts.toRead, reading: p.counts.reading, read: p.counts.read })}
              {p.counts.missing > 0 && ` · ${t('projects.missingCount', { count: p.counts.missing })}`}
            </span>
          </>
        }
      >
        {addButton('primary', 'project-add-docs')}
        <ProjectMoreMenu archived={archived} testId="project-more" label={t('projects.more')} onExport={() => openExport({ projectId: id, name: p.name })} onRename={() => setRenaming(true)} onReport={() => setDialog({ kind: 'report' })} reportDisabled={hasOutline ? undefined : t('schema.report.needOutline')} onCite={() => setDialog({ kind: 'cite' })} onToggleArchive={() => void toggleArchive()} onLinkBib={() => setLinking(true)} onPrisma={() => setDialog({ kind: 'prisma' })} bibTitle={bib?.linked ? t('projects.bib.linkedTo', { file: bib.file, time: new Date(bib.at ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : undefined} />
      </ViewHead>
      <BibBanner projectId={id} status={bib} />
      {linking && (
        <Lazy>
          <LinkBibDialog projectId={id} projectName={p.name} status={bib} onClose={() => setLinking(false)} onDone={() => invalidate('projects')} />
        </Lazy>
      )}
      {p.description && (
        <p className="project-description" data-testid="project-description-text">
          {safeText(p.description)}
        </p>
      )}

      <Tabs tabs={tabs} value={tab} onChange={(x) => setTab(x as Tab)} label={t('projects.sections')} idBase="ptab" testIdBase="project-tab" />

      <div role="tabpanel" id={tabIds('ptab', tab).panelId} aria-labelledby={tabIds('ptab', tab).tabId}>
        {tab === 'members' && (
          <div data-testid="project-members">
            {detail.members.length === 0 ? (
              <div data-testid="members-empty">
                <EmptyState icon={<IconProject size={24} />} title={t('projects.emptyDocsTitle')} action={addButton('secondary', 'members-empty-add')}>
                  {t('projects.noMembers')}
                </EmptyState>
              </div>
            ) : (
              <>
                {picked.size > 0 && (
                  <div className="vbar vbar--selection" role="toolbar" aria-label={t('projects.selectionActions')} data-testid="members-selection">
                    <b className="vbar__count">{t('projects.selected', { count: picked.size })}</b>
                    {confirmRemove ? (
                      <>
                        <Button variant="danger" size="sm" onClick={() => void removeMembers()} data-testid="members-remove-confirm">
                          {t('projects.removeConfirm', { count: picked.size })}
                        </Button>
                        <Button size="sm" onClick={() => setConfirmRemove(false)}>
                          {t('common.cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => setConfirmRemove(true)} data-testid="members-remove">
                        {t('projects.removeSelected', { count: picked.size })}
                      </Button>
                    )}
                    <span className="vbar__spacer" />
                    <Button variant="ghost" size="sm" onClick={() => (setPicked(new Set()), setConfirmRemove(false))} data-testid="members-clear">
                      {t('projects.clearSelection')}
                    </Button>
                  </div>
                )}
                <table className="members-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <input type="checkbox" checked={allPicked} aria-label={t('projects.pickAll')} onChange={(e) => setPicked(e.target.checked ? new Set(detail.members.map((m) => m.docId)) : new Set())} data-testid="members-pick-all" />
                      </th>
                      <th scope="col">{t('doc.title')}</th>
                      <th scope="col">{t('doc.authors')}</th>
                      <th scope="col">{t('doc.year')}</th>
                      <th scope="col">{t('doc.studyState')}</th>
                      <th scope="col">{t('doc.path')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.members.map((m) => (
                      <tr key={m.docId} data-testid="member-row" data-doc-id={m.docId} className={m.missing || !m.known ? 'missing' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={picked.has(m.docId)}
                            aria-label={t('projects.pickOne', { title: safeText(m.title ?? m.docId) })}
                            onChange={(e) =>
                              setPicked((cur) => {
                                const next = new Set(cur);
                                if (e.target.checked) next.add(m.docId);
                                else next.delete(m.docId);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>
                          {safeText(m.title ?? m.docId)}
                          {(m.missing || !m.known) && <Chip kind="status" tone="warning">{m.known ? t('docs.missing') : t('projects.unknownDoc')}</Chip>}
                        </td>
                        <td>{safeText(m.authors.slice(0, 3).join(', '))}</td>
                        <td>{m.year ?? ''}</td>
                        <td>
                          {m.studyState ? (
                            <select value={m.studyState} aria-label={t('plan.status', { title: safeText(m.title ?? m.docId) })} onChange={(e) => void setDocState(m.docId, e.target.value as StudyState)} data-testid="member-state">
                              {STATES.map((s) => (
                                <option key={s} value={s}>
                                  {t(`study.${s}`)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="result-path">{m.path ? safeText(m.path) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
        {tab === 'notes' && (
          <>
            {schema && schema.outline === null && (
              <div className="callout schema-invite" data-testid="notes-outline-invite">
                <p>{t('schema.invite')}</p>
                <Button size="sm" onClick={() => (setSchemaOpen(true), setTab('schema'))} data-testid="notes-write-outline">
                  {t('schema.writeNow')}
                </Button>
              </div>
            )}
            <NotesEditor detail={detail} onSave={async (notes) => void (await update({ notes }))} />
            {schema && schema.reports.length > 0 && (
              <section className="schema-reports" data-testid="project-reports">
                <h3>{t('schema.report.list')}</h3>
                <ul>
                  {schema.reports.map((r) => (
                    <li key={r.date}>
                      <button type="button" className="link" onClick={() => setDialog({ kind: 'report', open: r.date })} data-testid="report-open">
                        {r.date} · {safeText(r.title)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {tab === 'schema' && schema && (
          <Lazy>
            <SchemaTab projectId={id} info={schema} titles={new Map(detail.members.map((m) => [m.docId, m.title ?? m.docId]))} onChanged={() => setPushed((n) => n + 1)} />
          </Lazy>
        )}
        {tab === 'plan' && <ReadingPlanPanel detail={detail} onChange={(items) => void savePlan(items)} onStudyState={(docId, state) => void setDocState(docId, state)} />}
      </div>

      {dialog?.kind === 'report' && (
        <Lazy>
          <ReportDialog projectId={id} {...(dialog.open ? { open: dialog.open } : {})} onClose={() => setDialog(null)} onSaved={() => setPushed((n) => n + 1)} />
        </Lazy>
      )}
      {dialog?.kind === 'prisma' && (
        <Lazy>
          <PrismaDialog projectId={id} projectName={p.name} onClose={() => setDialog(null)} />
        </Lazy>
      )}
      {dialog?.kind === 'cite' && (
        <Lazy>
          <CiteDialog projectId={id} notes={p.notes} outline={schema?.outline ?? null} onClose={() => setDialog(null)} onAssigned={() => setPushed((n) => n + 1)} />
        </Lazy>
      )}
      {renaming && <RenameDialog project={p} onSave={update} onClose={() => setRenaming(false)} />}
      {adding && (
        <Lazy>
          <AddDocuments projectId={id} name={p.name} memberIds={memberIds.current} onClose={() => setAdding(false)} onAdded={() => (invalidate('projects'), setPushed((n) => n + 1))} />
        </Lazy>
      )}
    </div>
  );
}
