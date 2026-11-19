import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Segmented } from '../../components/Segmented';
import { ErrorNote } from '../../components/ui';
import { setDiscoverIntent } from '../../lib/discoverIntent';
import { errorMessage } from '../../lib/errors';
import { setMapStart } from '../../lib/mapStartIntent';
import { useNav } from '../../lib/nav';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { safeText } from '../library/safeText';
import { useScopeOptions } from '../network/useScopes';
import { reasonLine, weightBar, type FoundLink } from './reasons';
import './links.css';

type Find = RequestOf<Channels, 'doclinks:find'>;
type Mode = 'selection' | 'project' | 'folder' | 'tag' | 'all';
type Strictness = NonNullable<Find['strictness']>;
interface Result {
  threshold: number;
  scanned: number;
  added: FoundLink[];
  below: FoundLink[];
  skipped: { dismissed: number; existing: number };
}

/**
 * "Trova collegamenti" (§18.2, D-479, D-480): from a source document to a target or a group, with the signals the Map has and a
 * normal threshold; nothing is forced and Claude is not used. The links found are added at once, with the reason and the weight,
 * and each can be removed; the ones below the threshold can be added by hand.
 */
export function LinkFinderDialog({ docIds, onClose, onShowMap }: { docIds: string[]; onClose(): void; onShowMap?(docId: string, label: string): void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const scopes = useScopeOptions();
  const [source, setSource] = useState(docIds[0] ?? '');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>(docIds.length >= 2 ? 'selection' : 'all');
  const [value, setValue] = useState('');
  const [strictness, setStrictness] = useState<Strictness>('normal');
  const [busy, setBusy] = useState(false);
  /** The running search: its token (for `progress` and `cancel`) and how far it is. */
  const token = useRef('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [needsGraph, setNeedsGraph] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const clean = (s: string) => safeText(s);

  useEffect(() => {
    let live = true;
    for (const id of docIds.slice(0, 30)) {
      rl.invoke('documents:get', { docId: id }).then(
        (d) => live && setTitles((cur) => ({ ...cur, [id]: d.title?.trim() || d.path.slice(d.path.lastIndexOf('/') + 1) })),
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [docIds]);

  const others = useMemo(() => docIds.filter((d) => d !== source), [docIds, source]);
  const options = mode === 'project' ? scopes.projects.map((p) => ({ id: p.id, label: p.name })) : mode === 'folder' ? scopes.folders.map((f) => ({ id: f, label: f === '' ? '/' : f })) : mode === 'tag' ? scopes.tags : [];
  const targets: Find['targets'] | null =
    mode === 'selection' ? (others.length > 0 ? { docIds: others } : null) : mode === 'all' ? { all: true } : value === '' ? null : mode === 'project' ? { projectId: value } : mode === 'folder' ? { folder: value } : { tagId: value };
  const reason = !source ? t('links.noSource') : targets === null ? t('links.noTargets') : '';
  const label = (id: string) => clean(titles[id] ?? id.slice(0, 8));
  const tr = (part: string, o: Record<string, unknown> = {}) => t(`links.reason.${part}`, o);

  const run = async () => {
    if (!targets) return;
    setBusy(true);
    setError(null);
    setNeedsGraph(null);
    setProgress(null);
    const mine = crypto.randomUUID();
    token.current = mine;
    const poll = setInterval(() => void rl.invoke('doclinks:progress', { token: mine }).then((p) => token.current === mine && setProgress(p), () => undefined), 300);
    try {
      const r = await rl.invoke('doclinks:find', { sourceId: source, targets, strictness, token: mine });
      setResult({ threshold: r.threshold, scanned: r.scanned, added: r.added as FoundLink[], below: r.below as FoundLink[], skipped: r.skipped });
    } catch (e) {
      const err = RlError.from(e);
      if (err.code === 'CANCELLED') setResult(null);
      else if (err.details?.['reason'] === 'needs-graph') setNeedsGraph(Number(err.details['limit']) || 500);
      else setError(e);
    } finally {
      clearInterval(poll);
      token.current = '';
      setProgress(null);
      setBusy(false);
    }
  };
  const cancel = () => void rl.invoke('doclinks:cancel', { token: token.current }).catch(() => undefined);
  const remove = async (item: FoundLink) => {
    if (!item.id) return;
    try {
      await rl.invoke('doclinks:remove', { ids: [item.id] });
      setResult((r) => (r ? { ...r, added: r.added.filter((x) => x.id !== item.id) } : r));
    } catch (e) {
      setError(e);
    }
  };
  const add = async (item: FoundLink) => {
    try {
      const r = await rl.invoke('doclinks:add', { a: source, b: item.docId, weight: item.weight, reasons: item.reasons as Record<string, unknown> });
      setResult((cur) => (cur ? { ...cur, below: cur.below.filter((x) => x.docId !== item.docId), added: [...cur.added, { ...item, id: r.id }] } : cur));
    } catch (e) {
      setError(e);
    }
  };
  const undoAll = async () => {
    const ids = (result?.added ?? []).map((x) => x.id).filter((x): x is string => !!x);
    if (ids.length === 0) return;
    try {
      await rl.invoke('doclinks:remove', { ids, forget: true });
      setResult((r) => (r ? { ...r, added: [] } : r));
    } catch (e) {
      setError(e);
    }
  };
  const showMap = () => {
    const text = titles[source] ?? '';
    if (onShowMap) onShowMap(source, text);
    else {
      setMapStart({ docId: source, label: text });
      nav.navigate({ view: 'map' });
    }
    onClose();
  };
  const bridgeOk = mode === 'selection' && others.length === 1;
  const bridge = () => {
    if (!bridgeOk) return;
    setDiscoverIntent({ kind: 'bridge', docIds: [source, others[0]!] });
    nav.navigate({ view: 'discover' });
    onClose();
  };

  const row = (x: FoundLink, side: 'added' | 'below') => (
    <li key={x.docId} className="lf-row" data-testid={side === 'added' ? 'lf-result' : 'lf-below-item'} data-doc-id={x.docId}>
      <span className="lf-row__title" title={clean(x.title)}>
        {clean(x.title)}
        {x.year !== null ? ` · ${x.year}` : ''}
      </span>
      <span className="lf-row__weight" aria-label={t('links.weight', { value: x.weight.toFixed(2) })}>
        {weightBar(x.weight)} {x.weight.toFixed(2)}
      </span>
      <span className="hint lf-row__why">{reasonLine(x.reasons, tr, clean)}</span>
      {side === 'added' ? (
        <button type="button" className="icon-button" aria-label={t('links.remove')} title={t('links.remove')} onClick={() => void remove(x)} data-testid="lf-remove">
          <span aria-hidden="true">✕</span>
        </button>
      ) : (
        <Button size="sm" onClick={() => void add(x)} data-testid="lf-add">
          {t('links.add')}
        </Button>
      )}
    </li>
  );

  return (
    <Dialog title={t('links.title')} onClose={onClose} testId="linkfinder">
      <div className="lf-body">
        <label className="net-field">
          <span>{t('links.source')}</span>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setResult(null);
            }}
            data-testid="lf-source"
          >
            {docIds.map((id) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
          </select>
        </label>
        <div className="net-field" data-testid="lf-targets">
          <span>{t('links.targets')}</span>
          <Segmented<Mode>
            size="sm"
            label={t('links.targets')}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setValue('');
              setResult(null);
            }}
            options={[
              ...(docIds.length >= 2 ? [{ value: 'selection' as const, label: t('links.scopeSelection', { count: others.length }), testId: 'lf-scope-selection' }] : []),
              { value: 'project', label: t('links.scopeProject'), testId: 'lf-scope-project' },
              { value: 'folder', label: t('links.scopeFolder'), testId: 'lf-scope-folder' },
              { value: 'tag', label: t('links.scopeTag'), testId: 'lf-scope-tag' },
              { value: 'all', label: t('links.scopeAll'), testId: 'lf-scope-all' },
            ]}
          />
          {mode === 'project' || mode === 'folder' || mode === 'tag' ? (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('links.targets')} data-testid="lf-scope-value">
              <option value="">{t('links.pick')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {clean(o.label)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="net-field" data-testid="lf-threshold">
          <span>{t('links.threshold')}</span>
          <Segmented<Strictness>
            size="sm"
            label={t('links.threshold')}
            value={strictness}
            onChange={(v) => {
              setStrictness(v);
              setResult(null);
            }}
            options={[
              { value: 'strict', label: t('links.strict'), testId: 'lf-strict' },
              { value: 'normal', label: t('links.normal'), testId: 'lf-normal' },
              { value: 'wide', label: t('links.wide'), testId: 'lf-wide' },
            ]}
          />
          {result && <span className="hint">{t('links.thresholdHint', { value: result.threshold.toFixed(2) })}</span>}
        </div>
        <div className="lf-run">
          <Button variant="primary" onClick={() => void run()} busy={busy} disabled={reason !== ''} disabledReason={reason} data-testid="lf-run">
            {busy ? t('links.running') : t('links.run')}
          </Button>
          {busy && (
            <>
              {progress !== null && progress.total > 0 && (
                <progress className="lf-progress" value={progress.done} max={progress.total} aria-label={t('links.progress', { done: progress.done, total: progress.total })} data-testid="lf-progress" />
              )}
              {progress !== null && progress.total > 0 && <span className="hint">{t('links.progress', { done: progress.done, total: progress.total })}</span>}
              <Button onClick={cancel} data-testid="lf-cancel">
                {t('links.cancel')}
              </Button>
            </>
          )}
        </div>
        {needsGraph !== null && (
          <p className="hint" data-testid="lf-needs-graph">
            {t('links.needsGraph', { limit: needsGraph })}{' '}
            <Button size="sm" variant="primary" onClick={() => void rl.invoke('graph:build', {}).then(() => nav.navigate({ view: 'map' }), setError)} data-testid="graph-build">
              {t('links.build')}
            </Button>
          </p>
        )}
        {error ? <ErrorNote testId="lf-error">{errorMessage(error, t)}</ErrorNote> : null}
        {result && (
          <section aria-live="polite" data-testid="lf-results">
            {result.added.length > 0 ? (
              <>
                <h3 className="lf-head">{t('links.result', { count: result.added.length, scanned: result.scanned })}</h3>
                <ul className="lf-list">{result.added.map((x) => row(x, 'added'))}</ul>
              </>
            ) : (
              <p data-testid="lf-none">{result.below[0] ? t('links.none', { title: clean(result.below[0].title), score: result.below[0].weight.toFixed(2) }) : t('links.noneAny')}</p>
            )}
            {(result.skipped.existing > 0 || result.skipped.dismissed > 0) && <p className="hint">{t('links.skipped', result.skipped)}</p>}
            {result.below.length > 0 && (
              <details data-testid="lf-below">
                <summary>{t('links.below', { count: result.below.length, best: result.below[0]!.weight.toFixed(2) })}</summary>
                <ul className="lf-list">{result.below.map((x) => row(x, 'below'))}</ul>
              </details>
            )}
          </section>
        )}
      </div>
      <footer className="lf-foot">
        {result && result.added.length > 0 && (
          <>
            <Button onClick={() => void undoAll()} data-testid="lf-undo-all">
              {t('links.undoAll', { count: result.added.length })}
            </Button>
            <Button onClick={showMap} data-testid="lf-show-map">
              {t('links.showMap')}
            </Button>
          </>
        )}
        <span className="lf-foot__bridge hint">
          {t('links.bridgeAsk')}{' '}
          <button type="button" className="link" onClick={bridge} disabled={!bridgeOk} title={bridgeOk ? undefined : t('links.bridgeNeeds')} data-testid="lf-bridge">
            {t('links.bridge')}
          </button>
        </span>
      </footer>
    </Dialog>
  );
}
