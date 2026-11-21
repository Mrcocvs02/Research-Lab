import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, MacroMove, MacroProposal, MacroStats, RequestOf } from '@rl/core';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { ErrorNote } from '../../../components/ui';
import { errorMessage } from '../../../lib/errors';
import { RlError } from '../../../lib/rl-error';
import { rl } from '../../../lib/rl';
import { safeText } from '../../library/safeText';

type Scope = RequestOf<Channels, 'graph:nameFamily'>['scope'];
interface Today {
  id: string;
  label: string;
  count: number;
}

interface Props {
  family: string;
  scope: Scope;
  onClose(): void;
  /** The cut was applied: the change (for the notice with Undo) and how many moves. */
  onApplied(changeId: string, moves: number): void;
  /** "Select the unclear ones": the dialog closes and these papers are selected on the Map. */
  onSelectUnclear(ids: string[]): void;
}

const pct = (n: number): string => `${Math.round(n)} %`;

/** The numbers of the line "before -> after" (the test reads them from `data-*`). */
function statsLine(b: MacroStats, a: MacroStats): Array<[string, string, string]> {
  return [
    ['blocks', String(b.blocks), String(a.blocks)],
    ['clear', pct(b.clearPct), pct(a.clearPct)],
    ['largest', pct(b.largestPct), pct(a.largestPct)],
    ['smallest', String(b.smallest), String(a.smallest)],
  ];
}

/**
 * The macro-areas dialog (D-520, D-533, D-568, section 20.2.3): the values placed under the macro-areas of the field, as moves the user ticks (all ticked to
 * begin with, but the groups by co-occurrence, which say so and start unticked), with the preview "before -> after" and, under each move, what changes in the tree. Nothing is written until Apply; Apply is ONE
 * change of the taxonomy and one Undo puts everything back. The papers' tags never change.
 */
