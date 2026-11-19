import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { AiCostPreview, costGate, type CostEstimate } from '../../components/AiCostPreview';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { Floating, type Anchor } from './AnnotationPopover';
import './reader-tools.css';

/** What "✦ Spiega" explains: the passage (selection or crop text) and the paragraph around it. */
export interface ExplainRequest {
  page: number;
  text: string;
  around: string;
  /** Where it comes from: the selection of the text, or a crop (the caption and the text in it). */
  from: 'selection' | 'crop';
}

type Run = ResponseOf<Channels, 'explain:run'>;
type Phase = 'estimating' | 'dialog' | 'loading' | 'ready' | 'error' | 'notEnabled';

/**
 * The card of "✦ Spiega" (§17.4.9): anchored under the passage, with "What it says", "Symbols" and "In the paper". Everything
 * on it is marked ✦ with the model and the date; it becomes the user's text only through "Add to the notes" (D-417). The rule
 * of cost (D-416) decides what a request does: send at once under the threshold, the `AiCostPreview` dialog above it or the
 * first time the text of a folder is sent, a refusal past the day's cap; a folder that is not enabled sends nothing.
 */
export function ExplainCard({ docId, request, anchor, onClose }: { docId: string; request: ExplainRequest; anchor: () => Anchor | null; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const { config } = useApp();
  const { info, reportError } = useNotify();
  const { openSettings } = useAiUi();
  const models = config?.ai.models ?? [];
  const [model, setModel] = useState(config?.ai.defaultModel ?? models[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>('estimating');
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [out, setOut] = useState<Run | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [detail, setDetail] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const body = (d: boolean, m: string) => ({ docId, page: request.page, text: request.text, around: request.around, detail: d, ...(m ? { model: m } : {}) });

  const send = useCallback(
    async (d: boolean, m: string) => {
      setPhase('loading');
      try {
        const r = await rl.invoke('explain:run', { ...body(d, m), confirmed: true });
        if (!alive.current) return;
        setOut(r);
        setPhase('ready');
      } catch (e) {
        if (!alive.current) return;
        const err = RlError.from(e);
        if (err.code === 'FOLDER_NOT_AI_ENABLED') setPhase('notEnabled');
        else {
          setError(e);
          setPhase('error');
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, request],
  );

  /** Asks main what the request would cost, then applies the rule: send, ask, or stop. */
  const start = useCallback(
    async (d: boolean, m: string) => {
      setPhase('estimating');
      setDetail(d);
      try {
        const e = await rl.invoke('explain:estimate', body(d, m));
        if (!alive.current) return;
        setEst(e);
        const gate = costGate(e);
        if (gate === 'not-enabled') setPhase('notEnabled');
        else if (gate === 'dialog' || gate === 'cap') setPhase('dialog');
        else await send(d, m);
      } catch (e) {
        if (!alive.current) return;
        setError(e);
        setPhase('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, request, send],
  );
  useEffect(() => {
    void start(false, model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = out ? new Date(out.at).toLocaleDateString(i18n.language) : '';
  const meta = out ? t('reader.explain.model', { model: label(out.model), date }) : '';
  const text = out
    ? [`${t('reader.explain.means')}: ${out.result.means}`, ...(out.result.symbols.length > 0 ? [`${t('reader.explain.symbols')}: ${out.result.symbols.map((s) => `${s.symbol} = ${s.meaning}`).join(', ')}`] : []), `${t('reader.explain.role')}: ${out.result.role}`].join('\n')
    : '';

  const addToNotes = async () => {
    if (!out) return;
    try {
      const cur = await rl.invoke('notes:get', { docId, page: request.page });
      const block = [`> ${t('reader.explain.block', { model: label(out.model), date })}`, '>', ...text.split('\n').map((l) => `> ${l}`)].join('\n');
      const prev = cur.note?.body ?? '';
      await rl.invoke('notes:save', { docId, page: request.page, body: prev.trim() === '' ? block : `${prev.replace(/\s+$/, '')}\n\n${block}`, expectedUpdatedAt: cur.note?.updatedAt ?? null });
      info(t('reader.explain.added', { page: request.page }));
    } catch (e) {
      reportError(e);
    }
  };
  const copy = () => void navigator.clipboard?.writeText(text).then(() => info(t('reader.explain.copied')), reportError);

  return (
    <>
      <Floating anchor={anchor} label={t('reader.explain.title')} testId="explain-card" mode={phase} className="explain-card">
        <div className="explain-card__head">
          <strong>{t('reader.explain.title')}</strong>
          <span className="hint" data-testid="explain-meta">
            {out ? meta : label(model)}
          </span>
          <button type="button" className="explain-card__x" aria-label={t('reader.explain.close')} onMouseDown={(e) => e.preventDefault()} onClick={onClose} data-testid="explain-close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {(phase === 'estimating' || phase === 'loading') && (
          <div className="explain-card__skeleton" role="status" aria-label={t('reader.explain.loading')} data-testid="explain-loading">
            <span />
            <span />
            <span />
          </div>
        )}
        {phase === 'dialog' && <p className="hint">{t('reader.explain.loading')}</p>}
        {phase === 'notEnabled' && (
          <div className="callout" data-testid="explain-not-enabled">
            <p>{t('reader.explain.notEnabled')}</p>
            <button type="button" onClick={() => (onClose(), openSettings())} data-testid="explain-enable">
              {t('reader.explain.enable')}
            </button>
          </div>
        )}
        {phase === 'error' && (
          <p className="field-error" role="alert" data-testid="explain-error">
            {RlError.from(error).code === 'AI_BUDGET_EXCEEDED' ? t('reader.explain.capReached') : errorMessage(error, t)}
          </p>
        )}
        {phase === 'ready' && out && (
          <div className="explain-card__body" data-testid="explain-result" data-cached={out.cached ? 'true' : undefined}>
            <p data-testid="explain-means">
              <strong>{t('reader.explain.means')}:</strong> {safeText(out.result.means)}
            </p>
            {out.result.symbols.length > 0 && (
              <p data-testid="explain-symbols">
                <strong>{t('reader.explain.symbols')}:</strong> {out.result.symbols.map((s) => `${safeText(s.symbol)} = ${safeText(s.meaning)}`).join(', ')}
              </p>
            )}
            <p data-testid="explain-role">
              <strong>{t('reader.explain.role')}:</strong> {safeText(out.result.role)}
            </p>
            {out.cached && <p className="hint">{t('reader.explain.cached')}</p>}
            <div className="ann-pop__row">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={copy} data-testid="explain-copy">
                {t('reader.explain.copy')}
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void addToNotes()} data-testid="explain-add-notes">
                {t('reader.explain.addToNotes')}
              </button>
              <button type="button" disabled={detail} onMouseDown={(e) => e.preventDefault()} onClick={() => void start(true, model)} data-testid="explain-more">
                {t('reader.explain.more')}
              </button>
            </div>
          </div>
        )}
      </Floating>
      {phase === 'dialog' && est && (
        <AiCostPreview
          title={t('reader.explain.title')}
          what={t(request.from === 'crop' ? 'reader.explain.whatCrop' : 'reader.explain.whatSelection')}
          requests={1}
          estimate={est}
          modelLabel={label(est.model)}
          models={models}
          model={model}
          onModel={(m) => {
            setModel(m);
            void start(detail, m);
          }}
          onConfirm={() => void send(detail, model)}
          onCancel={onClose}
        />
      )}
    </>
  );
}
