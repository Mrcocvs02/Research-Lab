import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Channels, DiscoverCandidate, DiscoverKind, DiscoverReason, DiscoverRun, DiscoverRunSummary, ResponseOf } from '@rl/core';
import { AiCostPreview, costGate, costLabel, type CostEstimate } from '../../components/AiCostPreview';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { IconDiscover } from '../../components/icons-shell';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { useNav } from '../../lib/nav';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { WorkRow } from '../citations/WorkRow';
import { safeText } from '../library/safeText';
import { bridgePath, strengthDots } from '../network/BridgePath';
import { setMapBridge } from '../network/bridgeIntent';
import '../citations/citations.css';
import './discover.css';

type Estimate = ResponseOf<Channels, 'discover:estimate'>;
type Count = 10 | 20 | 50;
const COUNTS: Count[] = [10, 20, 50];

/** What starts a search: the kind, the question, or the documents (and projects) of each side. */
export interface Launch {
  nonce: number;
  kind: DiscoverKind;
  query?: string;
  a?: { docIds: string[]; projectId?: string };
  b?: { docIds: string[]; projectId?: string };
}

/** One line for the reasons of a candidate, in the language of the interface ("cited by 4 of your 12 documents · cites 3 of them"). */
export const reasonText = (t: TFunction, reasons: readonly DiscoverReason[]): string => reasons.map((r) => t(`discover.searches.reason_${r.code}`, { n: r.n, of: r.of ?? 0 })).join(' · ');

const token = () => Math.random().toString(36).slice(2, 12);
const names = (side: ReadonlyArray<{ title: string }> | undefined) => (side ?? []).map((d) => safeText(d.title)).join(' · ');

