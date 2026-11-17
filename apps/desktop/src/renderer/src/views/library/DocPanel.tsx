import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RlError } from '../../lib/rl-error';
import { SEARCH_LIMITS, type Channels, type DocumentPatch, type ResponseOf, type StudyState } from '@rl/core';

type DocumentView = ResponseOf<Channels, 'documents:get'>;
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { canRead, useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { splitLines } from '../../lib/validate';
import { useDecide, type ReviewField } from '../review/useDecide';
import { Lazy, lazyRetry } from '../../components/Lazy';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { NoteEditor } from '../notes/NoteEditor';
import { baseName, TypeIcon } from './DocViews';
import { safeText } from './safeText';
import { TagChip, TagPicker } from './TagParts';
import { resolveId } from './taxonomyModel';
import type { DocRow } from './useDocumentList';
import { useTaxonomy } from './useTaxonomy';

const JobDialog = lazyRetry(() => import('../ai/JobDialog').then((m) => ({ default: m.JobDialog })));

const STUDY: StudyState[] = ['to-read', 'reading', 'read'];

/** Adds and removes tags on documents, creating a tag when the typed text names none. Shared by the card and the bulk editor. */
export function useTagActions() {
  const { t } = useTranslation();
  const { apply } = useTaxonomy();
  const { invalidate } = useLibraryEvents();
  const { info, fail, reportError } = useNotify();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const tag = useCallback(
    async (docIds: string[], change: { add?: string[]; remove?: string[] }): Promise<boolean> => {
      // Only a change of several documents is exclusive (and shows as busy); the card of one document keeps its own order.
      const bulk = docIds.length > 1;
      if (bulk && running.current) return false;
      // One change takes at most `idsMax` documents (what a selection by Ctrl+A holds); a longer range is refused here, with the reason.
      if (docIds.length > SEARCH_LIMITS.idsMax) {
        fail(t('bulk.tooMany', { limit: SEARCH_LIMITS.idsMax, n: docIds.length }));
        return false;
      }
      if (bulk) {
        running.current = true;
        setBusy(true);
      }
      try {
        const r = await rl.invoke('documents:tag', { docIds, ...change });
        invalidate('documents');
        info(t('tags.changed', { count: r.changed }));
        return true;
      } catch (e) {
        reportError(e);
        return false;
      } finally {
        if (bulk) {
          running.current = false;
          setBusy(false);
        }
      }
    },
    [invalidate, info, fail, reportError, t],
  );

  /** Creates the tag at the top level, then puts it on the documents. */
  const createAndAdd = useCallback(
    async (docIds: string[], label: string): Promise<void> => {
      const result = await apply([{ op: 'create', label }]);
      const id = result?.created[0]?.id;
      if (id) await tag(docIds, { add: [id] });
    },
    [apply, tag],
  );
  return { tag, createAndAdd, busy };
}

function Section({ title, children, className, testId }: { title: string; children: ReactNode; className?: string; testId?: string }) {
  const id = useId();
  return (
    <section className={className ? `panel-section ${className}` : 'panel-section'} aria-labelledby={id} data-testid={testId}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** "extracted from the file" mark: shown while the field still holds the value the extractor wrote (D-071). */
function ExtractedMark({ on }: { on: boolean }) {
  const { t } = useTranslation();
  if (!on) return null;
  return (
    <span className="badge badge-extracted" title={t('doc.extractedHint')} data-testid="extracted-mark">
      {t('doc.extracted')}
    </span>
  );
}

function isExtracted(doc: DocumentView, field: 'title' | 'authors' | 'year' | 'doi' | 'arxivId'): boolean {
  const ex = doc.extracted?.[field];
  if (ex === undefined) return false;
  const cur = doc[field];
  if (Array.isArray(ex)) return Array.isArray(cur) && cur.length === ex.length && cur.every((v, i) => v === ex[i]);
  return cur === ex;
}

interface FieldProps {
  label: string;
  value: string;
  onCommit(v: string): void;
  extracted?: boolean;
  multiline?: boolean;
  type?: 'text' | 'number';
  list?: string;
  hint?: string;
  testId: string;
  rows?: number;
}

/** A text field that saves when it loses the focus (or on Enter for one-line fields) and only if it changed. */
function Field({ label, value, onCommit, extracted, multiline, type = 'text', list, hint, testId, rows }: FieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const common = { id, value: draft, 'data-testid': testId, onBlur: commit, 'aria-describedby': hint ? `${id}-hint` : undefined };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <ExtractedMark on={Boolean(extracted)} />
      </label>
      {multiline ? (
        <textarea {...common} rows={rows ?? 3} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input
          {...common}
          type={type}
          list={list}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      )}
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Accept or reject one proposed AI field of the document, as the review does (one undoable change). */
function AiQuickDecide({ docId, field, revision }: { docId: string; field: ReviewField; revision: number }) {
  const { t } = useTranslation();
  const { decide } = useDecide();
  const [busy, setBusy] = useState(false);
  const run = async (decision: 'accept' | 'reject') => {
    setBusy(true);
    await decide({ docId, field, decision, expectedRevision: revision });
    setBusy(false);
  };
  return (
    <div className="actions start">
      <button type="button" className="primary" disabled={busy} onClick={() => void run('accept')} data-testid="ai-accept" data-field={field}>
        {t('review.accept')}
      </button>
      <button type="button" disabled={busy} onClick={() => void run('reject')} data-testid="ai-reject" data-field={field}>
        {t('review.reject')}
      </button>
    </div>
  );
}

/** Everything the AI wrote about the document, apart from the user's own fields and clearly marked as AI output. */
export function AiArea({ doc }: { doc: DocumentView }) {
  const { t, i18n } = useTranslation();
  const { model } = useTaxonomy();
  const ai = doc.ai;
  const date = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(i18n.language);
  };
  const meta = (f: { meta: { model: string; date: string; provider: string }; review: { status: string } }) => (
    <p className="ai-meta">
      {safeText(f.meta.provider === 'legacy-import' ? t('ai.legacy') : f.meta.model)} · {date(f.meta.date)} · {t(`ai.review.${f.review.status}`)}
    </p>
  );
  const block = (key: string, body: ReactNode, f: Parameters<typeof meta>[0], field?: ReviewField) => (
    <div className="ai-item" data-testid={`ai-${key}`} data-status={f.review.status}>
      <h4>{t(`ai.fields.${key}`)}</h4>
      {body}
      {meta(f)}
      {field && f.review.status === 'proposed' && <AiQuickDecide docId={doc.id} field={field} revision={doc.revision} />}
    </div>
  );
  const nothing = !ai.summary && !ai.description && !ai.keywords && !ai.synonyms && !ai.suggestedTags && !ai.suggestedNewTags && !ai.suggestedType && !ai.relations;
  return (
    <section className="ai-area" aria-label={t('ai.areaLabel')} data-testid="ai-area">
      <header className="ai-head">
        <span className="ai-badge ai-badge-lg">{t('ai.badge')}</span>
        <span className="ai-note">{t('ai.readOnly')}</span>
      </header>
      {nothing && <p className="hint">{t('ai.none')}</p>}
      {ai.summary && block('summary', <p className="ai-text">{safeText(ai.summary.value)}</p>, ai.summary, 'summary')}
      {ai.description && block('description', <p className="ai-text">{safeText(ai.description.value)}</p>, ai.description, 'description')}
      {ai.keywords &&
        block(
          'keywords',
          <ul className="ai-chips">
            {ai.keywords.value.map((k) => (
              <li key={k} className="ai-chip">
                {safeText(k)}
              </li>
            ))}
          </ul>,
          ai.keywords,
          'keywords',
        )}
      {ai.synonyms &&
        block(
          'synonyms',
          <ul className="ai-chips">
            {ai.synonyms.value.map((k) => (
              <li key={k} className="ai-chip">
                {safeText(k)}
              </li>
            ))}
          </ul>,
          ai.synonyms,
          'synonyms',
        )}
      {ai.suggestedTags &&
        block(
          'suggestedTags',
          <ul className="ai-chips">
            {ai.suggestedTags.value.map((id) => (
              <li key={id} className="ai-chip">
                {safeText(model.byId.get(resolveId(model, id))?.label ?? id)}
              </li>
            ))}
          </ul>,
          ai.suggestedTags,
          'tags',
        )}
      {ai.suggestedNewTags &&
        block(
          'suggestedNewTags',
          <ul className="ai-chips">
            {ai.suggestedNewTags.value.map((n, i) => (
              <li key={i} className="ai-chip">
                {safeText(n.label)}
              </li>
            ))}
          </ul>,
          ai.suggestedNewTags,
          'newTags',
        )}
      {ai.suggestedType && block('suggestedType', <p className="ai-text">{safeText(ai.suggestedType.value)}</p>, ai.suggestedType)}
      {ai.relations &&
        block(
          'relations',
          <ul className="ai-relations">
            {ai.relations.value.map((r) => (
              <li key={r.docId}>{safeText(r.reason)}</li>
            ))}
          </ul>,
          ai.relations,
          'relations',
        )}
    </section>
  );
}

/** The card of one document: editable metadata, study state, tags, and the AI area (read-only). */
export function DocumentCard({ docId, onClose }: { docId: string; onClose(): void }) {
  const { t } = useTranslation();
  const version = useChangeVersion('documents');
  const { invalidate } = useLibraryEvents();
  const { reportError, fail } = useNotify();
  const { view, model } = useTaxonomy();
  const { tag, createAndAdd } = useTagActions();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const docRef = useRef<DocumentView | null>(null);
  docRef.current = doc;
  const venueListId = useId();
  const { openReader } = useReader();
  const [jobOpen, setJobOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    rl.invoke('documents:get', { docId }).then(
      (d) => {
        if (!alive) return;
        setDoc(d);
        setError(null);
      },
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [docId, version]);

  /** Saves one change; changes are sent one after the other, each with the revision the previous one produced. */
  const save = useCallback(
    (patch: DocumentPatch) => {
      queue.current = queue.current.then(async () => {
        const current = docRef.current;
        try {
          const r = await rl.invoke('documents:update', { docId, patch, ...(current ? { expectedRevision: current.revision } : {}) });
          docRef.current = r.document;
          setDoc(r.document);
          invalidate('documents');
        } catch (e) {
          reportError(e);
        }
      });
    },
    [docId, invalidate, reportError],
  );

  const openFile = () => rl.invoke('documents:open', { docId }).catch((e: unknown) => (RlError.from(e).code === 'PERMISSION_DENIED' ? fail(t('docs.openRefused')) : reportError(e)));
  const reveal = () => rl.invoke('documents:reveal', { docId }).catch(reportError);

  const venues = view?.venues ?? [];
  const types = view?.documentTypes ?? [];
  const tagSet = useMemo(() => new Set(doc?.tags ?? []), [doc?.tags]);

  if (error && !doc) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  if (!doc) return <p className="hint">{t('common.loading')}</p>;

  const title = doc.title?.trim() || baseName(doc.path);
  const num = (s: string): number | null => (s.trim() === '' ? null : Number.parseInt(s, 10));
  const venueText = doc.ref.venue ?? '';
  const commitVenue = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === '') return save({ venue: null, venueId: null });
    const q = trimmed.toLowerCase();
    const known = venues.find((v) => v.name.toLowerCase() === q || v.aliases.some((a) => a.toLowerCase() === q));
    save(known ? { venue: known.name, venueId: known.id } : { venue: trimmed, venueId: null });
  };

  return (
    <div className="doc-card-panel" data-testid="doc-panel" data-doc-id={docId}>
      <header className="panel-head">
        <TypeIcon path={doc.path} />
        <div className="panel-title">
          <h2 data-testid="panel-title">{safeText(title)}</h2>
          <p className="result-path">{safeText(doc.path)}</p>
        </div>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose} data-testid="panel-close">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="panel-actions">
        {canRead(doc.path, doc.missing) && (
          <button type="button" className="primary" onClick={() => openReader(docId)} title={t('docs.readHint')} data-testid="open-reader">
            {t('docs.read')}
          </button>
        )}
        <button type="button" onClick={() => void openFile()} disabled={doc.missing} data-testid="open-file">
          {t('docs.openFile')}
        </button>
        <button type="button" onClick={() => void reveal()} disabled={doc.missing} data-testid="reveal-file">
          {t('docs.reveal')}
        </button>
        <button type="button" onClick={() => setJobOpen(true)} disabled={doc.missing} data-testid="doc-ai-propose">
          {t('jobs.proposeOne')}
        </button>
        {doc.missing && <span className="badge badge-warn">{t('docs.missing')}</span>}
      </div>

      <Section title={t('doc.metadata')} testId="doc-metadata">
        <p className="hint">{t('doc.metadataHint')}</p>
        <Field label={t('doc.title')} value={doc.title ?? ''} extracted={isExtracted(doc, 'title')} onCommit={(v) => save({ title: v.trim() === '' ? null : v.trim() })} testId="field-title" />
        <Field
          label={t('doc.authors')}
          hint={t('doc.authorsHint')}
          value={doc.authors.join('\n')}
          extracted={isExtracted(doc, 'authors')}
          multiline
          rows={3}
          onCommit={(v) => save({ authors: splitLines(v) })}
          testId="field-authors"
        />
        <div className="two-col">
          <Field label={t('doc.year')} type="number" value={doc.year === null ? '' : String(doc.year)} extracted={isExtracted(doc, 'year')} onCommit={(v) => save({ year: num(v) })} testId="field-year" />
          <div className="field">
            <label htmlFor={`${venueListId}-type`}>{t('doc.type')}</label>
            <select id={`${venueListId}-type`} value={doc.type ?? ''} onChange={(e) => save({ type: e.target.value === '' ? null : e.target.value })} data-testid="field-type">
              <option value="">{t('doc.noType')}</option>
              {types.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {safeText(ty.label)}
                </option>
              ))}
              {doc.type !== null && !types.some((ty) => ty.id === doc.type) && <option value={doc.type}>{safeText(doc.type)}</option>}
            </select>
          </div>
        </div>
        <Field label={t('doc.venue')} list={venueListId} value={venueText} onCommit={commitVenue} testId="field-venue" />
        <datalist id={venueListId}>
          {venues.map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
        <Field label={t('doc.venueRef')} value={doc.ref.venueRef ?? ''} onCommit={(v) => save({ venueRef: v.trim() === '' ? null : v.trim() })} testId="field-venueRef" />
        <div className="two-col">
          <Field label={t('doc.doi')} value={doc.doi ?? ''} extracted={isExtracted(doc, 'doi')} onCommit={(v) => save({ doi: v.trim() === '' ? null : v.trim() })} testId="field-doi" />
          <Field label={t('doc.arxiv')} value={doc.arxivId ?? ''} extracted={isExtracted(doc, 'arxivId')} onCommit={(v) => save({ arxivId: v.trim() === '' ? null : v.trim() })} testId="field-arxiv" />
        </div>
      </Section>

      <Section title={t('doc.study')} testId="doc-study">
        <div className="radio-row" role="radiogroup" aria-label={t('doc.studyState')}>
          {STUDY.map((s) => (
            <label key={s} className="radio-chip">
              <input type="radio" name={`study-${docId}`} checked={doc.study.state === s} onChange={() => save({ studyState: s })} data-testid={`study-${s}`} />
              <span>{t(`study.${s}`)}</span>
            </label>
          ))}
        </div>
        <div className="check">
          <input id={`${venueListId}-ul`} type="checkbox" checked={doc.study.underlined.value} onChange={(e) => save({ underlined: e.target.checked })} data-testid="field-underlined" />
          <label htmlFor={`${venueListId}-ul`}>{t('doc.underlined')}</label>
          <span className="badge" data-testid="underlined-origin" data-origin={doc.study.underlined.origin}>
            {doc.study.underlined.origin === 'annotations' ? t('reader.underlinedOrigin_annotations') : t('reader.underlinedOrigin_manual')}
          </span>
          {doc.study.underlined.origin === 'annotations' && <p className="hint">{t('doc.underlinedFromAnnotations')}</p>}
        </div>
      </Section>

      <Section title={t('doc.notes')} testId="doc-notes">
        <p className="hint">{t('doc.notesHint')}</p>
        <NoteEditor docId={docId} testId="card-note" />
      </Section>

      <Section title={t('doc.description')} testId="doc-description">
        <Field label={t('doc.userDescription')} hint={t('doc.userDescriptionHint')} multiline rows={3} value={doc.userDescription ?? ''} onCommit={(v) => save({ userDescription: v })} testId="field-description" />
      </Section>

      <Section title={t('doc.tags')} testId="doc-tags-section">
        <div className="tag-list" data-testid="doc-tag-list">
          {doc.tags.length === 0 && <span className="hint">{t('doc.noTags')}</span>}
          {doc.tags.map((id) => {
            const node = model.byId.get(resolveId(model, id));
            return (
              <TagChip key={id} id={id} label={node?.label ?? id} color={node?.color} deprecated={node?.status === 'deprecated'} removeLabel={t('tags.removeFrom', { name: node?.label ?? id })} onRemove={() => void tag([docId], { remove: [id] })} />
            );
          })}
        </div>
        <TagPicker
          model={model}
          exclude={tagSet}
          ariaLabel={t('tags.add')}
          placeholder={t('tags.addPlaceholder')}
          onPick={(id) => void tag([docId], { add: [id] })}
          onCreate={(label) => createAndAdd([docId], label)}
          testId="tag-input"
        />
      </Section>

      <AiArea doc={doc} />
      {jobOpen && (
        <Lazy>
          <JobDialog docIds={[docId]} onClose={() => setJobOpen(false)} />
        </Lazy>
      )}

      <Section title={t('doc.file')} className="panel-file">
        <dl className="facts">
          <dt>{t('doc.path')}</dt>
          <dd>{safeText(doc.path)}</dd>
          <dt>{t('doc.size')}</dt>
          <dd>{formatSize(doc.size)}</dd>
          <dt>{t('doc.added')}</dt>
          <dd>{safeText(doc.addedAt.slice(0, 10))}</dd>
        </dl>
      </Section>
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Editing the tags of several documents at once: add one, or remove one of those the selection carries. */
export function BulkTagEditor({ docIds, rows, onNeedRows, onClose }: { docIds: string[]; rows: DocRow[]; onNeedRows?(): void; onClose(): void }) {
  const { t } = useTranslation();
  const { model } = useTaxonomy();
  const { tag, createAndAdd, busy } = useTagActions();
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // Actions and counts follow the selected ids; the tags shown come from the rows loaded so far, so ask for the rest.
  useEffect(() => {
    if (rows.length < docIds.length) onNeedRows?.();
  }, [rows.length, docIds.length, onNeedRows]);

  /** Tags put by hand (removable) first, then the ones that are only implied by another tag (shown as such, not removable). */
  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    const implied = new Map<string, number>();
    for (const r of rows) {
      const own = r.directTags ?? r.tags ?? [];
      for (const id of own) direct.set(id, (direct.get(id) ?? 0) + 1);
      for (const id of r.tags ?? []) if (!own.includes(id)) implied.set(id, (implied.get(id) ?? 0) + 1);
    }
    const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1];
    return [
      ...[...direct.entries()].sort(byCount).map(([id, n]) => ({ id, n, implied: false })),
      ...[...implied.entries()].filter(([id]) => !direct.has(id)).sort(byCount).map(([id, n]) => ({ id, n, implied: true })),
    ];
  }, [rows]);

  return (
    <div className="doc-card-panel" data-testid="bulk-panel" aria-busy={busy}>
      <header className="panel-head">
        <div className="panel-title">
          <h2 data-testid="bulk-title">{t('bulk.title', { count: docIds.length })}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <Section title={t('bulk.addTag')}>
        <TagPicker
          model={model}
          ariaLabel={t('tags.add')}
          placeholder={t('tags.addPlaceholder')}
          onPick={(id) => void tag(docIds, { add: [id] })}
          onCreate={(label) => createAndAdd(docIds, label)}
          testId="bulk-tag-input"
          disabled={busy}
        />
        {busy && (
          <p className="hint" role="status" data-testid="bulk-busy">
            {t('bulk.working', { count: docIds.length })}
          </p>
        )}
      </Section>
      <Section title={t('bulk.currentTags')}>
        {counts.length === 0 && <p className="hint">{t('bulk.noTags')}</p>}
        <ul className="bulk-tags">
          {counts.map(({ id, n, implied }) => {
            const node = model.byId.get(resolveId(model, id));
            return (
              <li key={id} data-testid="bulk-tag" data-tag={id} data-implied={implied ? 1 : 0}>
                <TagChip label={node?.label ?? id} color={node?.color} id={id} />
                <span className="facet-count">{t('bulk.onCount', { count: n, total: docIds.length })}</span>
                {implied ? (
                  <span className="badge" title={t('bulk.impliedHint')} data-testid="bulk-implied">
                    {t('bulk.implied')}
                  </span>
                ) : pendingRemove === id ? (
                  <span className="confirm-inline">
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        setPendingRemove(null);
                        void tag(docIds, { remove: [id] });
                      }}
                      data-testid="bulk-remove-confirm"
                    >
                      {t('bulk.removeConfirm', { count: n })}
                    </button>
                    <button type="button" onClick={() => setPendingRemove(null)}>
                      {t('common.cancel')}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="link" disabled={busy} onClick={() => setPendingRemove(id)} data-testid="bulk-remove">
                    {t('bulk.remove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
