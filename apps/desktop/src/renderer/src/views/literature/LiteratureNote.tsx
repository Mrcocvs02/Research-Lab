import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LITERATURE_MAX_DOCS, type Channels, type ResponseOf } from '@rl/core';
import { AiCostPreview, type CostEstimate } from '../../components/AiCostPreview';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { IconMore } from '../../components/icons';
import { Lazy, lazyView } from '../../components/Lazy';
import { Menu, type MenuGroups } from '../../components/Menu';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import './literature.css';

// The note is shown with the same preview as the notes (formulas, links by identifier); loaded when a note is opened.
const NotePreview = lazyView(() => import('../notes/NoteRich').then((m) => ({ default: m.NotePreview })), ['notes']);

type Get = ResponseOf<Channels, 'literature:get'>;
type Estimate = ResponseOf<Channels, 'literature:estimate'>;

/** Model labels and the default model of the library, for the cost dialog. */
function useModels() {
  const { config } = useApp();
  const models = config?.ai.models ?? [];
  const [model, setModel] = useState(config?.ai.defaultModel ?? models[0]?.id ?? '');
  return { models, model, setModel, label: (id: string) => models.find((m) => m.id === id)?.label || id };
}

/**
 * The literature note of a document (feature 2, §17.4.6), in the Notes section of the card and in the Literature tab of the
 * reader. One row: none (with "Write the literature note ✦"), writing, "Draft ✦ to approve" (border `--ai`, Approve button),
 * approved, a folder not enabled (the note would be made only from the title and the abstract, and says so), or an error with
 * Retry. The AI text lives in its own file and is never mixed with the user's notes.
 */
