import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackInfo, PackListResult, PackMatch, PackPreview } from '@rl/core';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { ErrorNote } from '../../../components/ui';
import { errorMessage } from '../../../lib/errors';
import { rl } from '../../../lib/rl';
import { useNotify } from '../../../lib/notify';
import { safeText } from '../safeText';
import { useTaxonomy } from '../useTaxonomy';

/** What the user decides about a match: link, link and take the field's name, or "not the same" (remembered, never proposed again). */
type Action = 'link' | 'name' | 'no';
interface Row {
  match: PackMatch;
  on: boolean;
  action: Action;
}
const key = (m: { nodeId: string; conceptId: string }): string => `${m.nodeId}\u0000${m.conceptId}`;

/**
 * The field vocabulary (D-516 .. D-518, section 20.1.2): the packs with what each would recognise in this library, then three steps
 * (families, matches, places), each with its changes before the apply, the sure ones ticked. Everything is computed locally; applying is
 * one undoable change. When a pack is in use the dialog offers to stop using it, or to undo the links as well.
 */
export function PackDialog({ onClose }: { onClose(): void }) {
  const { t, i18n } = useTranslation();
  const { model, labelOf } = useTaxonomy();
  const { info, reportError } = useNotify();
  const [list, setList] = useState<PackListResult | null>(null);
  const [previews, setPreviews] = useState<Record<string, PackPreview>>({});
  const [error, setError] = useState<unknown>(null);
  const [pack, setPack] = useState<PackInfo | null>(null);
  const [step, setStep] = useState(1);
  const [fam, setFam] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [places, setPlaces] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const it = i18n.language.startsWith('it');
  const name = (p: PackInfo): string => (it && p.labelIt ? p.labelIt : p.label);

  useEffect(() => {
    let live = true;
    rl.invoke('vocabPack:list', {}).then(
      async (l) => {
        if (!live) return;
        setList(l);
        // A pack in use is looked at again only for what is left of it to review (the likely and the maybe, D-565).
        for (const p of l.active ? l.packs.filter((x) => x.id === l.active?.packId) : l.packs) {
          const pv = await rl.invoke('vocabPack:preview', { packId: p.id }).catch(() => null);
          if (live && pv) setPreviews((cur) => ({ ...cur, [p.id]: pv }));
        }
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, []);

  const start = (p: PackInfo) => {
    const pv = previews[p.id];
    if (!pv) return;
    setPack(p);
    setStep(1);
    setFam(Object.fromEntries(pv.families.map((f) => [f.packFamily, f.root])));
    setRows(pv.matches.map((m) => ({ match: m, on: m.confidence === 'sure', action: 'link' as Action })));
    setPlaces({});
  };
  const pv = pack ? previews[pack.id] : undefined;
  const accepted = useMemo(() => new Set(rows.filter((r) => r.on && r.action !== 'no').map((r) => r.match.nodeId)), [rows]);
  const placeRows = useMemo(() => (pv?.place ?? []).filter((p) => accepted.has(p.nodeId)), [pv, accepted]);
  const roots = useMemo(() => model.nodes.filter((n) => n.parents.length === 0 && (n.family === 'one' || n.family === 'many')), [model]);
  const setRow = (i: number, patch: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const apply = async () => {
    if (!pack || !pv || busy) return;
    setBusy(true);
    try {
      const chosen = rows.filter((r) => r.on && r.action !== 'no');
      const detected = new Set(pv.families.map((f) => f.root));
      const r = await rl.invoke('vocabPack:enable', {
        packId: pack.id,
        families: fam,
        accept: {
          matches: chosen.map((x) => ({ nodeId: x.match.nodeId, conceptId: x.match.conceptId, ...(x.action === 'name' ? { useFieldName: true } : {}) })),
          // A tag put at level 1 follows the family pairing chosen in step 1, so it goes by `null`.
          place: placeRows.filter((p) => places[p.nodeId] !== false).map((p) => ({ nodeId: p.nodeId, parentId: p.parentId !== null && detected.has(p.parentId) ? null : p.parentId })),
        },
        reject: rows.filter((x) => x.on && x.action === 'no').map((x) => [x.match.nodeId, x.match.conceptId]),
      });
      info(t('pack.done', { linked: r.linked, placed: r.placed }));
      onClose();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const disable = async (undo: boolean) => {
    setBusy(true);
    try {
      const r = await rl.invoke('vocabPack:disable', { undo });
      info(r.stopped ? t('pack.stopped', { reason: r.stopped }) : undo ? t('pack.undone', { count: r.undone }) : t('pack.stoppedUsing'));
      onClose();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const reason = (r: string): string => t(`pack.reason.${r}`);
  const confidence = (c: string): string => t(`pack.confidence.${c}`);
  const famName = (id: string): string => pack?.families.find((f) => f.id === id)?.label ?? id;
  const parentName = (p: { nodeId: string; parentId: string | null }): string => {
    if (p.parentId === null) return t('pack.levelOne', { family: safeText(famName((rows.find((r) => r.match.nodeId === p.nodeId)?.match.path ?? '').split(' › ')[0] ?? '')) });
    return safeText(labelOf(p.parentId));
  };

  return (
    <Dialog title={t('pack.open')} onClose={onClose} testId="pack-dialog">
      <div className="dialog-body" style={{ display: 'grid', gap: 'var(--space-3)', maxHeight: '70vh', overflow: 'auto' }}>
        {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
        {!list && !error && <p className="hint">{t('pack.loading')}</p>}
        {list && list.active && !pack && (
          <section data-testid="pack-active">
            <p>{t('pack.active', { name: safeText(name(list.packs.find((p) => p.id === list.active?.packId) ?? { id: '', version: 0, label: list.active.packId, families: [] })) })}</p>
            {(() => {
              const left = previews[list.active.packId]?.matches.length ?? 0;
              const info = list.packs.find((p) => p.id === list.active?.packId);
              return left > 0 && info ? (
                <p>
                  <span className="hint" data-testid="pack-review-left">
                    {t('pack.review.left', { count: left })}
                  </span>{' '}
                  <Button size="sm" onClick={() => start(info)} data-testid="pack-review">
                    {t('pack.review.open')}
                  </Button>
                </p>
              ) : null;
            })()}
            {leaving ? (
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Button onClick={() => void disable(false)} busy={busy} data-testid="pack-disable-keep">
                  {t('pack.disable.keep')}
                </Button>
                <Button variant="danger" onClick={() => void disable(true)} busy={busy} data-testid="pack-disable-undo">
                  {t('pack.disable.undo')}
                </Button>
              </div>
            ) : (
              <Button onClick={() => setLeaving(true)} data-testid="pack-disable">
                {t('pack.disable.open')}
              </Button>
            )}
          </section>
        )}
        {list && !list.active && !pack && (
          <>
            {list.packs.length === 0 && <p className="hint">{t('pack.none')}</p>}
            <ul className="tag-cleanup__rows">
              {list.packs.map((p) => {
                const v = previews[p.id];
                return (
                  <li key={p.id} className="tag-cleanup__row" data-testid="pack-item" data-pack={p.id}>
                    <strong>{safeText(name(p))}</strong>
                    <span className="hint">{p.families.map((f) => `${f.label} ${f.concepts}`).join(' · ')}</span>
                    {v ? (
                      <span className="hint" data-testid="pack-preview">
                        {t('pack.preview', { n: v.recognized, tags: v.tags, p: v.papersWithTopic, total: v.papers })} · {t('pack.conflicts', { count: v.conflicts })}
                      </span>
                    ) : (
                      <span className="hint">{t('pack.loading')}</span>
                    )}
                    <Button variant="primary" size="sm" disabled={!v} onClick={() => start(p)} data-testid="pack-enable">
                      {t('pack.enable')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {pack && pv && (
          <>
            <ol className="tag-cleanup__steps" aria-label={t('pack.steps')}>
              {[1, 2, 3].map((n) => (
                <li key={n}>
                  <button type="button" className={n === step ? 'is-current' : undefined} aria-current={n === step ? 'step' : undefined} onClick={() => setStep(n)} data-testid={`pack-step-${n}`}>
                    {n}. {t(`pack.step.${n}`)}
                  </button>
                </li>
              ))}
            </ol>
            {step === 1 && (
              <div data-testid="pack-families">
                <p className="hint">{t('pack.hint.1')}</p>
                <ul className="tag-cleanup__rows">
                  {pv.families.map((f) => (
                    <li key={f.packFamily} className="tag-cleanup__row" data-testid="pack-family-row" data-family={f.packFamily}>
                      <strong>{safeText(famName(f.packFamily))}</strong>
                      <span aria-hidden="true">→</span>
                      <select value={fam[f.packFamily] ?? 'later'} onChange={(e) => setFam((cur) => ({ ...cur, [f.packFamily]: e.target.value }))} aria-label={famName(f.packFamily)} data-testid="pack-family-root">
                        <option value="later">{t('pack.later')}</option>
                        {roots.map((r) => (
                          <option key={r.id} value={r.id}>
                            {safeText(r.label)}
                          </option>
                        ))}
                      </select>
                      <span className="hint">{reason(f.reason)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {step === 2 && (
              <div data-testid="pack-matches">
                <p className="hint">{t('pack.hint.2')}</p>
                {rows.length === 0 && <p className="hint">{t('pack.noMatches')}</p>}
                <ul className="tag-cleanup__rows">
                  {rows.map((r, i) => (
                    <li key={key(r.match)} className="tag-cleanup__row" data-testid="pack-match-row" data-confidence={r.match.confidence} data-checked={r.on}>
                      <label className="check">
                        <input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} />
                        <span>
                          «{safeText(labelOf(r.match.nodeId))}» → {safeText(r.match.path)}
                        </span>
                      </label>
                      <span className="badge">{confidence(r.match.confidence)}</span>
                      <select value={r.action} disabled={!r.on} onChange={(e) => setRow(i, { action: e.target.value as Action })} aria-label={t('pack.actionLabel')}>
                        <option value="link">{t('pack.action.link')}</option>
                        <option value="name">{t('pack.action.name')}</option>
                        <option value="no">{t('pack.action.no')}</option>
                      </select>
                    </li>
                  ))}
                  {pv.distinct.map((d) => (
                    <li key={key(d)} className="tag-cleanup__row" data-testid="pack-distinct-row">
                      <span className="hint">
                        «{safeText(labelOf(d.nodeId))}»: {t('pack.distinct')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {step === 3 && (
              <div data-testid="pack-places">
                <p className="hint">{t('pack.hint.3')}</p>
                {placeRows.length === 0 && <p className="hint">{t('pack.noPlaces')}</p>}
                <ul className="tag-cleanup__rows">
                  {placeRows.map((p) => (
                    <li key={p.nodeId} className="tag-cleanup__row" data-testid="pack-place-row">
                      <label className="check">
                        <input type="checkbox" checked={places[p.nodeId] !== false} onChange={(e) => setPlaces((cur) => ({ ...cur, [p.nodeId]: e.target.checked }))} />
                        <span>{t('pack.place', { tag: safeText(labelOf(p.nodeId)), parent: parentName(p) })}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button onClick={() => (step === 1 ? setPack(null) : setStep(step - 1))}>{t('pack.back')}</Button>
              {step < 3 ? (
                <Button variant="primary" onClick={() => setStep(step + 1)}>
                  {t('pack.next')}
                </Button>
              ) : (
                <Button variant="primary" busy={busy} onClick={() => void apply()} data-testid="pack-apply">
                  {t('pack.apply')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
