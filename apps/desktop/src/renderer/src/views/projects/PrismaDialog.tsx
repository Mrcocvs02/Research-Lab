import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrismaCounts, PrismaState } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { layoutPrisma, toMarkdown, toSvg, REASONS, type Labels } from './prismaModel';
import './prisma.css';

const KNOWN_SOURCES = ['openalex-cited', 'openalex-citing'];

function Num({ label, value, onChange, testId }: { label: string; value: number; onChange(n: number): void; testId: string }) {
  return (
    <label className="prisma-num">
      <span>{label}</span>
      <input type="number" min={0} max={10_000_000} step={1} value={value} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} data-testid={testId} />
    </label>
  );
}

/**
 * "Diagramma PRISMA…" (D-439): the PRISMA 2020 flow of the project, drawn from the counts the app keeps while the bibliography is
 * extended (found per source, duplicates, screened, rejected with reasons, imported). The steps done outside the app are typed
 * here. Exported as SVG (with its own light and dark colours) or as a Markdown table, to a new file in a folder the user chooses.
 */
export default function PrismaDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const [state, setState] = useState<PrismaState | null>(null);
  const [draft, setDraft] = useState<PrismaCounts | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState('');

  useEffect(() => {
    let live = true;
    rl.invoke('bib:prismaGet', { projectId }).then(
      (s) => live && (setState(s), setDraft(s.counts)),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [projectId]);

  const name = (code: string): string => (KNOWN_SOURCES.includes(code) ? t(`prisma.source.${code}`) : (REASONS as readonly string[]).includes(code) || code === 'other' ? t(`discover.reject.${code}`) : safeText(code));
  const L: Labels = useMemo(
    () => ({
      identification: t('prisma.identification'),
      screening: t('prisma.screening'),
      included: t('prisma.included'),
      identified: t('prisma.identified'),
      removedBefore: t('prisma.removedBefore'),
      duplicates: t('prisma.duplicates'),
      screened: t('prisma.screened'),
      excluded: t('prisma.excluded'),
      assessed: t('prisma.assessed'),
      excludedFull: t('prisma.excludedFull'),
      includedBox: t('prisma.includedBox'),
      sourceFallback: t('prisma.sourceFallback'),
    }),
    [t],
  );
  const counts = draft ?? state?.counts ?? null;
  const layout = useMemo(() => (counts && state ? layoutPrisma(counts, state.screeningReasons, L, name) : null), [counts, state, L]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft !== null && state !== null && JSON.stringify(draft) !== JSON.stringify(state.counts);
  const title = t('prisma.title', { name: safeText(projectName) });
  const set = (patch: Partial<PrismaCounts>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    try {
      const s = await rl.invoke('bib:prismaSet', { projectId, counts: draft });
      setState(s);
      setDraft(s.counts);
      info(t('prisma.saved'));
    } catch (e) {
      reportError(e);
    }
  };
  const exportAs = async (ext: 'svg' | 'md') => {
    if (!layout || !counts || !state) return;
    try {
      const picked = await rl.invoke('dialog:chooseFolder', { purpose: 'export-destination', title: t('secondBrain.destination.dialogTitle') });
      if (!picked) return;
      const text = ext === 'svg' ? toSvg(layout, title) : toMarkdown(counts, state.screeningReasons, L, title, name, t('prisma.step'), t('prisma.n'));
      const r = await rl.invoke('bib:saveText', { destination: picked.path, fileName: 'prisma', ext, text });
      info(t('prisma.exported', { file: r.file }));
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <Dialog title={title} onClose={onClose} testId="prisma-dialog">
      <div className="dlg-scroll prisma">
        {error ? <p className="field-error" role="alert">{errorMessage(error, t)}</p> : null}
        {!counts || !layout ? (
          !error && <p className="hint">{t('prisma.loading')}</p>
        ) : (
          <>
            <p className="hint">{state?.edited ? t('prisma.hintEdited') : t('prisma.hint')}</p>
            <svg className="prisma-svg" viewBox={`0 0 ${layout.w} ${layout.h}`} role="img" aria-label={title} data-testid="prisma-svg">
              {layout.arrows.map(([x1, y1, x2, y2], i) => (
                <g key={`a${i}`}>
                  <path className="prisma-ar" d={`M${x1} ${y1}L${x2} ${y2}`} />
                  <path className="prisma-ah" d={`M${x2} ${y2}l${x2 > x1 ? '-7 -4v8z' : '-4 -7h8z'}`} />
                </g>
              ))}
              {layout.boxes.map((b, i) => (
                <g key={`b${i}`} data-testid="prisma-box">
                  <rect className={b.head ? 'prisma-bh' : 'prisma-bx'} x={b.x} y={b.y} width={b.w} height={b.h} rx={4} />
                  {b.lines.map((line, j) => (
                    <text key={j} className="prisma-tx" x={b.x + 10} y={b.y + 20 + j * 18} fontWeight={j === 0 ? 600 : undefined}>
                      {line}
                    </text>
                  ))}
                </g>
              ))}
              {layout.phases.map((p) => (
                <text key={p.text} className="prisma-ph" transform={`translate(30 ${p.y}) rotate(-90)`} textAnchor="middle">
                  {p.text}
                </text>
              ))}
            </svg>
            <details className="prisma-edit" data-testid="prisma-edit">
              <summary>{t('prisma.edit')}</summary>
              <p className="hint">{t('prisma.editHint')}</p>
              <fieldset>
                <legend>{t('prisma.identified')}</legend>
                {counts.identified.map((s, i) => (
                  <Num key={s.source} label={name(s.source)} value={s.count} testId="prisma-source" onChange={(n) => set({ identified: counts.identified.map((x, j) => (j === i ? { ...x, count: n } : x)) })} />
                ))}
                <form
                  className="prisma-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const s = adding.trim();
                    if (s && !counts.identified.some((x) => x.source === s)) set({ identified: [...counts.identified, { source: s.slice(0, 80), count: 0 }] });
                    setAdding('');
                  }}
                >
                  <input aria-label={t('prisma.addSource')} placeholder={t('prisma.addSource')} value={adding} maxLength={80} onChange={(e) => setAdding(e.target.value)} data-testid="prisma-add-source" />
                  <Button type="submit" size="sm" disabled={!adding.trim()}>
                    {t('prisma.add')}
                  </Button>
                </form>
              </fieldset>
              <Num label={t('prisma.duplicates')} value={counts.duplicates} onChange={(n) => set({ duplicates: n })} testId="prisma-duplicates" />
              <Num label={t('prisma.screened')} value={counts.screened} onChange={(n) => set({ screened: n })} testId="prisma-screened" />
              <Num label={t('prisma.excluded')} value={counts.excludedScreening} onChange={(n) => set({ excludedScreening: n })} testId="prisma-excluded" />
              <Num label={t('prisma.assessed')} value={counts.assessed} onChange={(n) => set({ assessed: n })} testId="prisma-assessed" />
              <fieldset>
                <legend>{t('prisma.excludedFull')}</legend>
                {counts.excludedFull.map((r, i) => (
                  <div key={i} className="prisma-reason">
                    <input aria-label={t('prisma.reasonText')} value={r.reason} maxLength={200} onChange={(e) => set({ excludedFull: counts.excludedFull.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)) })} data-testid="prisma-full-reason" />
                    <input type="number" min={0} aria-label={t('prisma.n')} value={r.count} onChange={(e) => set({ excludedFull: counts.excludedFull.map((x, j) => (j === i ? { ...x, count: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)) })} data-testid="prisma-full-count" />
                    <Button size="sm" onClick={() => set({ excludedFull: counts.excludedFull.filter((_, j) => j !== i) })}>
                      {t('common.remove')}
                    </Button>
                  </div>
                ))}
                <Button size="sm" onClick={() => set({ excludedFull: [...counts.excludedFull, { reason: t('discover.reject.other'), count: 0 }] })} data-testid="prisma-add-reason">
                  {t('prisma.addReason')}
                </Button>
              </fieldset>
              <Num label={t('prisma.includedBox')} value={counts.included} onChange={(n) => set({ included: n })} testId="prisma-included" />
            </details>
          </>
        )}
      </div>
      <div className="actions dlg-foot">
        {dirty && (
          <Button variant="primary" onClick={() => void save()} data-testid="prisma-save">
            {t('prisma.save')}
          </Button>
        )}
        <Button onClick={() => void exportAs('svg')} disabled={!layout} data-testid="prisma-export-svg">
          {t('prisma.exportSvg')}
        </Button>
        <Button onClick={() => void exportAs('md')} disabled={!layout} data-testid="prisma-export-md">
          {t('prisma.exportMd')}
        </Button>
        <Button onClick={onClose} data-testid="prisma-close">
          {t('common.close')}
        </Button>
      </div>
    </Dialog>
  );
}
