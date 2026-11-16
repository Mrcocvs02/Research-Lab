import { useCallback, useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail, StudyState } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { Markdown } from '../../lib/markdown';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { ReadingPlanPanel } from './ReadingPlanPanel';
import { toRequestItems, type PlanItemView } from './readingPlan';

type Tab = 'members' | 'notes' | 'plan';
const TABS: Tab[] = ['members', 'notes', 'plan'];
const STATES: StudyState[] = ['to-read', 'reading', 'read'];

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
        <div className="radio-row" role="radiogroup" aria-label={t('notes.layout')}>
          {(['split', 'edit', 'preview'] as const).map((l) => (
            <label key={l} className="radio-chip">
              <input type="radio" name={`${id}-layout`} checked={layout === l} onChange={() => setLayout(l)} data-testid={`notes-layout-${l}`} />
              <span>{t(`notes.layout_${l}`)}</span>
            </label>
          ))}
        </div>
        <span className="spacer" />
        <span className="hint" data-testid="notes-state">
          {dirty ? t('notes.unsaved') : t('notes.saved')}
        </span>
        <button type="button" className="primary" onClick={save} disabled={!dirty} data-testid="notes-save">
          {t('common.save')}
        </button>
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
            {preview.trim() === '' ? <p className="hint">{t('notes.empty')}</p> : <Markdown source={preview} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** A project: name, state, members with their study state, notes, and the reading plan. */
export function ProjectDetailView({ id, onBack }: { id: string; onBack(): void }) {
  const { t } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { info, reportError } = useNotify();
  const [detail, setDetailState] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('members');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
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
        setName(d.project.name);
        setError(null);
      },
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [id, pushed]);

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
          else {
            setDetail(next);
            setName(next.project.name);
          }
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

  if (error && !detail) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (!detail) return <p className="hint">{t('common.loading')}</p>;
  const p = detail.project;
  const archived = p.status === 'archived';

  return (
    <div className="project-detail" data-testid="project-detail" data-project-id={id}>
      <div className="project-head">
        <button type="button" onClick={onBack} data-testid="project-back">
          {t('projects.back')}
        </button>
        <h2 data-testid="project-title">{safeText(p.name)}</h2>
        <span className={`badge badge-status-${p.status}`} data-testid="project-status">
          {t(`projects.status.${p.status}`)}
        </span>
        <span className="badge">{t(`projects.kind.${p.kind}`)}</span>
      </div>
      <div className="project-fields">
        <div className="field">
          <label htmlFor="project-name">{t('projects.name')}</label>
          <input
            id="project-name"
            type="text"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== p.name && void update({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            data-testid="project-name"
          />
        </div>
        {!archived && (
          <div className="field">
            <label htmlFor="project-state">{t('projects.statusLabel')}</label>
            <select id="project-state" value={p.status} onChange={(e) => void update({ status: e.target.value })} data-testid="project-state">
              {(['active', 'paused', 'done'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`projects.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field wide">
          <label htmlFor="project-desc">{t('projects.description')}</label>
          <textarea id="project-desc" rows={2} defaultValue={p.description} key={`${p.id}-${p.revision}`} onBlur={(e) => e.target.value !== p.description && void update({ description: e.target.value })} data-testid="project-description" />
        </div>
      </div>
      <p className="results-summary" data-testid="project-counts">
        {t('projects.counts', { total: p.counts.total, toRead: p.counts.toRead, reading: p.counts.reading, read: p.counts.read })}
        {p.counts.missing > 0 && ` · ${t('projects.missingCount', { count: p.counts.missing })}`}
      </p>

      <div className="tabs" role="tablist" aria-label={t('projects.sections')}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" id={`ptab-${x}`} aria-selected={tab === x} aria-controls={`ptabpanel-${x}`} className={tab === x ? 'tab on' : 'tab'} onClick={() => setTab(x)} data-testid={`project-tab-${x}`}>
            {t(`projects.tabs.${x}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`ptabpanel-${tab}`} aria-labelledby={`ptab-${tab}`}>
        {tab === 'members' && (
          <div data-testid="project-members">
            {detail.members.length === 0 ? (
              <p className="empty" data-testid="members-empty">
                {t('projects.noMembers')}
              </p>
            ) : (
              <>
                <div className="results-bar">
                  <span className="hint">{t('projects.membersHint')}</span>
                  <span className="spacer" />
                  {confirmRemove ? (
                    <span className="confirm-inline">
                      <button type="button" className="danger" onClick={() => void removeMembers()} data-testid="members-remove-confirm">
                        {t('projects.removeConfirm', { count: picked.size })}
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(false)}>
                        {t('common.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={picked.size === 0} onClick={() => setConfirmRemove(true)} data-testid="members-remove">
                      {t('projects.removeSelected', { count: picked.size })}
                    </button>
                  )}
                </div>
                <table className="members-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">{t('projects.pick')}</span>
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
                          {(m.missing || !m.known) && <span className="badge badge-warn">{m.known ? t('docs.missing') : t('projects.unknownDoc')}</span>}
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
        {tab === 'notes' && <NotesEditor detail={detail} onSave={async (notes) => void (await update({ notes }))} />}
        {tab === 'plan' && <ReadingPlanPanel detail={detail} onChange={(items) => void savePlan(items)} onStudyState={(docId, state) => void setDocState(docId, state)} />}
      </div>
    </div>
  );
}