export default function MacroAreas({ family, scope, onClose, onApplied, onSelectUnclear }: Props) {
  const { t } = useTranslation();
  const [prop, setProp] = useState<MacroProposal | null>(null);
  const [today, setToday] = useState<Today[]>([]);
  const [error, setError] = useState<unknown>(null);
  // `null` = the main process's own start (every move ticked but the groups by co-occurrence, D-568); a list once the user has ticked or unticked a move.
  const [skip, setSkip] = useState<string[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const moves = useRef<MacroMove[]>([]);
  const name = family === 'topic' ? 'Topic' : family;

  // The proposal; each unticked move asks again (the main process computes the cut without it, a few milliseconds).
  useEffect(() => {
    let live = true;
    rl.invoke('mapEdit:macroPropose', { family, ...(scope ? { scope } : {}), ...(skip !== null ? { skip } : {}) }).then(
      (r) => {
        if (!live) return;
        if (moves.current.length === 0) moves.current = r.moves;
        setProp(r);
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [family, scope, skip]);
  // The blocks of today, for the left panel.
  useEffect(() => {
    let live = true;
    rl.invoke('graph:family', { family, ...(scope ? { scope } : {}) }).then(
      (r) => live && setToday((r.blocks ?? []).filter((b) => b.id !== '__none' && b.id !== '__other').map((b) => ({ id: b.id, label: b.label, count: b.count }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [family, scope]);

  const list = moves.current;
  const skipped = useMemo(() => new Set(prop?.skipped ?? []), [prop]);
  const ticked = list.filter((m) => !skipped.has(m.id));
  const total = (m: MacroMove) => (m.share > 0 ? Math.round(m.papers / m.share) : m.papers);
  const nameOf = (m: MacroMove): string => names[m.id] ?? t('macro.provisional', { a: m.children[0]?.label ?? '', b: m.children[1]?.label ?? '' });
  const lacking = ticked.some((m) => m.parent?.kind === 'provisional' && nameOf(m).trim() === '');
  const toggle = (m: MacroMove) => {
    // Unticking a move unticks the ones that need it; ticking again asks without it.
    const cur = [...skipped];
    setSkip(skipped.has(m.id) ? cur.filter((id) => id !== m.id && !list.find((x) => x.id === id)?.requires.includes(m.id)) : [...cur, m.id]);
  };
  const apply = async () => {
    if (busy || ticked.length === 0 || lacking) return;
    setBusy(true);
    const given: Record<string, string> = {};
    for (const m of ticked) if (m.parent?.kind === 'provisional') given[m.id] = nameOf(m).trim();
    try {
      const r = await rl.invoke('mapEdit:macroApply', { family, ...(scope ? { scope } : {}), moves: ticked.map((m) => m.id), names: given });
      onApplied(r.changeId, r.applied);
      onClose();
    } catch (e) {
      setBusy(false);
      if (RlError.from(e).details?.reason === 'stale') setStale(true);
      else setError(e);
    }
  };

  const none = prop !== null && list.length === 0;
  const stats = prop ? statsLine(prop.before, prop.after) : [];
  return (
    <Dialog title={t('macro.title', { family: name })} onClose={onClose} testId="macro-dialog">
      <div className="macro" aria-busy={prop === null && !error}>
        <p className="callout" data-testid="macro-note">
          <strong>{t('macro.noteLead')}</strong> {t('macro.noteRest')}
        </p>
        {error ? <ErrorNote testId="macro-error">{errorMessage(error, t)}</ErrorNote> : null}
        {stale && (
          <p className="callout" role="alert" data-testid="macro-stale">
            {t('macro.stale')}
          </p>
        )}
        {prop === null && !error && (
          <div className="macro-skeleton" data-testid="macro-loading" role="status" aria-label={t('macro.loading')}>
            <span />
            <span />
          </div>
        )}
        {none && (
          <div data-testid="macro-none" data-reason={prop.reason ?? 'no-cut'}>
            <p>{prop.reason === 'fine' ? t('macro.none.fine') : t('macro.none.nocut')}</p>
            {prop.unclear.length > 0 && (
              <Button
                onClick={() => {
                  onSelectUnclear(prop.unclear);
                  onClose();
                }}
                data-testid="macro-select-unclear"
              >
                {t('macro.selectUnclear', { count: prop.unclear.length })}
              </Button>
            )}
          </div>
        )}
        {prop && !none && (
          <>
            <p className="macro-stats" data-testid="macro-stats">
              {stats.map(([k, b, a], i) => (
                <span key={k} data-stat={k} data-before={b} data-after={a}>
                  {i > 0 && ' · '}
                  {t(`macro.stat.${k}`)} {b} → {a}
                </span>
              ))}
            </p>
            <div className="macro-cols">
              <section aria-label={t('macro.today')}>
                <h3>{t('macro.today')}</h3>
                <div className="macro-blocks">
                  {today.map((b) => (
                    <div key={b.id} className="macro-block" style={{ flexGrow: Math.max(b.count, 1) }} data-testid="macro-block" data-side="today" data-kind="keep">
                      <span>{safeText(b.label)}</span>
                      <span className="hint">{b.count}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section aria-label={t('macro.proposed')}>
                <h3>{t('macro.proposed')}</h3>
                <div className="macro-blocks">
                  {prop.cut.map((b) => (
                    <div key={b.id} className="macro-block" style={{ flexGrow: Math.max(b.papers, 1) }} data-testid="macro-block" data-side="proposed" data-kind={b.kind}>
                      <span>{safeText(b.label)}</span>
                      <span className="hint">{b.papers}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <ul className="macro-moves" aria-label={t('macro.moves')}>
              {list.map((m) => {
                const on = !skipped.has(m.id);
                const kids = m.children.slice(0, 4).map((c) => safeText(c.label)).join(', ') + (m.children.length > 4 ? ' …' : '');
                return (
                  <li key={m.id} className="macro-move" data-testid="macro-move" data-move={m.kind} data-id={m.id} data-on={on}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => toggle(m)} />
                      <span>{m.kind === 'split' ? t('macro.split', { n: m.papers, total: total(m) }) : t('macro.gather', { n: m.papers })}</span>
                    </label>
                    <p className="hint" data-testid="macro-tree">
                      {m.kind === 'split'
                        ? t('macro.treeSplit', { name: safeText(m.label), kids, family: name })
                        : m.parent?.kind === 'pack'
                          ? t('macro.treeGatherPack', { name: safeText(m.label), kids })
                          : m.parent?.kind === 'existing'
                            ? t('macro.treeGatherExisting', { name: safeText(m.label), kids })
                            : t('macro.treeGather', { name: safeText(nameOf(m)), kids })}
                    </p>
                    {m.cooc && (
                      <p className="hint" data-testid="macro-cooc">
                        {t('macro.cooc')}
                      </p>
                    )}
                    {on && m.parent?.kind === 'provisional' && (
                      <label className="macro-name">
                        <span>{t('macro.nameLabel')}</span>
                        <input value={nameOf(m)} maxLength={200} autoFocus={m === ticked.find((x) => x.parent?.kind === 'provisional')} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setNames((cur) => ({ ...cur, [m.id]: e.target.value }))} data-testid="macro-name" />
                      </label>
                    )}
                    {on && m.pinsLost > 0 && (
                      <p className="hint" data-testid="macro-pins">
                        {t('macro.pins', { count: m.pinsLost, name: safeText(m.kind === 'split' ? m.label : (m.children[0]?.label ?? m.label)) })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="actions">
          <Button onClick={onClose} data-testid="macro-cancel">
            {t('common.cancel')}
          </Button>
          {!none && (
            <Button variant="primary" busy={busy} disabled={prop === null || ticked.length === 0 || lacking || stale} disabledReason={lacking ? t('macro.nameNeeded') : undefined} onClick={() => void apply()} data-testid="macro-apply">
              {t('macro.apply', { count: ticked.length })}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
