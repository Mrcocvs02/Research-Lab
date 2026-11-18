import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { IconCheck, IconClose } from '../../components/icons';
import { splitLines } from '../../lib/validate';
import { DocChip } from '../chat/ChatParts';
import { safeText } from '../library/safeText';
import { TagChip } from '../library/TagParts';
import { resolveId } from '../library/taxonomyModel';
import { useTaxonomy } from '../library/useTaxonomy';
import { useDecide, type DecideRequest } from './useDecide';
import '../inbox/inbox.css';

export type ReviewItemData = ResponseOf<Channels, 'review:list'>['items'][number];
type NewTag = Extract<ReviewItemData, { field: 'newTags' }>['value'][number];

interface NewTagDraft {
  keep: boolean;
  label: string;
  parentId: string;
  aliases: string;
}

/** The AI mark of a field: who wrote it and when (output of a model is never shown as the user's own). */
export function AiMark({ meta }: { meta: ReviewItemData['meta'] }) {
  const { t, i18n } = useTranslation();
  const d = new Date(meta.date);
  const date = Number.isNaN(d.getTime()) ? meta.date : d.toLocaleDateString(i18n.language);
  return (
    <p className="ai-mark" data-testid="review-ai-mark">
      <span className="ai-badge">{t('ai.badge')}</span>
      <span className="hint">
        {safeText(meta.provider === 'legacy-import' ? t('ai.legacy') : meta.model)} · {date}
      </span>
    </p>
  );
}

