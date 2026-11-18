import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ModelConfig, ReasoningLevel, ResponseOf } from '@rl/core';
import { Lazy, lazyView } from '../../components/Lazy';
import { CheckField, ErrorNote } from '../../components/ui';
import { useLibraryEvents } from '../../lib/events';
import { useHistory } from '../../lib/history';
import { useNotify } from '../../lib/notify';
import { RlError } from '../../lib/rl-error';
import { rl } from '../../lib/rl';
import { splitLines } from '../../lib/validate';
import { aiErrorText } from '../ai/aiErrors';
import { DocChip } from '../chat/ChatParts';
import { formatSize } from '../library/formatSize';
import { safeText } from '../library/safeText';
import { TagChip, TagPicker } from '../library/TagParts';
import { resolveId } from '../library/taxonomyModel';
import { useTaxonomy } from '../library/useTaxonomy';
import type { InboxItem } from './InboxView';
import './inbox.css';

const PreviewDialog = lazyView(() => import('../chat/PreviewDialog').then((m) => ({ default: m.PreviewDialog })), ['chat-preview']);
type Preview = ResponseOf<Channels, 'inbox:previewTags'>;

interface MetaDraft {
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  arxivId: string;
}

const initialMeta = (item: InboxItem): MetaDraft => {
  const m = item.metadata ?? item.detected;
  return {
    title: m.title ?? '',
    authors: (m.authors ?? []).join('\n'),
    year: m.year == null ? '' : String(m.year),
    venue: m.venue ?? '',
    doi: m.doi ?? '',
    arxivId: m.arxivId ?? '',
  };
};
const detectedMeta = (item: InboxItem): MetaDraft => initialMeta({ ...item, metadata: null });
const nullable = (s: string) => (s.trim() === '' ? null : s.trim());

interface Props {
  item: InboxItem;
  folders: string[];
  model: string;
  reasoning: ReasoningLevel;
  models: ModelConfig[];
  onItem(item: InboxItem): void;
  onGone(): void;
}

