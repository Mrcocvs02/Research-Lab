import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Channels, GuidePassage, ResponseOf } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import type { Viewer } from './engine';
import type { Rect } from './geometry';
import { barSpan, GUIDE_MAX_MARKS, loadKept, noteRects, saveKept, type Placed } from './guide';
import './guide.css';

type Guide = ResponseOf<Channels, 'guides:get'>;
const KINDS = { C: 'contribution', M: 'method', R: 'result', L: 'limit' } as const;

/**
 * The guide layer (experiment 30, D-425, §17.4.21). It exists only while Settings › Advanced › Experimental features is on and
 * the guide is switched on (⋯ or G). It never touches the text: a thin bar with a letter in the margin of the page, a light
 * veil on the passage only under the pointer or the focus, the list in the Annotations panel. It never sends anything by
 * itself: a paper with no guide shows one line with "Prepare" and the cost, and the send goes only after the dialog.
 */
export function GuideMargin({
  docId,
  layers,
  viewer,
  ready,
  listHost,
  onKeep,
  onOff,
}: {
  docId: string;
  layers: ReadonlyMap<number, HTMLElement>;
  viewer: Viewer | null;
  ready: boolean;
  listHost: HTMLElement | null;
  /** The passage becomes a highlight of the user in the current colour; resolves to `true` when it was saved. */
  onKeep(page: number, rects: Rect[], text: string): Promise<boolean>;
  onOff(): void;
}) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [placed, setPlaced] = useState<ReadonlyMap<string, Placed>>(new Map());
  const [kept, setKept] = useState<ReadonlySet<string>>(() => loadKept(docId));
  const [hot, setHot] = useState<string | null>(null);
  const finding = useRef(new Set<string>());

  // What is there without any send: the cache or the literature note.
  useEffect(() => {
    let alive = true;
    setGuide(null);
    setFailed(false);
    rl.invoke('guides:get', { docId }).then(
      (g) => alive && setGuide(g),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [docId]);

  const passages: GuidePassage[] = (guide?.passages ?? []).filter((p) => !kept.has(p.id)).slice(0, GUIDE_MAX_MARKS);

  // Place each passage on its page once the page is drawn (the sentence is found in the text layer; a note passage sits at the top).
  useEffect(() => {
    if (!ready || !viewer) return;
    for (const p of passages) {
      if (placed.has(p.id) || finding.current.has(p.id) || !layers.has(p.page)) continue;
      if (p.quote === null) {
        setPlaced((m) => new Map(m).set(p.id, { passage: p, rects: noteRects() }));
        continue;
      }
      finding.current.add(p.id);
      void viewer.locateText(p.page, p.quote, 0.5, 0.02).then((r) => {
        finding.current.delete(p.id);
        if (r.status === 'found') setPlaced((m) => new Map(m).set(p.id, { passage: p, rects: r.rects }));
      });
    }
  });

  const prepare = useCallback(async () => {
    setAsking(false);
    setWorking(true);
    try {
      await rl.invoke('guides:prepare', { docId, confirmed: true });
      setGuide(await rl.invoke('guides:get', { docId }));
    } catch (e) {
      reportError(e);
    } finally {
      setWorking(false);
    }
  }, [docId, reportError]);

  const keep = async (pl: Placed) => {
    const text = pl.passage.quote ?? '';
    if (!(await onKeep(pl.passage.page, pl.rects, text))) return;
    const next = new Set(kept).add(pl.passage.id);
    setKept(next);
    saveKept(docId, next);
  };
  const go = (pl: Placed | undefined, p: GuidePassage) => viewer?.goTo(p.page, pl ? barSpan(pl.rects).top : undefined);
  const name = (k: GuidePassage['kind']) => t(`reader.guide.kinds.${KINDS[k]}`);

  const row = failed
    ? t('reader.guide.failed')
    : working
      ? t('reader.guide.working')
      : guide?.state === 'disabled'
        ? t('reader.guide.disabled')
        : guide?.state === 'ready' && passages.length === 0 && guide.passages.length === 0
          ? t('reader.guide.none')
          : null;

  return (
    <>
      {guide?.state === 'none' && !working && (
        <p className="guide-row" role="status" data-testid="guide-row" data-state="none">
          {t('reader.guide.notPrepared')} ·{' '}
          <button type="button" className="link" onClick={() => setAsking(true)} data-testid="guide-prepare">
            {t('reader.guide.prepare', { tokens: guide.approxTokens.toLocaleString() })}
          </button>
        </p>
      )}
      {row && (
        <p className="guide-row" role="status" data-testid="guide-row" data-state={failed ? 'error' : working ? 'working' : guide?.state}>
          {row}
        </p>
      )}
      {[...placed.values()]
        .filter((pl) => !kept.has(pl.passage.id))
        .map((pl) => {
          const host = layers.get(pl.passage.page)?.parentElement;
          if (!host || !host.isConnected) return null;
          const { top, height } = barSpan(pl.rects);
          return createPortal(
            <>
              <button
                key={`m-${pl.passage.id}`}
                type="button"
                className="guide-mark"
                style={{ top: `${top * 100}%`, height: `${height * 100}%` }}
                aria-label={t('reader.guide.markLabel', { kind: name(pl.passage.kind) })}
                title={safeText(pl.passage.reason) ? `${name(pl.passage.kind)}: ${safeText(pl.passage.reason)}` : name(pl.passage.kind)}
                onMouseEnter={() => setHot(pl.passage.id)}
                onMouseLeave={() => setHot(null)}
                onFocus={() => setHot(pl.passage.id)}
                onBlur={() => setHot(null)}
                data-testid="guide-mark"
                data-kind={pl.passage.kind}
              >
                <span className="guide-mark__bar" aria-hidden="true" />
                <span className="guide-mark__k" aria-hidden="true">
                  {pl.passage.kind}
                </span>
              </button>
              {hot === pl.passage.id && pl.passage.quote !== null &&
                pl.rects.map((r, i) => <span key={`v-${pl.passage.id}-${i}`} className="guide-veil" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} data-testid="guide-veil" />)}
            </>,
            host,
            `guide-${pl.passage.id}`,
          );
        })}
      {listHost &&
        createPortal(
          <section className="guide-list" aria-label={t('reader.guide.title')} data-testid="guide-list">
            <header className="guide-list__head">
              <button type="button" className="guide-chip" onClick={onOff} aria-label={t('reader.guide.off')} title={t('reader.guide.off')} data-testid="guide-chip">
                {t('reader.guide.title')} ×
              </button>
            </header>
            <ul>
              {passages.map((p) => {
                const pl = placed.get(p.id);
                return (
                  <li key={p.id} data-testid="guide-item">
                    <button type="button" className="guide-list__go" onClick={() => go(pl, p)} onFocus={() => setHot(p.id)} onBlur={() => setHot(null)}>
                      <b aria-hidden="true">{p.kind}</b> <span className="sr-only">{name(p.kind)}</span> {t('reader.guide.page', { page: p.page })} · {safeText(p.reason)}
                    </button>
                    {pl && pl.passage.quote !== null && (
                      <button type="button" className="link" onClick={() => void keep(pl)} data-testid="guide-keep">
                        {t('reader.guide.keep')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>,
          listHost,
        )}
      {asking && (
        <Dialog title={t('reader.guide.askTitle')} onClose={() => setAsking(false)} testId="guide-dialog">
          <div className="guide-dialog">
            <p>{t('reader.guide.askBody', { tokens: (guide?.approxTokens ?? 0).toLocaleString() })}</p>
            <div className="guide-dialog__actions">
              <button type="button" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="primary" onClick={() => void prepare()} data-testid="guide-confirm">
                {t('reader.guide.go')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