export function LiteratureRow({ docId, open: startOpen = false }: { docId: string; open?: boolean }) {
  const { t, i18n } = useTranslation();
  const version = useChangeVersion('notes');
  const { reportError } = useNotify();
  const { openSettings } = useAiUi();
  const { models, model, setModel, label } = useModels();
  const [data, setData] = useState<Get | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    rl.invoke('literature:get', { docId }).then(
      (r) => alive.current && setData(r),
      (e: unknown) => alive.current && setError(e),
    );
  }, [docId, version]);

  const execute = useCallback(
    async (regenerate: boolean, m: string) => {
      setBusy(true);
      setError(null);
      setEst(null);
      try {
        await rl.invoke('literature:run', { docId, confirmed: true, regenerate, ...(m ? { model: m } : {}) });
        const r = await rl.invoke('literature:get', { docId });
        if (alive.current) setData(r);
      } catch (e) {
        if (alive.current) setError(e);
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [docId],
  );

  /** The rule of cost: what a note sends is always shown first (D-416); with nothing to send it goes straight on. */
  const start = useCallback(
    async (regenerate: boolean, m: string) => {
      setError(null);
      try {
        const e = await rl.invoke('literature:estimate', { docIds: [docId], ...(m ? { model: m } : {}) });
        if (!alive.current) return;
        if (e.needsDialog || e.overDailyCap) setEst(e);
        else await execute(regenerate, m);
      } catch (e) {
        if (alive.current) setError(e);
      }
    },
    [docId, execute],
  );
  const regen = useRef(false);

  const approve = () => void rl.invoke('literature:approve', { docId }).catch(reportError);
  const discard = () => void rl.invoke('literature:discard', { docId }).catch(reportError);
  const note = data?.note ?? null;
  const date = note?.generatedAt ? new Date(note.generatedAt).toLocaleDateString(i18n.language) : '';
  const meta = note ? [note.model ? label(note.model) : '', date].filter(Boolean).join(' · ') : '';
  const draft = note?.review === 'proposed';

  const menuGroups: MenuGroups = [
    {
      id: 'lit',
      items: [
        { id: 'regen', label: t('literature.regenerate'), testId: 'lit-regenerate', onSelect: () => ((regen.current = true), void start(true, model)) },
        { id: 'discard', label: t('literature.discard'), danger: true, testId: 'lit-discard', onSelect: discard },
      ],
    },
  ];

  if (data === null && error === null) return null;
  return (
    <div className={`lit-row${draft ? ' lit-row--draft' : ''}`} data-testid="lit-row" data-state={busy ? 'writing' : note ? (draft ? 'draft' : 'approved') : 'none'}>
      {!note && !busy && (
        <div className="lit-row__none">
          {data && !data.folderEnabled ? (
            <div className="callout" data-testid="lit-not-enabled">
              <p>{t('literature.notEnabled')}</p>
              <div className="lit-row__actions">
                <button type="button" onClick={() => void execute(false, '')} data-testid="lit-write-poor">
                  {t('literature.writePoor')}
                </button>
                <button type="button" onClick={openSettings} data-testid="lit-enable">
                  {t('literature.enable')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="lit-write" onClick={() => void start(false, model)} data-testid="lit-write">
              {t('literature.write')}
            </button>
          )}
        </div>
      )}
      {busy && (
        <p className="hint" role="status" data-testid="lit-writing">
          {t('literature.writing')}
        </p>
      )}
      {note && !busy && (
        <>
          <div className="lit-row__head">
            <span className="lit-row__title">
              {note.ai ? '✦ ' : ''}
              {t('literature.title')}
            </span>
            {meta && <span className="hint">{meta}</span>}
            {draft ? (
              <span className="lit-badge lit-badge--draft" data-testid="lit-draft">
                {t('literature.draft')}
              </span>
            ) : (
              <span className="hint" data-testid="lit-approved">
                {t('literature.approved')}
              </span>
            )}
            <span className="spacer" />
            {draft && (
              <button type="button" className="primary" onClick={approve} data-testid="lit-approve">
                {t('literature.approve')}
              </button>
            )}
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="lit-open">
              {open ? t('literature.close') : t('literature.open')}
            </button>
            <span ref={anchor}>
              <IconButton label={t('literature.more')} size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} data-testid="lit-more">
                <IconMore size={16} />
              </IconButton>
            </span>
            <Menu anchor={anchor} open={menu} onClose={() => setMenu(false)} groups={menuGroups} label={t('literature.more')} width={220} />
          </div>
          {note.abstractOnly && (
            <p className="hint" data-testid="lit-poor">
              {t('literature.poor')}
            </p>
          )}
          {open && (
            <div className="lit-row__body" data-testid="lit-body">
              <Lazy>
                <NotePreview source={note.body} />
              </Lazy>
            </div>
          )}
        </>
      )}
      {error !== null && (
        <p className="field-error" role="alert" data-testid="lit-error">
          {RlError.from(error).code === 'AI_BUDGET_EXCEEDED' ? t('literature.capReached') : errorMessage(error, t)}{' '}
          <button type="button" onClick={() => void start(regen.current, model)} data-testid="lit-retry">
            {t('literature.retry')}
          </button>
        </p>
      )}
      {est && (
        <AiCostPreview
          what={t('literature.what')}
          requests={Math.max(1, est.sent)}
          estimate={est as CostEstimate}
          modelLabel={label(est.model)}
          models={models}
          model={model}
          onModel={(m) => {
            setModel(m);
            void start(regen.current, m);
          }}
          onConfirm={() => void execute(regen.current, model)}
          onCancel={() => setEst(null)}
        />
      )}
    </div>
  );
}

type Phase = 'estimating' | 'ask' | 'running' | 'done' | 'error';
type Status = 'waiting' | 'writing' | 'done' | 'skipped' | 'failed';

/**
 * "✦ Claude › Write the literature notes…" for the selection (§17.4.6): at most five papers per send (D-418), the cost
 * preview first, then one paper at a time, in a queue that can be cancelled (the paper being written finishes). A paper in a
 * folder that is not enabled sends nothing: its note is made on this machine from the title and the abstract.
 */
export function LiteratureDialog({ docIds, onClose }: { docIds: string[]; onClose(): void }) {
  const { t } = useTranslation();
  const { models, model, setModel, label } = useModels();
  const ids = docIds.slice(0, LITERATURE_MAX_DOCS);
  const [phase, setPhase] = useState<Phase>('estimating');
  const [est, setEst] = useState<Estimate | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const cancelled = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void rl.invoke('links:titles', { docIds: ids, projectIds: [] }).then((r) => alive.current && setTitles(r.docs), () => {});
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estimate = useCallback(
    async (m: string) => {
      setPhase('estimating');
      try {
        const e = await rl.invoke('literature:estimate', { docIds: ids, ...(m ? { model: m } : {}) });
        if (!alive.current) return;
        setEst(e);
        setPhase('ask');
      } catch (e) {
        if (!alive.current) return;
        setError(e);
        setPhase('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    void estimate(model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setPhase('running');
    setStatus(Object.fromEntries(ids.map((id) => [id, 'waiting' as Status])));
    for (const id of ids) {
      if (cancelled.current || !alive.current) break;
      setStatus((s) => ({ ...s, [id]: 'writing' }));
      try {
        // A paper that already has a note is left as it is (nothing is sent twice); "Regenerate" is on the note itself.
        const r = await rl.invoke('literature:run', { docId: id, confirmed: true, regenerate: false, ...(model ? { model } : {}) });
        if (alive.current) setStatus((s) => ({ ...s, [id]: r.cached && !r.note.abstractOnly && r.note.review === 'approved' ? 'skipped' : 'done' }));
      } catch (e) {
        if (!alive.current) return;
        setStatus((s) => ({ ...s, [id]: 'failed' }));
        // The daily cap or a missing account stops the queue: the next papers would fail the same way.
        if (['AI_BUDGET_EXCEEDED', 'AI_PROVIDER_ERROR'].includes(RlError.from(e).code)) {
          setError(e);
          setPhase('error');
          return;
        }
      }
    }
    if (alive.current) setPhase('done');
  };

  const what = [
    t('literature.dialogWhat', { count: ids.length }),
    docIds.length > ids.length ? t('literature.dialogCapped', { max: LITERATURE_MAX_DOCS, total: docIds.length }) : '',
    est && est.abstractOnly > 0 ? t('literature.dialogPoor', { count: est.abstractOnly }) : '',
    est && est.cachedDocs > 0 ? t('literature.dialogCached', { count: est.cachedDocs }) : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Nothing to send (every paper is in a folder not enabled, or already answered): a plain confirmation, no cost dialog.
  if (phase === 'ask' && est && !est.needsDialog && !est.overDailyCap)
    return (
      <Dialog title={t('literature.dialogTitle')} onClose={onClose} testId="lit-dialog">
        <div className="dlg-scroll">
          <p>{what}</p>
          <p className="hint">{t('literature.nothingSent')}</p>
        </div>
        <div className="actions dlg-foot">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={() => void run()} data-testid="lit-start">
            {t('literature.dialogStart')}
          </button>
        </div>
      </Dialog>
    );
  if (phase === 'ask' && est)
    return (
      <AiCostPreview
        what={what}
        requests={Math.max(1, est.sent)}
        estimate={est as CostEstimate}
        modelLabel={label(est.model)}
        models={models}
        model={model}
        onModel={(m) => {
          setModel(m);
          void estimate(m);
        }}
        onConfirm={() => void run()}
        onCancel={onClose}
      />
    );
  return (
    <Dialog title={t('literature.dialogTitle')} onClose={onClose} testId="lit-dialog">
      <div className="dlg-scroll">
        {phase === 'estimating' && <p className="hint">{t('common.loading')}</p>}
        {phase === 'error' && (
          <p className="field-error" role="alert" data-testid="lit-dialog-error">
            {RlError.from(error).code === 'AI_BUDGET_EXCEEDED' ? t('literature.capReached') : errorMessage(error, t)}
          </p>
        )}
        {(phase === 'running' || phase === 'done' || (phase === 'error' && Object.keys(status).length > 0)) && (
          <ul className="lit-queue" data-testid="lit-queue">
            {ids.map((id) => (
              <li key={id} data-status={status[id] ?? 'waiting'}>
                <span>{safeText(titles[id] ?? id)}</span>
                <span className="hint">{t(`literature.status_${status[id] ?? 'waiting'}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="actions dlg-foot">
        {phase === 'running' ? (
          <button type="button" onClick={() => (cancelled.current = true)} data-testid="lit-cancel">
            {t('literature.cancelQueue')}
          </button>
        ) : (
          <button type="button" className="primary" onClick={onClose} data-testid="lit-close">
            {t('common.close')}
          </button>
        )}
      </div>
    </Dialog>
  );
}
