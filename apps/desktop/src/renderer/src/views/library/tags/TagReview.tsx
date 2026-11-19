import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagProposal } from '@rl/core';
import { Button } from '../../../components/Button';
import { rl } from '../../../lib/rl';
import { safeText } from '../safeText';
import { useTaxonomy } from '../useTaxonomy';
import { TagAiConfirm } from './TagAiConfirm';
import { REVIEW_FILTERS, applyItem, countByKind, filterProposals, isFolded, keepOptions, moveIndex, paperTotal, sortProposals, sureOnes, uncertainCount, type ReviewFilter, type RowChoice } from './tagReviewModel';
import { useTagChange, type TagData } from './useTagReview';

const DOT = { sure: '●', likely: '◐', maybe: '○' } as const;

/** The "To review" tab (D-494, §19.1.3): near-duplicates, twins, parents, names and metadata, each applied in one click that Undo takes back. */
export function TagReview({ data, initial }: { data: TagData; initial: ReviewFilter | null }) {
  const { t } = useTranslation();
  const { labelOf } = useTaxonomy();
  const { run, offerUndo } = useTagChange();
  const [on, setOn] = useState<Set<ReviewFilter>>(new Set(initial ? [initial] : []));
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const all = useMemo(() => sortProposals(data.proposals), [data.proposals]);
  const rows = useMemo(() => filterProposals(all, on), [all, on]);
  const counts = useMemo(() => countByKind(all), [all]);
  const sure = useMemo(() => sureOnes(rows), [rows]);
  const uncertain = uncertainCount(all);
  const name = (id: string) => safeText(labelOf(id));
  const choose = (id: string, c: RowChoice) => setChoices((cur) => ({ ...cur, [id]: { ...cur[id], ...c } }));

  const apply = async (ps: TagProposal[]) => {
    if (busy || ps.length === 0) return;
    setBusy(true);
    const r = await run(() => rl.invoke('tagReview:apply', { items: ps.map((p) => applyItem(p, choices[p.id])), expectedRevision: data.revision }));
    setBusy(false);
    if (!r) return;
    const only = ps.length === 1 ? ps[0]! : null;
    const target = only ? (choices[only.id]?.label ?? only.label ?? name(choices[only.id]?.keep ?? only.keep ?? only.tags[0]!)) : '';
    offerUndo(only ? t(`tax.review.done.${only.kind}`, { count: only.tags.length, name: target }) : t('tax.review.doneMany', { count: r.applied }), r.changeId);
  };
  const reject = async (ps: TagProposal[]) => {
    const r = await run(() => rl.invoke('tagReview:reject', { ids: ps.map((p) => p.id) }));
    if (r) offerUndo(t('tax.review.rejected', { count: r.rejected }), r.changeId);
  };

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    const i = (e.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row;
    const idx = i === undefined ? focus : Number(i);
    const p = rows[idx];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = moveIndex(idx, e.key, rows.length);
      setFocus(next);
      list.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus();
    } else if (p && e.key === 'Enter' && e.target === e.currentTarget.querySelector(`[data-row="${idx}"]`)) {
      e.preventDefault();
      void apply([p]);
    } else if (p && (e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void reject([p]);
    }
  };

  const toggle = (k: ReviewFilter) => setOn((cur) => (cur.has(k) ? new Set([...cur].filter((x) => x !== k)) : new Set([...cur, k])));

  return (
    <div className="tag-review" data-testid="tag-review-list">
      <div className="tag-review__bar">
        <Button variant="primary" size="sm" disabled={sure.length === 0 || busy} onClick={() => void apply(sure)} data-testid="tag-review-accept-sure">
          {t('tax.review.acceptSure', { count: sure.length })}
        </Button>
        <span className="tag-review__show" role="group" aria-label={t('tax.review.show')}>
          {REVIEW_FILTERS.map((k) => (
            <button key={k} type="button" className={on.has(k) ? 'rl-chip rl-chip--filter is-selected' : 'rl-chip rl-chip--filter'} aria-pressed={on.has(k)} onClick={() => toggle(k)} data-testid={`tag-review-filter-${k}`}>
              {t(`tax.review.kind.${k}`)} {counts[k]}
            </button>
          ))}
        </span>
        <Button size="sm" disabled={uncertain === 0} disabledReason={t('tax.review.ai.none')} onClick={() => setAsking(true)} data-testid="tag-review-ai">
          {t('tax.review.ai.button', { count: uncertain })}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="empty" data-testid="tag-review-empty">{t('tax.review.empty')}</p>
      ) : (
        <div ref={list} role="list" aria-label={t('tax.review.title')} onKeyDown={onKeys}>
          {rows.map((p, i) => {
            const choice = choices[p.id];
            const keep = choice?.keep ?? p.keep ?? p.tags[0]!;
            const label = choice?.label ?? p.label;
            return (
              <div
                key={p.id}
                role="listitem"
                tabIndex={i === Math.min(focus, rows.length - 1) ? 0 : -1}
                className={isFolded(p) ? 'tag-review__row is-folded' : 'tag-review__row'}
                data-row={i}
                data-testid="tag-review-row"
                data-kind={p.kind}
                data-confidence={p.confidence}
                onFocus={() => setFocus(i)}
                title={p.tags.map((id) => `${name(id)}: ${p.evidence.papers[id] ?? 0}`).join(' · ') + ' · ' + t('tax.review.shared', { count: p.evidence.shared })}
              >
                <span className="tag-review__conf" aria-label={t(`tax.review.conf.${p.confidence}`)}>{DOT[p.confidence]}</span>
                <span className="tag-review__why">
                  {t(`tax.review.conf.${p.confidence}`)} · {t(`tax.review.reason.${p.reason.split(',')[0]}`, { defaultValue: p.reason })}
                </span>
                <span className="tag-review__tags">{p.tags.map(name).join(' · ')}</span>
                {p.ai && <span className="badge badge-ai" data-testid="tag-review-ai-note" title={safeText(p.ai.note)}>{t(`tax.review.ai.verdict.${p.ai.verdict}`)}</span>}
                <span className="tag-review__to">
                  {(p.kind === 'merge' || p.kind === 'parent') && (
                    <select value={keep} aria-label={t(p.kind === 'parent' ? 'tax.review.parentOf' : 'tax.review.keep')} onChange={(e) => choose(p.id, { keep: e.target.value })} data-testid="tag-review-keep">
                      {keepOptions(p).map((id) => (
                        <option key={id} value={id}>
                          {name(id)}
                        </option>
                      ))}
                    </select>
                  )}
                  {p.kind === 'twins' && (
                    <select value={choice?.action ?? p.action ?? 'merge'} aria-label={t('tax.review.twinsAction')} onChange={(e) => choose(p.id, { action: e.target.value as 'merge' | 'keywords' })} data-testid="tag-review-action">
                      <option value="merge">{t('tax.review.action.merge')}</option>
                      <option value="keywords">{t('tax.review.action.keywords')}</option>
                    </select>
                  )}
                  {(p.kind === 'name' || p.kind === 'merge') && editing === p.id ? (
                    <input type="text" autoFocus maxLength={60} defaultValue={label ?? name(keep)} aria-label={t('tax.review.rename')} onBlur={(e) => { choose(p.id, { label: e.target.value }); setEditing(null); }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} data-testid="tag-review-label" />
                  ) : (
                    <>
                      {label && <span className="tag-review__label">→ {safeText(label)}</span>}
                      {p.meta && <span className="tag-review__label">→ {t(`tax.review.field.${p.meta.field}`)}: {safeText(p.meta.value)}</span>}
                      {(p.kind === 'name' || p.kind === 'merge') && (
                        <button type="button" className="link" aria-label={t('tax.review.rename')} title={t('tax.review.rename')} onClick={() => setEditing(p.id)}>
                          ✎
                        </button>
                      )}
                    </>
                  )}
                </span>
                <span className="tag-review__n">{t('tax.review.papers', { count: paperTotal(p) })}</span>
                <span className="tag-review__acts">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void apply([p])} data-testid="tag-review-accept">
                    {t(`tax.review.accept.${p.kind}`)}
                  </Button>
                  <Button size="sm" onClick={() => void reject([p])} data-testid="tag-review-reject">
                    {t(`tax.review.reject.${p.kind}`)}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {asking && (
        <TagAiConfirm
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            void run(async () => undefined);
          }}
        />
      )}
    </div>
  );
}
