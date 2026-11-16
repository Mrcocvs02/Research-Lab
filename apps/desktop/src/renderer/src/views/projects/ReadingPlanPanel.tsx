import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail, StudyState } from '@rl/core';
import { safeText } from '../library/safeText';
import { appendMembers, effectiveStatus, moveItem, notInPlan, planProgress, sortPlan, type PlanItemView } from './readingPlan';

const STATES: StudyState[] = ['to-read', 'reading', 'read'];

interface Props {
  detail: ProjectDetail;
  /** Saves the whole plan (already ordered); the panel does not keep its own copy. */
  onChange(items: PlanItemView[]): void;
}

/**
 * The reading plan: an ordered list with a state per item. Reorder by dragging a row, with Alt+Up / Alt+Down on
 * a focused row, or with the move buttons; every route ends in the same `onChange`.
 */
export function ReadingPlanPanel({ detail, onChange }: Props) {
  const { t } = useTranslation();
  const items = sortPlan(detail.readingPlan);
  const addable = notInPlan(detail.members, items);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const progress = planProgress(items);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) return;
    onChange(moveItem(items, from, to));
    setAnnounce(t('plan.moved', { title: items[from]?.title ?? '', position: to + 1, total: items.length }));
  };
  const setStatus = (i: number, status: StudyState) => onChange(items.map((it, j) => (j === i ? { ...it, status } : it)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i).map((it, j) => ({ ...it, order: j })));

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
      move(i, to);
      // keep the focus on the moved row
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-plan-doc="${items[i]?.docId}"]`)?.focus());
    }
  };

  return (
    <div className="plan" data-testid="reading-plan">
      <p className="hint">{t('plan.hint')}</p>
      <p className="plan-progress" data-testid="plan-progress">
        {t('plan.progress', { read: progress.read, reading: progress.reading, toRead: progress['to-read'], total: progress.total })}
      </p>
      {items.length === 0 && (
        <p className="empty" data-testid="plan-empty">
          {t('plan.empty')}
        </p>
      )}
      <ol className="plan-list">
        {items.map((it, i) => (
          <li
            key={it.docId}
            className={['plan-item', dragFrom === i ? 'dragging' : '', overIndex === i && dragFrom !== null && dragFrom !== i ? 'drop-over' : ''].filter(Boolean).join(' ')}
            tabIndex={0}
            draggable
            data-testid="plan-item"
            data-plan-doc={it.docId}
            data-status={effectiveStatus(it)}
            aria-label={t('plan.itemLabel', { position: i + 1, title: safeText(it.title ?? it.docId) })}
            onKeyDown={(e) => e.target === e.currentTarget && onKeyDown(e, i)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', it.docId);
              setDragFrom(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setOverIndex(null);
            }}
            onDragOver={(e) => {
              if (dragFrom !== null) {
                e.preventDefault();
                setOverIndex(i);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
              setOverIndex(null);
            }}
          >
            <span className="plan-grip" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="plan-pos">{i + 1}</span>
            <span className="plan-title">
              {safeText(it.title ?? it.docId)}
              {it.missing && <span className="badge badge-warn">{t('docs.missing')}</span>}
            </span>
            <label className="plan-status">
              <span className="sr-only">{t('plan.status', { title: safeText(it.title ?? it.docId) })}</span>
              <select value={effectiveStatus(it)} onChange={(e) => setStatus(i, e.target.value as StudyState)} data-testid="plan-status">
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {t(`study.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <span className="plan-buttons">
              <button type="button" className="icon-button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t('plan.moveUp', { title: safeText(it.title ?? it.docId) })} data-testid="plan-up">
                <span aria-hidden="true">↑</span>
              </button>
              <button type="button" className="icon-button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={t('plan.moveDown', { title: safeText(it.title ?? it.docId) })} data-testid="plan-down">
                <span aria-hidden="true">↓</span>
              </button>
              <button type="button" className="icon-button" onClick={() => remove(i)} aria-label={t('plan.remove', { title: safeText(it.title ?? it.docId) })} data-testid="plan-remove">
                <span aria-hidden="true">×</span>
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {addable.length > 0 && (
        <div className="plan-add">
          <button type="button" onClick={() => onChange(appendMembers(items, addable))} data-testid="plan-add-all">
            {t('plan.addAll', { count: addable.length })}
          </button>
          <ul className="plain-list">
            {addable.slice(0, 50).map((m) => (
              <li key={m.docId}>
                <button type="button" className="link" onClick={() => onChange(appendMembers(items, [m]))} data-testid="plan-add-one">
                  {t('plan.addOne', { title: safeText(m.title ?? m.docId) })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
