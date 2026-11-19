import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, GroupsOverview, ResponseOf } from '@rl/core';
import { AiCostPreview, costGate, costLabel, type CostEstimate } from '../../components/AiCostPreview';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconClaude } from '../../components/icons-shell';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { Markdown } from '../../lib/markdown';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';

type Estimate = ResponseOf<Channels, 'groups:estimate'>;
const token = () => Math.random().toString(36).slice(2, 12);

/**
 * The research-group overview on request (feature 12, §17.4.19): a Markdown note (authors, recurring co-authors, tags, main works
 * with links) from the library data, with the themes written by Claude (✦) when asked. It is saved in `notes/groups` and shown
 * again with its date; without Claude only the data is written ("sintesi non scritta").
 */
export function GroupsDialog({ docIds, onClose }: { docIds: string[]; onClose(): void }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const { info } = useNotify();
  const { openReader } = useReader();
  const models = config?.ai.models ?? [];
  const label = (id: string) => models.find((m) => m.id === id)?.label || id;
  const [overview, setOverview] = useState<GroupsOverview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [est, setEst] = useState<Estimate | null>(null);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [limit, setLimit] = useState(false);

  useEffect(() => {
    let live = true;
    rl.invoke('groups:get', { docIds }).then(
      (r) => live && (setOverview(r.overview), setLoaded(true)),
      (e: unknown) => live && (setError(e), setLoaded(true)),
    );
    return () => {
      live = false;
    };
  }, [docIds]);
  useEffect(() => {
    let live = true;
    rl.invoke('groups:estimate', { docIds, ...(model ? { model } : {}) }).then(
      (e) => live && setEst(e),
      () => live && setEst(null),
    );
    return () => {
      live = false;
    };
  }, [docIds, model]);

  const run = async (withClaude: boolean, confirmed: boolean) => {
    const tk = token();
    setBusy(tk);
    setError(null);
    setLimit(false);
    setDialog(false);
    try {
      const r = await rl.invoke('groups:run', { token: tk, docIds, withClaude, confirmed, ...(model ? { model } : {}) });
      setOverview(r.overview);
      info(t(r.overview.synthesis === 'written' ? 'groups.done' : 'groups.doneData'));
    } catch (e) {
      const code = RlError.from(e).code;
      if (code === 'AI_BUDGET_EXCEEDED') setLimit(true);
      else if (code !== 'CANCELLED') setError(e);
    } finally {
      setBusy(null);
    }
  };

  const click = () => {
    if (!est) return;
    const g = costGate(est);
    if (g === 'send') void run(true, false);
    else if (g === 'not-enabled') void run(false, false);
    else setDialog(true);
  };

  return (
    <Dialog title={t('groups.title')} onClose={onClose} testId="groups-dialog">
      <div className="dlg-scroll">
        <p className="hint">{t('groups.what', { count: docIds.length })}</p>
        {est && est.notEnabled > 0 && (
          <p className="hint" data-testid="groups-not-enabled">
            {t('groups.notEnabled', { count: est.notEnabled })}
          </p>
        )}
        {error !== null && <ErrorNote testId="groups-error">{errorMessage(error, t)}</ErrorNote>}
        {limit && (
          <p className="hint" role="status" data-testid="groups-limit">
            {t('groups.limit')}
          </p>
        )}
        {overview && (
          <section data-testid="groups-overview" data-synthesis={overview.synthesis} aria-label={t('groups.overview')}>
            <p className="hint" data-testid="groups-state">
              {t('groups.updated', { date: overview.updatedAt.slice(0, 10) })} · {overview.synthesis === 'written' ? t('groups.written') : t('groups.notWritten')}
            </p>
            <Markdown
              source={overview.markdown}
              linkHook={(href, text, key) => {
                const m = /^lab:\/\/doc\/([0-9a-f]{16})$/.exec(href);
                return m ? (
                  <button key={key} type="button" className="link" onClick={() => openReader(m[1]!)}>
                    {text}
                  </button>
                ) : null;
              }}
            />
          </section>
        )}
        {loaded && !overview && <p className="hint">{t('groups.none')}</p>}
      </div>
      <div className="actions dlg-foot">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <Button variant="secondary" disabled={busy !== null || !est} busy={busy !== null} onClick={() => void run(false, false)} data-testid="groups-data-only">
          {t('groups.dataOnly')}
        </Button>
        <Button variant="primary" icon={<IconClaude size={16} />} disabled={busy !== null || !est || !est.folderEnabled} disabledReason={t('groups.noFolder')} busy={busy !== null} onClick={click} data-testid="groups-run">
          {costLabel(t, overview ? t('groups.update') : t('groups.write'), est as CostEstimate | null, est ? label(est.model) : '')}
        </Button>
      </div>
      {dialog && est && (
        <AiCostPreview what={t('groups.sendWhat', { count: docIds.length - est.notEnabled })} requests={1} estimate={est as CostEstimate} modelLabel={label(est.model)} models={models} model={model || est.model} onModel={setModel} onConfirm={() => void run(true, true)} onCancel={() => setDialog(false)} />
      )}
    </Dialog>
  );
}