/** One file of the inbox: what was found, what the app proposes, and the buttons to confirm or dismiss it. */
export function InboxCard({ item, folders, model, reasoning, models, onItem, onGone }: Props) {
  const { t } = useTranslation();
  const { model: tax } = useTaxonomy();
  const { info, reportError } = useNotify();
  const { invalidate } = useLibraryEvents();
  const history = useHistory();
  const ids = { name: useId(), folder: useId() };
  const dropped = item.kind === 'dropped';

  const [meta, setMeta] = useState<MetaDraft>(() => initialMeta(item));
  const dirty = useRef(false);
  const [name, setName] = useState(item.proposal.name ?? item.fileName);
  const [folder, setFolder] = useState(item.proposal.folder ?? '');
  const [tagIds, setTagIds] = useState<string[]>(item.proposal.tagIds);
  const [keepNew, setKeepNew] = useState<boolean[]>(() => item.proposal.newTags.map(() => true));
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  // The online record arriving (or a new lookup) refreshes the fields the user has not touched.
  const metaKey = JSON.stringify([item.metadata, item.detected]);
  useEffect(() => {
    if (!dirty.current) setMeta(initialMeta(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey]);
  // A new proposal (from the AI) replaces the tags and new nodes shown. Reset while rendering, not in an effect: the
  // first frame with the new proposal must never show (or confirm) the previous tags and keep boxes.
  const proposalKey = JSON.stringify([item.proposal.tagIds, item.proposal.newTags, item.proposal.tagsFrom]);
  const [shownProposal, setShownProposal] = useState(proposalKey);
  if (shownProposal !== proposalKey) {
    setShownProposal(proposalKey);
    setTagIds(item.proposal.tagIds);
    setKeepNew(item.proposal.newTags.map(() => true));
  }

  const editMeta = (patch: Partial<MetaDraft>) => {
    dirty.current = true;
    setMeta((m) => ({ ...m, ...patch }));
  };
  const useValues = (m: MetaDraft) => {
    dirty.current = true;
    setMeta(m);
  };

  const dup = item.duplicate;
  const sameFile = dup?.kind === 'same-file';
  const needsAllow = dup !== null && !sameFile;
  const canConfirm = !busy && !sameFile && (!needsAllow || allowDuplicate) && (!dropped || name.trim() !== '');
  const tagSet = useMemo(() => new Set(tagIds), [tagIds]);

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    const year = Number.parseInt(meta.year, 10);
    try {
      const r = await rl.invoke('inbox:confirm', {
        id: item.id,
        ...(dropped ? { name: name.trim(), folder } : {}),
        tagIds,
        newTags: item.proposal.newTags.filter((_, i) => keepNew[i]),
        metadata: { title: nullable(meta.title), authors: splitLines(meta.authors), year: Number.isFinite(year) ? year : null, venue: nullable(meta.venue), doi: nullable(meta.doi), arxivId: nullable(meta.arxivId) },
        allowDuplicate,
      });
      invalidate('documents');
      invalidate('taxonomy');
      info(t('inbox.confirmed', { path: safeText(r.path) }), r.changeId ? { label: t('history.undo'), run: () => void history.undo(r.changeId!) } : undefined);
      onGone();
    } catch (e) {
      const err = RlError.from(e);
      if (err.code === 'CONFLICT' && err.details?.reason === 'exists') setMessage(t('inbox.errors.exists'));
      else if (err.code === 'CONFLICT' && err.details?.reason === 'duplicate') setMessage(t('inbox.errors.duplicate'));
      else reportError(e);
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await rl.invoke('inbox:dismiss', { id: item.id });
      onGone();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      onItem(await rl.invoke('inbox:lookup', { id: item.id }));
    } catch (e) {
      reportError(e);
    }
    setBusy(false);
  };

  const askPreview = async () => {
    setAiError(null);
    setBusy(true);
    try {
      const p = await rl.invoke('inbox:previewTags', { id: item.id, model, ...(dropped ? { folder } : {}) });
      if (p.allowed.length === 0) setAiError(t('errors.FOLDER_NOT_AI_ENABLED'));
      else if (p.overCap) setAiError(t('chat.errors.cap'));
      else setPreview(p);
    } catch (e) {
      setAiError(aiErrorText(e, t));
    }
    setBusy(false);
  };
  const propose = async () => {
    setBusy(true);
    try {
      onItem(await rl.invoke('inbox:proposeTags', { id: item.id, model, reasoning, ...(dropped ? { folder } : {}), confirmed: true }));
      setPreview(null);
    } catch (e) {
      setPreview(null);
      setAiError(aiErrorText(e, t));
    }
    setBusy(false);
  };

  const lookup = item.lookup;
  const origin = item.metadata ? t('inbox.metaOnline', { source: lookup.source === 'arxiv' ? 'arXiv' : 'OpenAlex' }) : t('inbox.metaDetected');
  const hasBoth = item.metadata !== null && Object.values(item.detected).some((v) => v != null && !(Array.isArray(v) && v.length === 0));
  const tagsFromText = item.proposal.tagsFrom === 'ai' ? t('inbox.tagsFrom_ai') : item.proposal.tagsFrom === 'similar' ? t('inbox.tagsFrom_similar') : null;

  return (
    <li className="inbox-item card" data-testid="inbox-item" data-id={item.id} data-kind={item.kind}>
      <header className="inbox-item-head">
        <h3 data-testid="inbox-file-name">{safeText(item.fileName)}</h3>
        <span className="badge" data-testid="inbox-kind">
          {t(`inbox.kind_${item.kind}`)}
        </span>
        <span className="hint" data-testid="inbox-size">
          {formatSize(item.size)}
        </span>
        {item.path && <span className="result-path">{safeText(item.path)}</span>}
      </header>

      <div className="inbox-ids" data-testid="inbox-detected">
        {item.detected.doi && <span className="badge">DOI {safeText(item.detected.doi)}</span>}
        {item.detected.arxivId && <span className="badge">arXiv {safeText(item.detected.arxivId)}</span>}
        {!item.detected.doi && !item.detected.arxivId && <span className="hint">{t('inbox.noIdentifier')}</span>}
        <span className="badge" data-testid="inbox-lookup" data-state={lookup.state}>
          {t(`inbox.lookup_${lookup.state}`)}
        </span>
        {(lookup.state === 'offline' || lookup.state === 'error' || lookup.state === 'not-found') && (
          <button type="button" className="link" disabled={busy} onClick={() => void retry()} data-testid="inbox-lookup-retry">
            {t('inbox.retry')}
          </button>
        )}
      </div>

      {dup && (
        <div className={sameFile ? 'callout error' : 'callout'} role="alert" data-testid="inbox-duplicate" data-kind={dup.kind}>
          <p>{t(`inbox.dup_${dup.kind}`)}</p>
          <p>
            <DocChip docId={dup.docId} /> <span className="result-path">{safeText(dup.path)}</span>
          </p>
          {needsAllow && <CheckField label={t('inbox.allowDuplicate')} checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} data-testid="inbox-allow-duplicate" />}
        </div>
      )}

      <section className="group" aria-label={t('inbox.metadata')}>
        <h4>{t('inbox.metadata')}</h4>
        <p className="hint" data-testid="inbox-meta-source">
          {origin}
        </p>
        {hasBoth && (
          <p className="actions start">
            <button type="button" className="link" onClick={() => useValues(initialMeta(item))} data-testid="inbox-use-online">
              {t('inbox.useOnline')}
            </button>
            <button type="button" className="link" onClick={() => useValues(detectedMeta(item))} data-testid="inbox-use-detected">
              {t('inbox.useDetected')}
            </button>
          </p>
        )}
        <Labeled label={t('doc.title')}>
          <input type="text" value={meta.title} onChange={(e) => editMeta({ title: e.target.value })} data-testid="inbox-title" />
        </Labeled>
        <Labeled label={t('doc.authors')}>
          <textarea rows={2} value={meta.authors} onChange={(e) => editMeta({ authors: e.target.value })} data-testid="inbox-authors" />
        </Labeled>
        <div className="two-col">
          <Labeled label={t('doc.year')}>
            <input type="number" value={meta.year} onChange={(e) => editMeta({ year: e.target.value })} data-testid="inbox-year" />
          </Labeled>
          <Labeled label={t('doc.venue')}>
            <input type="text" value={meta.venue} onChange={(e) => editMeta({ venue: e.target.value })} data-testid="inbox-venue" />
          </Labeled>
        </div>
        <div className="two-col">
          <Labeled label={t('doc.doi')}>
            <input type="text" value={meta.doi} onChange={(e) => editMeta({ doi: e.target.value })} data-testid="inbox-doi" />
          </Labeled>
          <Labeled label={t('doc.arxiv')}>
            <input type="text" value={meta.arxivId} onChange={(e) => editMeta({ arxivId: e.target.value })} data-testid="inbox-arxiv" />
          </Labeled>
        </div>
      </section>

      <section className="group" aria-label={t('inbox.proposal')}>
        <h4>{t('inbox.proposal')}</h4>
        {dropped && (
          <div className="two-col">
            <div className="field">
              <label htmlFor={ids.name}>{t('inbox.fileName')}</label>
              <input id={ids.name} type="text" value={name} maxLength={180} onChange={(e) => setName(e.target.value)} data-testid="inbox-name" />
            </div>
            <div className="field">
              <label htmlFor={ids.folder}>{t('inbox.folder')}</label>
              <select id={ids.folder} value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="inbox-folder">
                <option value="">{t('inbox.rootFolder')}</option>
                {folder !== '' && !folders.includes(folder) && <option value={folder}>{safeText(folder)}</option>}
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {safeText(f)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <h5>{t('doc.tags')}</h5>
        {tagsFromText && (
          <p className="hint" data-testid="inbox-tags-from" data-from={item.proposal.tagsFrom}>
            {tagsFromText}
          </p>
        )}
        <div className="tag-list" data-testid="inbox-tags">
          {tagIds.length === 0 && <span className="hint">{t('doc.noTags')}</span>}
          {tagIds.map((id) => {
            const node = tax.byId.get(resolveId(tax, id));
            return <TagChip key={id} id={id} label={node?.label ?? id} color={node?.color} removeLabel={t('tags.removeFrom', { name: node?.label ?? id })} onRemove={() => setTagIds(tagIds.filter((x) => x !== id))} />;
          })}
        </div>
        <TagPicker model={tax} exclude={tagSet} ariaLabel={t('tags.add')} placeholder={t('tags.addPlaceholder')} onPick={(id) => setTagIds([...tagIds, id])} testId="inbox-tag-input" />
        {item.proposal.newTags.length > 0 && (
          <div data-testid="inbox-new-tags">
            <h5>{t('inbox.newTags')}</h5>
            <p className="hint">{t('inbox.newTagsHint')}</p>
            <ul>
              {item.proposal.newTags.map((n, i) => (
                <li key={i} data-testid="inbox-new-tag">
                  <CheckField
                    label={`${safeText(n.label)}${n.parentId ? ` (${safeText(tax.byId.get(n.parentId)?.label ?? n.parentId)})` : ''}`}
                    hint={n.reason ? safeText(n.reason) : undefined}
                    checked={keepNew[i] ?? false}
                    onChange={(e) => setKeepNew(keepNew.map((k, j) => (j === i ? e.target.checked : k)))}
                    data-testid="inbox-new-tag-keep"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="actions start">
          <button type="button" disabled={busy} onClick={() => void askPreview()} data-testid="inbox-propose-tags">
            {t('inbox.proposeTags')}
          </button>
        </div>
        {aiError && <ErrorNote testId="inbox-ai-error">{aiError}</ErrorNote>}
      </section>

      {message && <ErrorNote testId="inbox-error">{message}</ErrorNote>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void dismiss()} title={dropped ? t('inbox.dismissDroppedHint') : t('inbox.dismissLibraryHint')} data-testid="inbox-dismiss">
          {t('inbox.dismiss')}
        </button>
        <button type="button" className="primary" disabled={!canConfirm} onClick={() => void confirm()} data-testid="inbox-confirm">
          {dropped ? t('inbox.confirmAdd') : t('inbox.confirmAccept')}
        </button>
      </div>
      {preview && (
        <Lazy>
          <PreviewDialog preview={preview} models={models} busy={busy} labels={{ [item.id]: item.fileName }} title={t('inbox.previewTitle')} confirmLabel={t('inbox.previewSend')} onConfirm={() => void propose()} onCancel={() => setPreview(null)} />
        </Lazy>
      )}
    </li>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
