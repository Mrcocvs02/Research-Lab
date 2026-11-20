import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagCleanupRow } from '@rl/core';
import { Button } from '../../../components/Button';
import { rl } from '../../../lib/rl';
import { safeText } from '../safeText';
import { useTaxonomy } from '../useTaxonomy';
import { FamilyBoard } from './FamilyBoard';
import { TagAcceptAll } from './TagAcceptAll';
import { TagAiConfirm } from './TagAiConfirm';
import { STEPS, SUMMARY, appliedSteps, currentStep, docEdits, ghosts, rowChecked, rowVariant, rowsAcceptAll, rowsToApply, stepState, summaryLines, type RowState } from './tagCleanupModel';
import { useTagChange, useTagReview } from './useTagReview';

/**
 * The guided cleanup (D-497, §19.1.5): five steps then a summary, each step shows its proposals with the sure ones ticked, applies as one
 * undoable change, can be skipped or undone. The run is kept in `tag-review.json`: stop and resume.
 */
export function TagCleanup({ initialStep, onClose, onMap }: { initialStep: number | null; onClose(): void; onMap(): void }) {
  const { t } = useTranslation();
  const { labelOf } = useTaxonomy();
  const { run, offerUndo, changed } = useTagChange();
  const [picked, setPicked] = useState<number | null>(initialStep);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [asking, setAsking] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [haiku, setHaiku] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: d } = useTagReview(picked !== null && picked < SUMMARY ? picked : undefined);
  // Resuming: the run tells which step is next (the rows of that step then load).
  useEffect(() => {
    if (picked === null && d) setPicked(currentStep(d.run));
  }, [picked, d]);
  const step = picked ?? 1;
  const rows: TagCleanupRow[] = (d?.rows ?? []).filter((r) => r.step === step);
  const status = d ? stepState(d.run, step) : 'todo';
  const ghostList = useMemo(() => (step === 4 ? ghosts(rows, state) : []), [step, rows, state]);
  const plain = step === 4 ? rows.filter((r) => !ghosts([r], {}).length) : rows;
  const setRow = (id: string, s: RowState) => setState((cur) => ({ ...cur, [id]: { ...cur[id], ...s } }));
  const ticked = rowsToApply(rows, state);

  const everything = useMemo(() => rowsAcceptAll(rows, new Set((d?.proposals ?? []).map((p) => p.id)), new Set(d?.acceptable ?? [])), [rows, d]);

  const go = (n: number) => setPicked(n);
  const apply = async (picked: Array<{ id: string; variant?: string }> = ticked) => {
    if (!d || busy) return;
    setBusy(true);
    const r = await run(() => rl.invoke('tagReview:apply', { step: step as 1, rows: picked, expectedRevision: d.revision }));
    setBusy(false);
    if (!r) return;
    offerUndo(t('tax.cleanup.applied', { step, count: r.applied }), r.changeId);
    go(Math.min(SUMMARY, step + 1));
  };
  const skip = async () => {
    if (await run(() => rl.invoke('tagReview:skip', { step: step as 1 }))) go(Math.min(SUMMARY, step + 1));
  };
  const undo = async (n?: number) => {
    const r = await run(() => rl.invoke('tagReview:undoRun', n ? { step: n as 1 } : {}));
    if (r) offerUndo(t('tax.cleanup.undone', { count: r.undone }), null);
  };
  const cell = (r: TagCleanupRow) => (
    <li key={r.id} className={r.marked ? 'tag-cleanup__row is-marked' : 'tag-cleanup__row'} data-testid="tag-cleanup-row" data-kind={r.kind} data-checked={rowChecked(r, state)}>
      <label>
        <input type="checkbox" checked={rowChecked(r, state)} onChange={(e) => setRow(r.id, { checked: e.target.checked })} />
        <span>{r.tags.map((id) => safeText(labelOf(id))).join(' · ')}</span>
      </label>
      <span className="hint">{t(`tax.cleanup.kind.${r.kind}`, { defaultValue: r.kind })}</span>
      {r.marked && <span className="badge badge-warn">{t('tax.cleanup.marked')}</span>}
      {r.remains && <span className="hint">{t('tax.cleanup.remains')}</span>}
      {Object.keys(r.variants).length > 1 && (
        <select value={rowVariant(r, state)} aria-label={t('tax.cleanup.variant')} onChange={(e) => setRow(r.id, { variant: e.target.value })} data-testid="tag-cleanup-variant">
          {Object.keys(r.variants).map((v) => (
            <option key={v} value={v}>
              {t(`tax.cleanup.variants.${v}`, { defaultValue: v })}
            </option>
          ))}
        </select>
      )}
    </li>
  );

  return (
    <div className="tag-cleanup" data-testid="tag-cleanup">
      <header className="tag-cleanup__head">
        <h2>{t('tax.cleanup.title')}</h2>
        <ol className="tag-cleanup__steps">
          {[...STEPS, SUMMARY].map((n) => (
            <li key={n}>
              <button type="button" className={n === step ? 'is-current' : ''} aria-current={n === step ? 'step' : undefined} data-state={n === SUMMARY ? undefined : d ? stepState(d.run, n) : 'todo'} onClick={() => go(n)} data-testid={`tag-cleanup-step-${n}`}>
                {n}. {t(`tax.cleanup.step.${n}`)}
              </button>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" onClick={onClose} data-testid="tag-cleanup-close">
          {t('tax.cleanup.close')}
        </Button>
      </header>

      {d && step < SUMMARY && (
        <>
          <p className="hint" data-testid="tag-cleanup-stats">{t('tax.cleanup.stats', { tags: d.stats.tags, singletons: d.stats.singletons, dupes: d.stats.dupeConcepts, orphans: d.stats.orphans, depth: d.stats.maxDepth })}</p>
          <p>{t(`tax.cleanup.intro.${step}`)}</p>
          {status !== 'todo' && status !== 'undone' && <p className="callout" data-testid="tag-cleanup-status">{t(`tax.cleanup.state.${status}`)}</p>}
          {step === 4 && <FamilyBoard ghosts={ghostList} state={state} onState={setRow} />}
          {plain.length === 0 && ghostList.length === 0 ? <p className="empty">{t('tax.cleanup.noRows')}</p> : <ul className="tag-cleanup__rows">{plain.map(cell)}</ul>}
          <div className="actions" data-testid="tag-cleanup-actions">
            {step === 2 && (
              <Button size="sm" onClick={() => setAsking(true)} data-testid="tag-review-ai">
                {t('tax.review.ai.button', { count: rows.filter((r) => r.confidence === 'likely').length })}
              </Button>
            )}
            <Button variant="primary" busy={busy} disabled={status === 'applied' || ticked.length === 0} onClick={() => void apply()} data-testid="tag-cleanup-apply">
              {t('tax.cleanup.apply', { count: ticked.length, docs: docEdits(rows, state) })}
            </Button>
            <Button disabled={status === 'applied' || (d?.proposals.filter((p) => p.confidence !== 'sure' && !p.ai).length ?? 0) === 0} onClick={() => setHaiku(true)} data-testid="tag-cleanup-haiku">
              {t('tax.haiku.button', { count: d?.proposals.filter((p) => p.confidence !== 'sure' && !p.ai).length ?? 0 })}
            </Button>
            <Button disabled={status === 'applied' || everything.rows.length === 0 || busy} onClick={() => setConfirmAll(true)} data-testid="tag-cleanup-accept-all">
              {t('tax.cleanup.acceptAll', { count: everything.rows.length })}
            </Button>
            <Button onClick={() => void skip()} disabled={status === 'skipped' || status === 'applied'} data-testid="tag-cleanup-skip">
              {t('tax.cleanup.skip')}
            </Button>
            {status === 'applied' && (
              <Button onClick={() => void undo(step)} data-testid="tag-cleanup-undo-step">
                {t('tax.cleanup.undoStep')}
              </Button>
            )}
          </div>
        </>
      )}

      {d && step === SUMMARY && (
        <div data-testid="tag-cleanup-summary">
          <table className="tag-cleanup__table">
            <thead>
              <tr>
                <th />
                <th>{t('tax.cleanup.before')}</th>
                <th>{t('tax.cleanup.after')}</th>
              </tr>
            </thead>
            <tbody>
              {summaryLines(d.run.before, d.stats).map((l) => (
                <tr key={l.key}>
                  <th scope="row">{t(`tax.cleanup.stat.${l.key}`)}</th>
                  <td>{l.before}</td>
                  <td>{l.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <Button disabled={appliedSteps(d.run).length === 0} onClick={() => void undo()} data-testid="tag-cleanup-undo-all">
              {t('tax.cleanup.undoAll')}
            </Button>
            <Button variant="primary" onClick={onMap} data-testid="tag-cleanup-map">
              {t('tax.cleanup.toMap')}
            </Button>
          </div>
        </div>
      )}
      {confirmAll && (
        <TagAcceptAll
          sure={everything.sure}
          likely={everything.likely}
          busy={busy}
          onClose={() => setConfirmAll(false)}
          onConfirm={() => {
            setConfirmAll(false);
            void apply(everything.rows);
          }}
        />
      )}
      {haiku && (
        <TagAiConfirm
          decide
          onClose={() => setHaiku(false)}
          onDone={() => {
            setHaiku(false);
            changed();
          }}
        />
      )}
      {asking && (
        <TagAiConfirm
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            changed();
          }}
        />
      )}
    </div>
  );
}
