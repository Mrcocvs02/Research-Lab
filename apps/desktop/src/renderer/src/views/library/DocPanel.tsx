import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RlError } from '../../lib/rl-error';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { IconChevronRight, IconClose, IconMore } from '../../components/icons';
import { IconClaude } from '../../components/icons-shell';
import { KeyValue } from '../../components/KeyValue';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Segmented } from '../../components/Segmented';
import { useAiUi } from '../../lib/aiUi';
import { groupTagLabel, visibleGroupTags, SEARCH_LIMITS, type Channels, type DocumentPatch, type ResponseOf, type StudyState } from '@rl/core';

type DocumentView = ResponseOf<Channels, 'documents:get'>;
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { canRead, useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { splitLines } from '../../lib/validate';
import { useDecide, type ReviewField } from '../review/useDecide';
import { Lazy, lazyView } from '../../components/Lazy';
import { groupsItem } from './selection/actions/groups';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { NotesSection } from './docpanel/NotesSection';
import { baseName } from './fileName';
import { formatSize } from './formatSize';
import { safeText } from './safeText';
import { openTagManager } from '../../lib/libraryIntent';
import { TagChip, TagPicker } from './TagParts';
import { useTagActions } from './useTagActions';
import { oneFamilyRemoval, tagRowsOf } from './tagRows';
import { resolveId } from './taxonomyModel';
import type { DocRow } from './useDocumentList';
import { useTaxonomy } from './useTaxonomy';
import './library.css';

const CitationsPanel = lazyView(() => import('./docpanel/CitationsSection').then((m) => ({ default: m.CitationsSection })), ['citations']);
const SimilarPanel = lazyView(() => import('../network/SimilarPanel').then((m) => ({ default: m.SimilarPanel })), ['network']);
const DocResources = lazyView(() => import('../resources/DocResources'), ['resources']);
const DocLinks = lazyView(() => import('./docpanel/DocLinks').then((m) => ({ default: m.DocLinks })), ['links']);
const LinkFinderDialog = lazyView(() => import('../links/LinkFinderDialog').then((m) => ({ default: m.LinkFinderDialog })), ['links']);
const GroupsDialog = lazyView(() => import('../groups/GroupsDialog').then((m) => ({ default: m.GroupsDialog })), ['groups']);
const JobDialog = lazyView(() => import('../ai/JobDialog').then((m) => ({ default: m.JobDialog })), ['jobs']);

const STUDY: StudyState[] = ['to-read', 'reading', 'read'];

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
                {safeText(model.byId.get(resolveId(model, id))?.label ?? groupTagLabel(id))}
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

/** Sections of the card the user opened stay open from one document to the next, for the session (4.14). */
const openSections = new Set<string>();

/** A section of the card: a row of 36 px with its title and a short text on the right; it opens in place. */
function CardSection({ id, title, hint, action, testId, toggleTestId, forceOpen, children }: { id: string; title: string; hint?: ReactNode; action?: ReactNode; testId?: string; toggleTestId?: string; forceOpen?: boolean; children: ReactNode }) {
  const [shown, setOpen] = useState(() => openSections.has(id));
  const open = shown || forceOpen === true;
  const bodyId = useId();
  const toggle = () => {
    if (open) openSections.delete(id);
    else openSections.add(id);
    setOpen(!open);
  };
  return (
    <section className="card-section" data-testid={testId} data-open={open}>
      <div className="card-section__head">
        <button type="button" className="card-section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle} data-testid={toggleTestId}>
          <IconChevronRight size={16} className="card-section__chev" />
          <span className="card-section__title">{title}</span>
          {hint !== undefined && <span className="card-section__hint">{hint}</span>}
        </button>
        {action}
      </div>
      {open && (
        <div id={bodyId} className="card-section__body">
          {children}
        </div>
      )}
    </section>
  );
}

/** The card of one document (4.14): reading view with the actions, state and tags; data, notes, citations, similar and file in sections. */
export function DocumentCard({ docId, onClose }: { docId: string; onClose(): void }) {
  const { t } = useTranslation();
  const version = useChangeVersion('documents');
  const { invalidate } = useLibraryEvents();
  const { reportError, fail } = useNotify();
  const { view, model } = useTaxonomy();
  const { tag, createAndAdd } = useTagActions();
  const { setChatOpen } = useAiUi();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const docRef = useRef<DocumentView | null>(null);
  docRef.current = doc;
  const venueListId = useId();
  const { openReader } = useReader();
  const [jobOpen, setJobOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksVersion, setLinksVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchor = useRef<HTMLSpanElement>(null);

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
  const tagRows = useMemo(() => tagRowsOf(model, doc?.tags ?? []), [model, doc?.tags]);
  const [showKeywords, setShowKeywords] = useState(false);

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
  const readable = canRead(doc.path, doc.missing);
  const byline = [safeText(doc.authors.slice(0, 3).join(', ')) + (doc.authors.length > 3 ? ' …' : ''), doc.year, doc.ref.venue ? safeText(doc.ref.venue) : null].filter((x) => x !== '' && x !== null && x !== undefined).join(' · ');
  const why = t('docs.missing');
  const more: MenuGroups = [
    {
      id: 'file',
      items: [
        doc.missing ? { id: 'open', label: t('docs.openDefault'), disabled: true, disabledReason: why, onSelect: openFile } : { id: 'open', label: t('docs.openDefault'), onSelect: () => void openFile() },
        doc.missing ? { id: 'reveal', label: t('docs.reveal'), disabled: true, disabledReason: why, onSelect: reveal } : { id: 'reveal', label: t('docs.reveal'), onSelect: () => void reveal() },
      ],
    },
    {
      id: 'ai',
      items: [
        doc.missing ? { id: 'propose', label: t('doc.propose'), icon: <IconClaude size={16} />, disabled: true, disabledReason: why, onSelect: () => setJobOpen(true) } : { id: 'propose', label: t('doc.propose'), icon: <IconClaude size={16} />, onSelect: () => setJobOpen(true) },
        // The research group of this paper (§17.4.19): the overview of the authors, institutions and co-authors, from the data on this machine.
        { ...groupsItem(t, [docId], () => setGroupsOpen(true)), id: 'groups', testId: 'doc-groups', icon: <IconClaude size={16} /> },
      ],
    },
    { id: 'links', items: [{ id: 'links', label: t('library.docLinksFind'), testId: 'doc-links-find', onSelect: () => setLinksOpen(true) }] },
  ];
  const ai = doc.ai;
  const noAi = !ai.summary && !ai.description && !ai.keywords && !ai.synonyms && !ai.suggestedTags && !ai.suggestedNewTags && !ai.suggestedType && !ai.relations;

  return (
    <div className="doc-card-panel" data-testid="doc-panel" data-doc-id={docId}>
      <header className="card-head">
        <span className="card-head__caption">{t('docs.details')}</span>
        <IconButton label={t('common.close')} size="sm" onClick={onClose} data-testid="panel-close">
          <IconClose size={16} />
        </IconButton>
      </header>
      <h2 className="card-title" data-testid="panel-title" title={safeText(title)}>
        {safeText(title)}
      </h2>
      {byline && <p className="card-byline">{byline}</p>}
      <div className="card-actions">
        {readable ? (
          <Button variant="primary" onClick={() => openReader(docId)} title={t('docs.readHint')} data-testid="open-reader">
            {t('docs.read')}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void openFile()} disabled={doc.missing} disabledReason={why} data-testid="open-file">
            {t('docs.open')}
          </Button>
        )}
        {readable && (
          <Button onClick={() => openReader(docId, undefined, { panel: 'literature' })} title={t('docs.summaryHint')} data-testid="open-summary">
            {t('docs.summary')}
          </Button>
        )}
        <Button className="card-actions__ai" icon={<IconClaude size={16} />} onClick={() => setChatOpen(true)} data-testid="doc-ask-claude">
          {t('doc.askClaude')}
        </Button>
        <span ref={moreAnchor}>
          <IconButton label={t('docs.moreActions')} variant="secondary" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="doc-more">
            <IconMore size={20} />
          </IconButton>
        </span>
        <Menu anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} groups={more} label={t('docs.moreActions')} width={280} />
        {doc.missing && <span className="badge badge-warn">{t('docs.missing')}</span>}
      </div>

      <div className="card-state" data-testid="doc-study">
        <span className="card-state__label">{t('doc.stateLabel')}</span>
        <Segmented<StudyState>
          label={t('doc.studyState')}
          size="sm"
          value={doc.study.state}
          onChange={(s) => save({ studyState: s })}
          options={STUDY.map((s) => ({ value: s, label: t(`study.${s}`), testId: `study-${s}` }))}
        />
      </div>
      <div className="card-underlined">
        <input id={`${venueListId}-ul`} type="checkbox" checked={doc.study.underlined.value} onChange={(e) => save({ underlined: e.target.checked })} data-testid="field-underlined" />
        <label htmlFor={`${venueListId}-ul`}>{t('doc.underlined')}</label>
        {doc.study.underlined.value && (
          <span className="badge" data-testid="underlined-origin" data-origin={doc.study.underlined.origin}>
            {doc.study.underlined.origin === 'annotations' ? t('reader.underlinedOrigin_annotations') : t('reader.underlinedOrigin_manual')}
          </span>
        )}
      </div>
      {doc.study.underlined.origin === 'annotations' && <p className="hint">{t('doc.underlinedFromAnnotations')}</p>}

      <div className="card-tags" data-testid="doc-tags-section">
        <span className="card-state__label">{t('doc.tags')}</span>
        <button type="button" className="link" onClick={() => openTagManager(() => undefined)} data-testid="doc-tags-manage">
          {t('library.manageTagsLink')}
        </button>
        <div className="tag-list" data-testid="doc-tag-list">
          {doc.tags.length === 0 && <span className="hint">{t('doc.noTags')}</span>}
          {tagRows.map((row) => (
            <div key={row.key} className="card-tags-family" data-testid="doc-tags-family" data-family={row.family ?? ''}>
              {row.family !== null && <span className="card-tags-family__name">{safeText(row.family)}:</span>}
              {(row.keywords && !showKeywords ? [] : row.ids).map((id) => {
                const node = model.byId.get(resolveId(model, id));
                const origin = doc.tagOrigin?.[id];
                return (
                  <TagChip
                    key={id}
                    id={id}
                    label={node?.label ?? id}
                    color={node?.color}
                    deprecated={node?.status === 'deprecated'}
                    origin={origin}
                    originTitle={origin ? t(origin === 'ai' ? 'tags.originAi' : 'tags.originImport', { defaultValue: origin === 'ai' ? 'Proposed by the AI and accepted. Click to confirm.' : 'Imported. Click to confirm.' }) : undefined}
                    onConfirm={origin ? () => void tag([docId], { add: [id] }) : undefined}
                    removeLabel={t('tags.removeFrom', { name: node?.label ?? id })}
                    onRemove={() => void tag([docId], { remove: [id] })}
                  />
                );
              })}
              {row.keywords && (
                <button type="button" className="link" data-testid="doc-tags-keywords" onClick={() => setShowKeywords((v) => !v)}>
                  {showKeywords ? t('library.hideKeywords', { defaultValue: 'Hide keywords' }) : t('library.moreKeywords', { count: row.ids.length, defaultValue: '+{{count}} keywords' })}
                </button>
              )}
            </div>
          ))}
        </div>
        <TagPicker
          model={model}
          exclude={tagSet}
          ariaLabel={t('tags.add')}
          placeholder={t('tags.addPlaceholder')}
          onPick={(id) => void tag([docId], { add: [id], ...oneFamilyRemoval(model, doc.tags, id) })}
          onCreate={(label) => createAndAdd([docId], label)}
          pack={{ docIds: [docId] }}
          testId="tag-input"
        />
        {(doc.groups?.length ?? 0) > 0 && (
          <div className="tag-list" data-testid="doc-group-tags">
            <span className="card-state__label">{t('doc.groupTags')}</span>
            {visibleGroupTags(doc).map((id) => (
              <TagChip key={id} id={id} label={groupTagLabel(id)} removeLabel={t('doc.hideGroup', { name: groupTagLabel(id) })} onRemove={() => save({ groupsHidden: [...(doc.groupsHidden ?? []), groupTagLabel(id)] })} />
            ))}
            {(doc.groupsHidden?.length ?? 0) > 0 && (
              <button type="button" className="link" data-testid="doc-group-show" onClick={() => save({ groupsHidden: [] })}>
                {t('doc.showGroups', { count: doc.groupsHidden?.length ?? 0 })}
              </button>
            )}
          </div>
        )}
      </div>

      {noAi ? (
        <p className="card-ai-none" data-testid="ai-area">
          <IconClaude size={16} />
          <span>{t('doc.aiNone')}</span>
          <button type="button" className="link" onClick={() => !doc.missing && setJobOpen(true)} disabled={doc.missing}>
            {t('doc.propose')}
          </button>
        </p>
      ) : (
        <AiArea doc={doc} />
      )}

      <CardSection
        id="data"
        forceOpen={editing}
        title={t('doc.dataTitle')}
        testId="doc-metadata"
        action={
          <button
            type="button"
            className="link card-section__action"
            data-testid="detail-edit-data"
            onClick={() => {
              openSections.add('data');
              setEditing(!editing);
            }}
          >
            {editing ? t('doc.doneEditing') : t('doc.editData')}
          </button>
        }
      >
        {editing ? (
          <div className="card-edit">
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
          </div>
        ) : (
          <KeyValue
            items={[
              { label: t('doc.title'), value: safeText(title) },
              { label: t('doc.authors'), value: doc.authors.length > 0 ? safeText(doc.authors.join(', ')) : '—' },
              { label: t('doc.year'), value: doc.year ?? '—' },
              { label: t('doc.venue'), value: venueText ? safeText(venueText) : '—' },
              ...(doc.type ? [{ label: t('doc.type'), value: safeText(types.find((ty) => ty.id === doc.type)?.label ?? doc.type) }] : []),
              ...(doc.doi ? [{ label: t('doc.doi'), value: safeText(doc.doi) }] : []),
              ...(doc.arxivId ? [{ label: t('doc.arxiv'), value: safeText(doc.arxivId) }] : []),
            ]}
          />
        )}
      </CardSection>

      <CardSection id="notes" title={t('doc.notes')} testId="doc-notes">
        <p className="hint">{t('doc.notesHint')}</p>
        <NotesSection docId={docId} />
        <Field label={t('doc.userDescription')} hint={t('doc.userDescriptionHint')} multiline rows={3} value={doc.userDescription ?? ''} onCommit={(v) => save({ userDescription: v })} testId="field-description" />
      </CardSection>

      <CardSection id="citations" title={t('citations.title')} testId="doc-citations" toggleTestId="citations-toggle">
        <Lazy>
          <CitationsPanel docId={docId} />
        </Lazy>
      </CardSection>

      <Lazy>
        <DocLinks docId={docId} version={linksVersion} />
      </Lazy>

      <CardSection id="similar" title={t('doc.similarTitle')} testId="doc-similar" toggleTestId="similar-toggle">
        <Lazy>
          <SimilarPanel docId={docId} tagLabel={(id) => model.byId.get(resolveId(model, id))?.label ?? groupTagLabel(id)} onOpen={openReader} />
        </Lazy>
      </CardSection>

      <CardSection id="resources" title={t('doc.resources')} testId="doc-resources-section" toggleTestId="resources-toggle">
        <Lazy>
          <DocResources docId={docId} />
        </Lazy>
      </CardSection>

      <CardSection id="file" title={t('doc.file')} hint={`${safeText(doc.path)} · ${formatSize(doc.size)}`} testId="doc-file">
        <KeyValue
          items={[
            { label: t('doc.path'), value: safeText(doc.path) },
            { label: t('doc.size'), value: formatSize(doc.size) },
            { label: t('doc.added'), value: safeText(doc.addedAt.slice(0, 10)) },
          ]}
        />
      </CardSection>

      {linksOpen && (
        <Lazy>
          <LinkFinderDialog
            docIds={[docId]}
            onClose={() => {
              setLinksOpen(false);
              setLinksVersion((v) => v + 1);
            }}
          />
        </Lazy>
      )}
      {groupsOpen && (
        <Lazy>
          <GroupsDialog docIds={[docId]} onClose={() => setGroupsOpen(false)} />
        </Lazy>
      )}
      {jobOpen && (
        <Lazy>
          <JobDialog docIds={[docId]} onClose={() => setJobOpen(false)} />
        </Lazy>
      )}
    </div>
  );
}