function Summary({ c }: { c: DiscoverCandidate }) {
  const { t } = useTranslation();
  if (!c.summary) return null;
  const s = c.summary;
  return (
    <dl className="proposal-grid" data-testid="run-summary">
      {(['problem', 'method', 'results', 'data', 'limits'] as const).map((k) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{t(`discover.searches.sum_${k}`)}</dt>
          <dd>{s[k] === '' ? <span className="hint">{t('discover.searches.notStated')}</span> : safeText(s[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The "✦ Sintesi" row of a search: 10 / 20 / 50 with the estimate in the button, the dialog over the threshold or the day's cap. */
function SummaryBar({ run, onRun }: { run: DiscoverRun; onRun(r: DiscoverRun): void }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const { info, reportError } = useNotify();
  const models = config?.ai.models ?? [];
  const [count, setCount] = useState<Count>(10);
  const [model, setModel] = useState('');
  const [est, setEst] = useState<Estimate | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState(false);
  const label = (id: string) => models.find((m) => m.id === id)?.label || id;
  const sig = run.items.map((c) => c.state + (c.summary ? 's' : '')).join('');

  useEffect(() => {
    let live = true;
    rl.invoke('discover:estimate', { id: run.id, count, ...(model ? { model } : {}) }).then(
      (e) => live && setEst(e),
      () => live && setEst(null),
    );
    return () => {
      live = false;
    };
  }, [run.id, count, model, sig]);

  const go = async (confirmed: boolean) => {
    const tk = token();
    setBusy(tk);
    setLimit(false);
    setDialog(false);
    try {
      const r = await rl.invoke('discover:summarize', { token: tk, id: run.id, count, confirmed, ...(model ? { model } : {}) });
      onRun(r.run);
      info(t('discover.searches.sumDone', { written: r.written, cached: r.cached, none: r.noAbstract }));
    } catch (e) {
      const code = RlError.from(e).code;
      if (code === 'AI_BUDGET_EXCEEDED') setLimit(true);
      else if (code !== 'CANCELLED') reportError(e);
    } finally {
      setBusy(null);
    }
  };

  const click = () => {
    if (!est) return;
    const g = costGate(est);
    if (g === 'send') void go(false);
    else setDialog(true);
  };

  return (
    <div className="vbar" data-testid="run-sumbar">
      <span className="hint">{t('discover.searches.sumTitle')}</span>
      {COUNTS.map((n) => (
        <span key={n} data-testid={`run-sum-${n}`}>
          <Chip selected={count === n} onClick={() => setCount(n)}>
            {n}
          </Chip>
        </span>
      ))}
      <Button size="sm" variant="secondary" busy={busy !== null} disabled={busy !== null || !est} onClick={click} data-testid="run-sum-go">
        {costLabel(t, t('discover.searches.sumAction'), est, est ? label(est.model) : '')}
      </Button>
      {busy && (
        <button type="button" className="link" onClick={() => void rl.invoke('discover:cancel', { token: busy })} data-testid="run-sum-cancel">
          {t('discover.cancel')}
        </button>
      )}
      {limit && (
        <span className="hint" role="status" data-testid="run-sum-limit">
          {t('discover.searches.sumLater')}
        </span>
      )}
      {dialog && est && (
        <AiCostPreview
          title={t('discover.title')}
          what={t('discover.searches.sumWhat', { count })}
          requests={est.requests}
          estimate={est as CostEstimate}
          modelLabel={label(est.model)}
          models={models}
          model={model || est.model}
          onModel={setModel}
          onConfirm={() => void go(true)}
          onCancel={() => setDialog(false)}
        />
      )}
    </div>
  );
}

function Candidate({ run, c, onMark }: { run: DiscoverRun; c: DiscoverCandidate; onMark(key: string, state: DiscoverCandidate['state']): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const { invalidateAll } = useLibraryEvents();
  const nav = useNav();
  const bridge = run.kind === 'bridge';
  const idKind = c.doi ? 'doi' : c.arxivId ? 'arxiv' : null;
  const importIt = async () => {
    const id = c.doi ?? c.arxivId;
    if (!idKind || !id) return;
    try {
      // The record only: no file is downloaded (the user can add one from Arrivals later).
      await rl.invoke('importId:add', { entries: [{ kind: idKind, id }], downloadPdf: false });
      invalidateAll();
      onMark(c.key, 'imported');
      info(t('discover.searches.imported', { title: safeText(c.title ?? '') }));
    } catch (e) {
      reportError(e);
    }
  };
  const title = safeText(c.title ?? '');
  const [ea, eb] = [run.sides[0]?.[0], run.sides[1]?.[0]];
  // The path the Map draws (A, the bridge outside the library, B), also as a line of text.
  const path = bridge && ea && eb ? bridgePath(ea, { key: c.key, title: c.title }, eb) : null;
  return (
    <WorkRow testId="run-item" title={c.title} authors={c.authors} year={c.year} venue={c.venue} ids={{ doi: c.doi, arxivId: c.arxivId, externalId: c.key }}>
      {bridge ? (
        <span className="hint" role="img" aria-label={t('discover.searches.strength', { n: strengthDots(c.score) })} data-testid="run-strength">
          {'●'.repeat(strengthDots(c.score))}
          {'○'.repeat(4 - strengthDots(c.score))}
        </span>
      ) : (
        <span className="hint" data-testid="run-score">
          {t('discover.searches.score', { score: c.score.toFixed(2) })}
        </span>
      )}
      {path && (
        <span className="hint" data-testid="run-path">
          {t('discover.searches.path', { a: safeText(path.nodes[0].title), b: safeText(path.nodes[2].title) })}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMapBridge(path);
              nav.navigate({ view: 'map' });
            }}
            data-testid="run-show-on-map"
          >
            {t('discover.searches.showOnMap')}
          </button>
        </span>
      )}
      <span className="hint" data-testid="run-why">
        {reasonText(t, c.reasons)}
      </span>
      {c.fresh && (
        <Chip kind="status" tone="info">
          {t('discover.searches.fresh')}
        </Chip>
      )}
      <Summary c={c} />
      {c.state === 'imported' ? (
        <Chip kind="status" tone="success">
          {t('discover.searches.stateImported')}
        </Chip>
      ) : (
        <>
          <button type="button" className="link" aria-pressed={c.state === 'later'} onClick={() => onMark(c.key, c.state === 'later' ? 'new' : 'later')} aria-label={`${t('discover.searches.later')}: ${title}`} data-testid="run-later">
            {c.state === 'later' ? t('discover.searches.stateLater') : t('discover.searches.later')}
          </button>
          <button type="button" className="link" disabled={!idKind} title={idKind ? undefined : t('discover.searches.noId')} onClick={() => void importIt()} aria-label={`${t('discover.searches.import')}: ${title}`} data-testid="run-import">
            {t('discover.searches.import')}
          </button>
          <button type="button" className="link" onClick={() => onMark(c.key, 'dismissed')} aria-label={`${t('discover.dismiss')}: ${title}`} data-testid="run-dismiss">
            {t('discover.dismiss')}
          </button>
        </>
      )}
    </WorkRow>
  );
}

/** The body of a search: the states of §17.4.17 (no candidate, no convincing bridge, missing identifier, offline) or its list. */
function RunBody({ run, onRun }: { run: DiscoverRun; onRun(r: DiscoverRun): void }) {
  const { t } = useTranslation();
  const { openReader } = useReader();
  const [weak, setWeak] = useState(false);
  const bridge = run.kind === 'bridge';
  const mark = async (key: string, state: DiscoverCandidate['state']) => {
    onRun({ ...run, items: run.items.map((c) => (c.key === key ? { ...c, state } : c)) });
    // Transient answers (offline, missing identifier) were never saved: nothing to write.
    if (run.outcome === 'ok' || run.outcome === 'no-bridge') await rl.invoke('discover:mark', { id: run.id, key, state }).catch(() => undefined);
  };
  const shown = run.items.filter((c) => c.state !== 'dismissed' && (!bridge || weak || !c.weak));
  return (
    <div data-testid="run-body" data-outcome={run.outcome}>
      {bridge && (
        <h3 className="hint" data-testid="run-bridge-head">
          {t('discover.searches.bridgeHead', { a: names(run.sides[0]), b: names(run.sides[1]) })}
        </h3>
      )}
      {run.missing.map((d) => (
        <p key={d.docId} className="callout" data-testid="run-missing">
          {t('discover.searches.missingId', { title: safeText(d.title) })}{' '}
          <button type="button" className="link" onClick={() => openReader(d.docId)} data-testid="run-missing-open">
            {t('discover.searches.complete')}
          </button>
        </p>
      ))}
      {run.outcome === 'offline' && (
        <p className="callout" data-testid="run-offline">
          {t('discover.searches.offline')}
        </p>
      )}
      {run.local.length > 0 && (
        <p className="hint" data-testid="run-local">
          {t('discover.searches.local')}{' '}
          {run.local.map((d) => (
            <button key={d.docId} type="button" className="chip-button" onClick={() => openReader(d.docId)} data-testid="run-local-item">
              {safeText(d.title)}
            </button>
          ))}
        </p>
      )}
      {run.outcome === 'no-candidates' && (
        <p className="empty" data-testid="run-none">
          {bridge ? t('discover.searches.noCandidatesBridge') : t('discover.searches.noCandidates')}
        </p>
      )}
      {run.outcome === 'no-bridge' && (
        <div data-testid="run-nobridge">
          <p className="empty">
            <b>{t('discover.searches.noBridge')}</b> {t('discover.searches.noBridgeWhy')}
          </p>
          <button type="button" className="link" aria-pressed={weak} onClick={() => setWeak(!weak)} data-testid="run-weak-toggle">
            {weak ? t('discover.searches.hideWeak') : t('discover.searches.showWeak')}
          </button>
        </div>
      )}
      {run.outcome === 'ok' && bridge && run.items.some((c) => c.weak) && (
        <button type="button" className="link" aria-pressed={weak} onClick={() => setWeak(!weak)} data-testid="run-weak-toggle">
          {weak ? t('discover.searches.hideWeak') : t('discover.searches.showWeak')}
        </button>
      )}
      {!bridge && run.items.length > 0 && <SummaryBar run={run} onRun={onRun} />}
      {shown.length > 0 && (
        <ul className="work-list" aria-label={t('discover.searches.list')}>
          {shown.map((c) => (
            <Candidate key={c.key} run={run} c={c} onMark={(k, s) => void mark(k, s)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The "Searches" tab (§17.4.17): saved searches as openable rows, one list open at a time; starts the search a launch asks for. */
export function Searches({ launch, onCount, onStarted }: { launch: Launch | null; onCount(n: number): void; onStarted(): void }) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const [rows, setRows] = useState<DiscoverRunSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, DiscoverRun>>({});
  const [busy, setBusy] = useState<{ token: string; label: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [transient, setTransient] = useState<DiscoverRun | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DiscoverRun | null>(null);
  const started = useRef(-1);

  const reload = useCallback(async () => {
    const r = await rl.invoke('discover:list', {}).catch(() => ({ items: [] as DiscoverRunSummary[] }));
    setRows(r.items);
    onCount(r.items.length);
  }, [onCount]);
  useEffect(() => void reload(), [reload]);

  const put = useCallback((run: DiscoverRun) => setRuns((cur) => ({ ...cur, [run.id]: run })), []);

  const finish = useCallback(
    async (run: DiscoverRun) => {
      if (run.outcome === 'offline' || run.outcome === 'missing-id') {
        setTransient(run);
        setOpen(null);
      } else {
        setTransient(null);
        put(run);
        setOpen(run.id);
      }
      await reload();
    },
    [put, reload],
  );

  const run = useCallback(
    async (label: string, call: (tk: string) => Promise<{ run: DiscoverRun }>) => {
      const tk = token();
      setBusy({ token: tk, label });
      setError(null);
      try {
        await finish((await call(tk)).run);
      } catch (e) {
        if (RlError.from(e).code !== 'CANCELLED') setError(e);
      } finally {
        setBusy(null);
      }
    },
    [finish],
  );

  useEffect(() => {
    if (!launch || started.current === launch.nonce) return;
    started.current = launch.nonce;
    onStarted();
    void run(t(`discover.searches.kind_${launch.kind}`), (tk) => rl.invoke('discover:start', { token: tk, kind: launch.kind, ...(launch.query ? { query: launch.query } : {}), ...(launch.a ? { a: { docIds: launch.a.docIds, ...(launch.a.projectId ? { projectId: launch.a.projectId } : {}) } } : {}), ...(launch.b ? { b: { docIds: launch.b.docIds, ...(launch.b.projectId ? { projectId: launch.b.projectId } : {}) } } : {}) }));
  }, [launch, run, t, onStarted]);

  const openRow = async (id: string) => {
    if (open === id) return setOpen(null);
    setTransient(null);
    setOpen(id);
    if (!runs[id]) await rl.invoke('discover:get', { id }).then((r) => put(r.run), reportError);
  };

  const remove = async (r: DiscoverRun) => {
    setConfirmRemove(null);
    await rl.invoke('discover:remove', { id: r.id }).catch(reportError);
    setOpen(null);
    await reload();
  };

  return (
    <div data-testid="discover-searches">
      <p className="hint discover-intro">{t('discover.searches.intro')}</p>
      {busy && (
        <p role="status" data-testid="search-progress">
          {t('discover.searches.running', { name: busy.label })}{' '}
          <button type="button" className="link" onClick={() => void rl.invoke('discover:cancel', { token: busy.token })} data-testid="search-cancel">
            {t('discover.cancel')}
          </button>
        </p>
      )}
      {error !== null && <ErrorNote testId="search-error">{errorMessage(error, t)}</ErrorNote>}
      {transient && (
        <div data-testid="search-transient">
          <RunBody run={transient} onRun={setTransient} />
        </div>
      )}
      {rows !== null && rows.length === 0 && !busy && !transient && (
        <div data-testid="searches-empty">
          <EmptyState icon={<IconDiscover size={24} />} title={t('discover.searches.emptyTitle')}>
            {t('discover.searches.empty')}
          </EmptyState>
        </div>
      )}
      <ul className="work-list" aria-label={t('discover.tab_searches')}>
        {(rows ?? []).map((r) => {
          const cur = runs[r.id];
          return (
            <li key={r.id} className="work-row" data-testid="search-row" data-kind={r.kind} data-outcome={r.outcome}>
              <button type="button" className="link work-title" aria-expanded={open === r.id} onClick={() => void openRow(r.id)} data-testid="search-row-toggle">
                {open === r.id ? '▾' : '▸'} {t(`discover.searches.kind_${r.kind}`)} · {safeText(r.title)}
              </button>
              <span className="work-meta" data-testid="search-row-meta">
                {r.createdAt.slice(0, 10)} · {t('discover.searches.candidates', { count: r.candidates })}
                {r.fresh > 0 ? ` · ${t('discover.searches.newCount', { count: r.fresh })}` : ''}
              </span>
              {open === r.id && cur && (
                <>
                  <div className="work-actions">
                    <Button size="sm" disabled={busy !== null} onClick={() => void run(t(`discover.searches.kind_${cur.kind}`), (tk) => rl.invoke('discover:rerun', { token: tk, id: cur.id }))} data-testid="search-rerun">
                      {t('discover.searches.rerun')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(cur)} data-testid="search-remove">
                      {t('discover.searches.remove')}
                    </Button>
                  </div>
                  <RunBody run={cur} onRun={put} />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {confirmRemove && (
        <Dialog title={t('discover.searches.removeTitle')} onClose={() => setConfirmRemove(null)} testId="search-remove-dialog">
          <p>{t('discover.searches.removeBody', { name: safeText(confirmRemove.title) })}</p>
          <div className="actions dlg-foot">
            <Button onClick={() => setConfirmRemove(null)}>{t('discover.cancel')}</Button>
            <Button variant="danger" onClick={() => void remove(confirmRemove)} data-testid="search-remove-confirm">
              {t('discover.searches.remove')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