function NewTagRows({ value, drafts, setDrafts, disabled }: { value: NewTag[]; drafts: NewTagDraft[]; setDrafts(d: NewTagDraft[]): void; disabled: boolean }) {
  const { t } = useTranslation();
  const { model, labelOf } = useTaxonomy();
  const options = useMemo(() => [...model.nodes].sort((a, b) => a.label.localeCompare(b.label)), [model]);
  const set = (i: number, patch: Partial<NewTagDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <ul className="review-newtags">
      {value.map((n, i) => {
        const d = drafts[i];
        if (!d) return null;
        return (
          <li key={i} data-testid="review-newtag" data-index={i}>
            <label className="check">
              <input type="checkbox" checked={d.keep} disabled={disabled} onChange={(e) => set(i, { keep: e.target.checked })} data-testid="review-newtag-keep" />
              <span>{t('review.newTagKeep')}</span>
            </label>
            <div className="two-col">
              <label>
                {t('review.newTagLabel')}
                <input type="text" value={d.label} disabled={disabled || !d.keep} maxLength={200} onChange={(e) => set(i, { label: e.target.value })} data-testid="review-newtag-label" />
              </label>
              <label>
                {t('review.newTagParent')}
                <select value={d.parentId} disabled={disabled || !d.keep} onChange={(e) => set(i, { parentId: e.target.value })} data-testid="review-newtag-parent">
                  <option value="">{t('review.noParent')}</option>
                  {d.parentId !== '' && !model.byId.has(d.parentId) && <option value={d.parentId}>{labelOf(d.parentId)}</option>}
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {safeText(o.label)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {t('review.newTagAliases')}
              <input type="text" value={d.aliases} disabled={disabled || !d.keep} onChange={(e) => set(i, { aliases: e.target.value })} data-testid="review-newtag-aliases" />
            </label>
            {n.reason && <p className="hint">{safeText(n.reason)}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** One AI field of one document, with the decisions the review offers: accept (all or part), edit, reject. */
export function ReviewItemView({ item, onDone }: { item: ReviewItemData; onDone(): void }) {
  const { t } = useTranslation();
  const { model } = useTaxonomy();
  const { decide } = useDecide();
  const editId = useId();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const isList = item.field === 'keywords' || item.field === 'synonyms';
  const isText = item.field === 'description' || item.field === 'summary';
  const [draft, setDraft] = useState(isText ? item.value : isList ? item.value.join('\n') : '');
  const [keepTags, setKeepTags] = useState<Set<string>>(() => new Set(item.field === 'tags' ? item.value : []));
  const [newTags, setNewTags] = useState<NewTagDraft[]>(() =>
    item.field === 'newTags' ? item.value.map((n) => ({ keep: true, label: n.label, parentId: n.parentId ?? '', aliases: n.aliases.join(', ') })) : [],
  );
  const proposed = item.status === 'proposed';

  const run = async (req: Pick<DecideRequest, 'decision' | 'keepTagIds' | 'keepNewTags' | 'text' | 'items'>) => {
    setBusy(true);
    const r = await decide({ docId: item.docId, field: item.field, expectedRevision: item.revision, ...req });
    setBusy(false);
    onDone();
    return r;
  };

  const accept = () => {
    if (item.field === 'tags') {
      const keep = item.value.filter((id) => keepTags.has(id));
      return run({ decision: 'accept', ...(keep.length < item.value.length ? { keepTagIds: keep } : {}) });
    }
    if (item.field === 'newTags') {
      const keep = newTags.flatMap((d, index) =>
        d.keep
          ? [
              {
                index,
                label: d.label.trim() || (item.value[index]?.label ?? ''),
                parentId: d.parentId === '' ? null : d.parentId,
                aliases: d.aliases.split(',').map((a) => a.trim()).filter(Boolean),
              },
            ]
          : [],
      );
      return run({ decision: 'accept', keepNewTags: keep });
    }
    return run({ decision: 'accept' });
  };

  const saveEdit = async () => {
    const r = isText ? await run({ decision: 'edit', text: draft.trim() }) : await run({ decision: 'edit', items: splitLines(draft) });
    if (r) setEditing(false);
  };

  const nothingKept = (item.field === 'tags' && keepTags.size === 0) || (item.field === 'newTags' && !newTags.some((d) => d.keep));

  let body;
  if (item.field === 'tags') {
    body = (
      <ul className="ai-chips review-tags" aria-label={t('review.tagsLabel')}>
        {item.value.map((id) => {
          const node = model.byId.get(resolveId(model, id));
          const on = keepTags.has(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={on ? 'toggle on' : 'toggle'}
                aria-pressed={on}
                disabled={!proposed || busy}
                onClick={() => setKeepTags((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : new Set([...cur, id])))}
                data-testid="review-tag"
                data-tag={id}
              >
                <TagChip label={node?.label ?? id} color={node?.color} deprecated={node?.status === 'deprecated'} />
              </button>
            </li>
          );
        })}
      </ul>
    );
  } else if (item.field === 'newTags') {
    body = proposed ? (
      <NewTagRows value={item.value} drafts={newTags} setDrafts={setNewTags} disabled={busy} />
    ) : (
      <ul className="ai-chips">
        {item.value.map((n, i) => (
          <li key={i} className="ai-chip">
            {safeText(n.label)}
          </li>
        ))}
      </ul>
    );
  } else if (item.field === 'relations') {
    body = (
      <ul className="review-relations">
        {item.value.map((r) => (
          <li key={r.docId}>
            <DocChip docId={r.docId} /> <span className="hint">{safeText(r.reason)}</span>
          </li>
        ))}
      </ul>
    );
  } else if (editing) {
    body = (
      <div className="field">
        <label htmlFor={editId}>{t(isList ? 'review.editList' : 'review.editText')}</label>
        <textarea id={editId} rows={isList ? 5 : 6} value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="review-edit-text" />
      </div>
    );
  } else if (isList) {
    body = (
      <ul className="ai-chips">
        {item.value.map((k) => (
          <li key={k} className="ai-chip">
            {safeText(k)}
          </li>
        ))}
      </ul>
    );
  } else {
    body = <p className="ai-text">{safeText(item.value as string)}</p>;
  }

  const editable = isText || isList;
  const fieldName = t(`review.fields.${item.field}`);
  return (
    <li className='review-item' data-testid='review-item' data-doc-id={item.docId} data-field={item.field} data-status={item.status}>
      <div className='review-item-head'>
        <h4>{fieldName}</h4>
        <div className='review-item-body'>{body}</div>
        {proposed && !editing && (
          <div className='review-item-acts'>
            {editable && (
              <Button variant='ghost' size='sm' disabled={busy} onClick={() => setEditing(true)} data-testid='review-edit'>
                {t('review.edit')}
              </Button>
            )}
            <IconButton label={t('review.rejectField', { field: fieldName })} size='sm' disabled={busy} onClick={() => void run({ decision: 'reject' })} data-testid='review-reject'>
              <IconClose size={16} />
            </IconButton>
            <IconButton label={item.field === 'tags' && keepTags.size < item.value.length ? t('review.acceptSome', { count: keepTags.size }) : t('review.acceptField', { field: fieldName })} size='sm' variant='secondary' disabled={busy || nothingKept} onClick={() => void accept()} data-testid='review-accept'>
              <IconCheck size={16} />
            </IconButton>
          </div>
        )}
      </div>
      {item.originalValue !== undefined && !editing && <p className='hint'>{t('review.edited')}</p>}
      {proposed && editing && (
        <div className='actions start'>
          <Button variant='primary' size='sm' disabled={busy || draft.trim() === ''} onClick={() => void saveEdit()} data-testid='review-edit-save'>
            {t('review.saveEdit')}
          </Button>
          <Button size='sm' disabled={busy} onClick={() => setEditing(false)} data-testid='review-edit-cancel'>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </li>
  );
}
