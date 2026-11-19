import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Channels, ExportPreset, ResponseOf } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { FolderTree, type FolderEntry } from '../../components/FolderTree';
import { Banner } from '../../components/Banner';
import { Segmented } from '../../components/Segmented';
import { CheckField, ErrorNote, ProgressBar, SelectField, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useAiUi, type ExportInit } from '../../lib/aiUi';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { formatSize } from '../library/formatSize';
import { useScopeOptions } from '../network/useScopes';
import { applyPreset, emptyDraft, folderNameValid, fromSelection, hasSelection, loadPast, rememberExport, roundTokens, sanitizeFolderName, shortPath, sizeClass, toSelection, type Draft, type PastExport } from './exportModel';
import '../chat/dialogs.css';
import './export.css';

type Estimate = ResponseOf<Channels, 'export:preview'>;
type JobStatus = ResponseOf<Channels, 'export:status'>;
interface Destination {
  path: string;
  name: string;
}

const TERMINAL = new Set(['done', 'cancelled', 'failed']);
const draftFrom = (init: ExportInit): Draft => ({
  ...emptyDraft(),
  projectId: init.projectId ?? '',
  folders: init.folders ?? [],
  tagIds: init.tagIds ?? [],
  clusters: init.clusters ?? [],
  docIds: init.docIds ?? [],
});

/** Why an export call failed, when it is one of the conflicts the dialog explains itself. */
function conflictReason(e: unknown): string | null {
  const err = RlError.from(e);
  return err.code === 'CONFLICT' && typeof err.details?.reason === 'string' ? err.details.reason : null;
}

/** True only for the refusal that says the approval of the destination is gone (not for any other invalid request). */
function destinationGone(e: unknown): boolean {
  const err = RlError.from(e);
  return err.code === 'INVALID_REQUEST' && err.details?.reason === 'destination-not-approved';
}

/** Text of an export error: the over-limit selection has its own message, the rest the shared ones. */
function exportError(e: unknown, t: TFunction): string {
  const err = RlError.from(e);
  if (err.code === 'NOT_FOUND') return t('secondBrain.errors.noModel');
  if (err.code === 'INVALID_REQUEST' && err.details?.reason === 'too-many') return t('secondBrain.errors.tooMany');
  return errorMessage(e, t);
}

const KNOWN_CONFLICTS = new Set(['not-empty', 'other-library', 'inside-library']);

/** What the user is asked to confirm: documents outside the AI folders, and/or a large copy. */
interface Confirm {
  docs: number;
  bytes: number;
}

function Chips({ label, items, onRemove, testId }: { label: string; items: Array<{ id: string; text: string }>; onRemove(id: string): void; testId: string }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <ul className="sb-chips" aria-label={label} data-testid={testId}>
      {items.map((i) => (
        <li key={i.id} className="sb-chip">
          <span>{safeText(i.text)}</span>
          <button type="button" className="icon-button" aria-label={t('secondBrain.remove', { name: safeText(i.text) })} onClick={() => onRemove(i.id)}>
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TagPicker({ tags, value, onChange }: { tags: Array<{ id: string; label: string }>; value: string[]; onChange(next: string[]): void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tags.filter((x) => !s || x.label.toLowerCase().includes(s)).slice(0, 40);
  }, [tags, q]);
  return (
    <div data-testid="export-tags">
      <TextField label={t('secondBrain.selection.tagsFilter')} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 && <p className="hint">{t('secondBrain.selection.tagsNone')}</p>}
      <div className="sb-tags">
        {shown.map((x) => (
          <CheckField key={x.id} label={safeText(x.label)} checked={value.includes(x.id)} onChange={(e) => onChange(e.target.checked ? [...value, x.id] : value.filter((v) => v !== x.id))} />
        ))}
      </div>
    </div>
  );
}

/** "Size for an AI assistant: small (about 1,100 tokens)", with what it means in the tooltip; the index only in the diagnostics. */
function AssistantSize({ tokens, indexTokens }: { tokens: number; indexTokens: number }) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(i18n.language);
  return (
    <>
      <dt>{t('secondBrain.estimate.tokens')}</dt>
      <dd data-testid="est-size" title={t('secondBrain.estimate.tokensTip') + (indexTokens > 0 ? ` ${t('secondBrain.estimate.tokensIndex', { index: n(indexTokens) })}` : '')}>
        {t('secondBrain.estimate.tokensValue', { size: t(`secondBrain.estimate.size_${sizeClass(tokens)}`), tokens: n(roundTokens(tokens)) })}
      </dd>
    </>
  );
}

function EstimateBlock({ est, loading, error }: { est: Estimate | null; loading: boolean; error: unknown }) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(i18n.language);
  return (
    <div className="group" aria-live="polite" data-testid="export-estimate">
      <h3>{t('secondBrain.estimate.title')}</h3>
      {error ? <ErrorNote testId="export-estimate-error">{exportError(error, t)}</ErrorNote> : null}
      {!est && loading && <p className="hint">{t('secondBrain.estimate.loading')}</p>}
      {est && (
        <dl className="facts" data-testid="export-estimate-facts">
          <dt>{t('secondBrain.estimate.documents')}</dt>
          <dd data-testid="est-documents">{n(est.documents)}</dd>
          <dt>{t('secondBrain.estimate.cited')}</dt>
          <dd data-testid="est-cited">{n(est.citedAdded)}</dd>
          <dt>{t('secondBrain.estimate.files')}</dt>
          <dd data-testid="est-files">{n(est.files)}</dd>
          <AssistantSize tokens={est.approxTokens} indexTokens={est.indexTokens} />
          {est.copyBytes > 0 && (
            <>
              <dt>{t('secondBrain.estimate.copy')}</dt>
              <dd>{formatSize(est.copyBytes)}</dd>
            </>
          )}
          {est.missingFiles > 0 && (
            <>
              <dt>{t('secondBrain.estimate.missing')}</dt>
              <dd>{t('secondBrain.estimate.missingValue', { count: est.missingFiles })}</dd>
            </>
          )}
        </dl>
      )}
      {est && est.aiDisabledDocuments > 0 && (
        <div data-testid="export-ai-warning">
          <Banner tone="warning">{t('secondBrain.estimate.aiDisabled', { count: est.aiDisabledDocuments })}</Banner>
        </div>
      )}
    </div>
  );
}

function TargetNote({ est, name }: { est: Estimate | null; name: string }) {
  const { t, i18n } = useTranslation();
  const target = est?.target;
  if (!target) return null;
  const when = target.previousExportAt ? new Date(target.previousExportAt).toLocaleString(i18n.language) : '';
  const bad = target.state === 'not-empty' || target.state === 'other-library';
  return (
    <div className={bad ? 'callout warn' : 'callout'} role={bad ? 'alert' : 'status'} data-testid="export-target-note" data-state={target.state}>
      <p>{t(`secondBrain.target.${target.state}`, { name: safeText(name), when })}</p>
      {target.state === 'previous-export' && target.editedFiles > 0 && <p>{t('secondBrain.target.edited', { count: target.editedFiles })}</p>}
    </div>
  );
}

function Summary({ status, tokens }: { status: JobStatus; tokens: number | null }) {
  const { t, i18n } = useTranslation();
  const r = status.result;
  const n = (v: number) => v.toLocaleString(i18n.language);
  if (status.state === 'failed') {
    return <ErrorNote testId="export-failed">{t('secondBrain.result.failed', { message: safeText(status.error?.message ?? '') })}</ErrorNote>;
  }
  return (
    <div data-testid="export-result" data-state={status.state}>
      <p className={status.state === 'cancelled' ? 'callout warn' : 'callout'} role="status">
        {status.state === 'cancelled' ? t('secondBrain.result.cancelled') : t('secondBrain.result.done')}
      </p>
      {r && (
        <>
          <dl className="facts">
            <dt>{t('secondBrain.result.written')}</dt>
            <dd data-testid="res-written">{n(r.written)}</dd>
            <dt>{t('secondBrain.result.updated')}</dt>
            <dd data-testid="res-updated">{n(r.updated)}</dd>
            <dt>{t('secondBrain.result.unchanged')}</dt>
            <dd data-testid="res-unchanged">{n(r.unchanged)}</dd>
            <dt>{t('secondBrain.result.keptEdited')}</dt>
            <dd data-testid="res-kept">{n(r.keptEdited.length)}</dd>
            {r.copyErrors.length > 0 && (
              <>
                <dt>{t('secondBrain.result.copyErrors')}</dt>
                <dd data-testid="res-copy-errors">{n(r.copyErrors.length)}</dd>
              </>
            )}
            <dt>{t('secondBrain.result.orphaned')}</dt>
            <dd data-testid="res-orphaned">{n(r.orphaned)}</dd>
            {r.copiedBytes > 0 && (
              <>
                <dt>{t('secondBrain.result.copied')}</dt>
                <dd>{formatSize(r.copiedBytes)}</dd>
              </>
            )}
            {tokens !== null && status.state === 'done' && <AssistantSize tokens={tokens} indexTokens={0} />}
          </dl>
          {r.keptEdited.length > 0 && (
            <details data-testid="res-kept-list">
              <summary>{t('secondBrain.result.keptHint')}</summary>
              <ul>
                {r.keptEdited.slice(0, 50).map((f) => (
                  <li key={f}>
                    <code>{safeText(f)}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.copyErrors.length > 0 && (
            <details open data-testid="res-copy-errors-list">
              <summary>{t('secondBrain.result.copyErrorsHint')}</summary>
              <ul>
                {r.copyErrors.slice(0, 50).map((f) => (
                  <li key={f}>
                    <code>{safeText(f)}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.orphaned > 0 && <p className="hint">{t('secondBrain.result.orphanedHint')}</p>}
        </>
      )}
    </div>
  );
}

/**
 * Second-brain export (lazy chunk): the selection as a union (project, folders, tags, clusters, documents), the preset
 * options, a destination from the folder dialog plus a folder name, the estimate before running, progress with cancel,
 * and the summary. An earlier export of this library is found in the list at the top and updated in place.
 */
export function ExportDialog({ init, onClose }: { init: ExportInit; onClose(): void }) {
  const { t } = useTranslation();
  const app = useApp();
  const { closeExport } = useAiUi();
  const libraryId = app.activeLibraryId ?? '';
  const scopes = useScopeOptions();
  const presets: ExportPreset[] = app.config?.exportPresets ?? [];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(init));
  const [dest, setDest] = useState<Destination | null>(null);
  const [folderName, setFolderName] = useState(() => sanitizeFolderName(init.name ?? '') || 'second-brain');
  const [past, setPast] = useState<PastExport[]>([]);
  useEffect(() => setPast(libraryId ? loadPast(libraryId) : []), [libraryId]);
  const [est, setEst] = useState<Estimate | null>(null);
  const [estLoading, setEstLoading] = useState(false);
  const [estError, setEstError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [job, setJob] = useState<{ id: string; status: JobStatus | null } | null>(null);
  const [presetId, setPresetId] = useState('');
  const [needDestination, setNeedDestination] = useState(false);
  // References (Z2): BibTeX, RIS or CSL JSON of the selection to one file, instead of the second-brain folder.
  const [format, setFormat] = useState<'sb' | 'bibtex' | 'ris' | 'csl'>('sb');
  const [fileName, setFileName] = useState('references');
  const [refsBusy, setRefsBusy] = useState(false);
  const [refsDone, setRefsDone] = useState<string | null>(null);
  const refs = format !== 'sb';
  const ticket = useRef(0);
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setConflict(null);
    setConfirm(null);
  };

  const nameOk = folderNameValid(folderName);
  const target = useMemo(() => (dest && nameOk ? { destination: dest.path, folderName: folderName.trim() } : null), [dest, nameOk, folderName]);
  const selectionKey = JSON.stringify(toSelection(draft));
  const valid = hasSelection(draft);

  // The estimate follows the selection and the target (after a short pause while typing).
  useEffect(() => {
    if (!valid || job || refs) return;
    const mine = ++ticket.current;
    setEstLoading(true);
    const id = setTimeout(() => {
      rl.invoke('export:preview', { selection: JSON.parse(selectionKey), ...(target ? { target } : {}) }).then(
        (r) => {
          if (mine !== ticket.current) return;
          setEst(r);
          setEstError(null);
          setConflict((c) => (c === 'inside-library' ? null : c));
          setEstLoading(false);
        },
        (e: unknown) => {
          if (mine !== ticket.current) return;
          setEstLoading(false);
          setEst(null);
          // The approval of the destination is per session: ask for the folder again.
          if (destinationGone(e) && target) {
            setDest(null);
            setNeedDestination(true);
          } else if (conflictReason(e) === 'inside-library') {
            setEstError(null);
            setConflict('inside-library');
          } else setEstError(e);
        },
      );
    }, 250);
    return () => clearTimeout(id);
  }, [selectionKey, target, valid, job, refs]);

  const choose = useCallback(async () => {
    setError(null);
    try {
      const picked = await rl.invoke('dialog:chooseFolder', { purpose: 'export-destination', title: t('secondBrain.destination.dialogTitle') });
      if (picked) {
        setDest(picked);
        setNeedDestination(false);
        setConflict(null);
      }
    } catch (e) {
      setError(e);
    }
  }, [t]);

  const loadFolders = useCallback(
    async (parent: string): Promise<FolderEntry[]> => {
      if (!libraryId) return [];
      return (await rl.invoke('library:listFolders', { libraryId, ...(parent ? { parent } : {}) })).folders;
    },
    [libraryId],
  );

  const reusePast = (p: PastExport) => {
    setDraft(fromSelection(p.selection));
    setFolderName(p.folderName);
    setDest({ path: p.destination, name: p.destination });
    setNeedDestination(false);
    setConflict(null);
    setConfirm(null);
  };

  const start = async (confirmed: boolean) => {
    if (!target) return;
    setError(null);
    setConflict(null);
    try {
      const { jobId } = await rl.invoke('export:run', { selection: toSelection(draft), target, confirmed });
      setConfirm(null);
      setJob({ id: jobId, status: null });
    } catch (e) {
      const reason = conflictReason(e);
      const details = RlError.from(e).details;
      if (reason === 'needs-confirmation' || reason === 'large-copy') setConfirm({ docs: Number(details?.documents ?? est?.aiDisabledDocuments ?? 0), bytes: Number(details?.copyBytes ?? 0) });
      else if (reason) setConflict(reason);
      else if (destinationGone(e)) {
        setDest(null);
        setNeedDestination(true);
      } else setError(e);
    }
  };

  // Progress: events from now on, plus one read of the status in case the job finished before the listener was in place.
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    let live = true;
    const apply = (s: JobStatus) => live && s.jobId === jobId && setJob((cur) => (cur && cur.id === jobId ? { id: jobId, status: s } : cur));
    const off = rl.on('export:progress', apply);
    rl.invoke('export:status', { jobId }).then(apply, () => {});
    return () => {
      live = false;
      off();
    };
  }, [jobId]);

  const status = job?.status ?? null;
  const running = job !== null && (status === null || status.state === 'running');
  useEffect(() => {
    if (status?.state === 'done' && libraryId && dest) rememberExport(libraryId, { folderName: folderName.trim(), destination: dest.path, at: new Date().toISOString(), selection: toSelection(draft) });
    if (status && TERMINAL.has(status.state)) setPast(libraryId ? loadPast(libraryId) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state]);

  const exportRefs = async () => {
    if (!dest || format === 'sb') return;
    setError(null);
    setRefsDone(null);
    setRefsBusy(true);
    try {
      const r = await rl.invoke('bib:export', { selection: toSelection(draft), format, destination: dest.path, fileName: fileName.trim() || 'references' });
      setRefsDone(t('secondBrain.refs.done', { count: r.count, file: safeText(r.file) }));
    } catch (e) {
      if (destinationGone(e)) {
        setDest(null);
        setNeedDestination(true);
      } else if (conflictReason(e) === 'inside-library') setConflict('inside-library');
      else setError(e);
    } finally {
      setRefsBusy(false);
    }
  };
  // The clipboard copy (BibTeX) is for a project or for chosen documents, as it was in the project menu and the selection bar.
  const canCopy = valid && draft.folders.length + draft.tagIds.length + draft.clusters.length === 0 && (draft.projectId !== '') !== (draft.docIds.length > 0);
  const copyBib = async () => {
    setError(null);
    try {
      const r = await rl.invoke('bib:copy', draft.projectId ? { projectId: draft.projectId } : { docIds: draft.docIds });
      setRefsDone(t('secondBrain.refs.copied', { count: r.count }));
    } catch (e) {
      setError(e);
    }
  };

  const cancel = () => {
    if (job) void rl.invoke('export:cancel', { jobId: job.id }).catch(() => {});
  };
  const close = () => {
    if (running) cancel();
    onClose();
    closeExport();
  };

  const blocked = est?.target?.state === 'not-empty' || est?.target?.state === 'other-library' || (conflict !== null && KNOWN_CONFLICTS.has(conflict));
  const canRun = valid && nameOk && dest !== null && !blocked && !estLoading;
  const finished = status !== null && TERMINAL.has(status.state);

  // The button that was pressed often disappears with the step: the focus goes to the main button of the next one, so Esc
  // (handled on the dialog) and the keyboard keep working.
  const foot = useRef<HTMLDivElement>(null);
  const phase = job ? (finished ? 'done' : 'run') : confirm ? 'confirm' : 'form';
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    foot.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [phase]);

  return (
    <Dialog title={t('secondBrain.title')} onClose={close} testId="export-dialog">
      <div className="dlg-scroll export-dialog">
        {job ? (
          <div data-testid="export-progress-panel">
            {!finished && (
              <>
                <p>{status ? t(`secondBrain.phase.${status.phase}`) : t('secondBrain.phase.collect')}</p>
                <ProgressBar label={t('secondBrain.progress')} value={status?.done ?? 0} max={status && status.total > 0 ? status.total : undefined} />
                {status && status.total > 0 && (
                  <p className="hint" data-testid="export-progress-count">
                    {status.done} / {status.total}
                  </p>
                )}
              </>
            )}
            {finished && status && (
              <>
                <Summary status={status} tokens={est?.approxTokens ?? null} />
                {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
              </>
            )}
          </div>
        ) : (
          <>
            <Segmented
              label={t('secondBrain.format.label')}
              value={format}
              onChange={(v) => (setFormat(v), setRefsDone(null), setConflict(null))}
              options={[
                { value: 'sb', label: t('secondBrain.format.short.sb'), testId: 'export-format-sb' },
                { value: 'bibtex', label: t('secondBrain.format.short.bibtex'), testId: 'export-format-bibtex' },
                { value: 'ris', label: t('secondBrain.format.short.ris'), testId: 'export-format-ris' },
                { value: 'csl', label: t('secondBrain.format.short.csl'), testId: 'export-format-csl' },
              ]}
            />
            <p className="hint">{refs ? t('secondBrain.refs.intro') : t('secondBrain.intro')}</p>
            {!refs && past.length > 0 && (
              <div className="group" data-testid="export-past">
                <h3>{t('secondBrain.previous.title')}</h3>
                <p className="hint">{t('secondBrain.previous.hint')}</p>
                <ul className="sb-past">
                  {past.map((p) => (
                    <li key={`${p.destination}/${p.folderName}`}>
                      <button type="button" onClick={() => reusePast(p)} data-testid="export-past-item">
                        {t('secondBrain.previous.update', { name: safeText(p.folderName), when: new Date(p.at).toLocaleDateString() })}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="group" data-testid="export-selection">
              <h3>{t('secondBrain.selection.title')}</h3>
              <p className="hint">{t('secondBrain.selection.hint')}</p>
              <SelectField label={t('secondBrain.selection.project')} value={draft.projectId} onChange={(e) => edit({ projectId: e.target.value })} data-testid="export-project">
                <option value="">{t('secondBrain.selection.projectNone')}</option>
                {scopes.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {safeText(p.name)}
                  </option>
                ))}
              </SelectField>
              <Chips label={t('secondBrain.selection.clusters')} items={draft.clusters.map((c) => ({ id: c.id, text: c.label }))} onRemove={(id) => edit({ clusters: draft.clusters.filter((c) => c.id !== id) })} testId="export-clusters" />
              {draft.docIds.length > 0 && (
                <Chips label={t('secondBrain.selection.docs')} items={[{ id: 'docs', text: t('secondBrain.selection.docsCount', { count: draft.docIds.length }) }]} onRemove={() => edit({ docIds: [] })} testId="export-docs" />
              )}
              <details>
                <summary>{t('secondBrain.selection.folders', { count: draft.folders.length })}</summary>
                <p className="hint">{t('secondBrain.selection.foldersHint')}</p>
                <FolderTree load={loadFolders} value={draft.folders} onChange={(v) => edit({ folders: v })} ariaLabel={t('secondBrain.selection.folders', { count: draft.folders.length })} testId="export-folders" />
              </details>
              <details>
                <summary>{t('secondBrain.selection.tags', { count: draft.tagIds.length })}</summary>
                <TagPicker tags={scopes.tags} value={draft.tagIds} onChange={(v) => edit({ tagIds: v })} />
              </details>
              {!valid && (
                <p className="hint" data-testid="export-empty">
                  {t('secondBrain.selection.empty')}
                </p>
              )}
            </div>


            <div className="group" data-testid="export-destination">
              <h3>{t('secondBrain.destination.title')}</h3>
              {!refs && <p className="hint">{t('secondBrain.destination.hint')}</p>}
              <p>
                {dest ? (
                  <code data-testid="export-dest-path" title={safeText(`${dest.path}/${folderName.trim()}`)}>
                    {safeText(shortPath(dest.path))}
                  </code>
                ) : (
                  <span className="hint">{t('secondBrain.destination.none')}</span>
                )}{' '}
                <button type="button" onClick={() => void choose()} data-testid="export-choose">
                  {dest ? t('secondBrain.destination.change') : t('secondBrain.destination.choose')}
                </button>
              </p>
              {needDestination && (
                <p className="callout" role="status" data-testid="export-pick-again">
                  {t('secondBrain.destination.pickAgain')}
                </p>
              )}
              {refs ? (
                <TextField label={t('secondBrain.refs.file')} value={fileName} maxLength={100} onChange={(e) => setFileName(e.target.value)} data-testid="export-file-name" />
              ) : (
              <TextField
                label={t('secondBrain.destination.folderName')}
                hint={t('secondBrain.destination.folderNameHint')}
                value={folderName}
                maxLength={120}
                error={nameOk ? undefined : t('secondBrain.destination.folderInvalid')}
                onChange={(e) => {
                  setFolderName(e.target.value);
                  setConflict(null);
                }}
                onBlur={() => nameOk || setFolderName((n) => sanitizeFolderName(n) || 'second-brain')}
                data-testid="export-folder-name"
              />
              )}
            </div>

            {!refs && (
            <details className="group sb-advanced" data-testid="export-options">
              <summary>{t('secondBrain.options.title')}</summary>
              {presets.length > 0 && (
                <SelectField
                  label={t('secondBrain.options.preset')}
                  value={presetId}
                  onChange={(e) => {
                    setPresetId(e.target.value);
                    const p = presets.find((x) => x.id === e.target.value);
                    if (p) edit(applyPreset(draft, p));
                  }}
                  data-testid="export-preset"
                >
                  <option value="">{t('secondBrain.options.presetNone')}</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {safeText(p.name)}
                    </option>
                  ))}
                </SelectField>
              )}

              <CheckField label={t('secondBrain.options.cited')} hint={t('secondBrain.options.citedHint')} checked={draft.includeCited} onChange={(e) => edit({ includeCited: e.target.checked })} data-testid="export-cited" />
              {draft.includeCited && (
                <SelectField label={t('secondBrain.options.depth')} value={String(draft.citedDepth)} onChange={(e) => edit({ citedDepth: Number(e.target.value) })} data-testid="export-depth">
                  {[0, 1, 2, 3].map((d) => (
                    <option key={d} value={d}>
                      {t('secondBrain.options.depthValue', { count: d })}
                    </option>
                  ))}
                </SelectField>
              )}
              <SelectField label={t('secondBrain.options.sources')} hint={t(`secondBrain.options.sourcesHint_${draft.sources}`)} value={draft.sources} onChange={(e) => edit({ sources: e.target.value as Draft['sources'] })} data-testid="export-sources">
                <option value="none">{t('secondBrain.options.sourcesNone')}</option>
                <option value="paths">{t('secondBrain.options.sourcesPaths')}</option>
                <option value="copies">{t('secondBrain.options.sourcesCopies')}</option>
              </SelectField>
              <CheckField label={t('secondBrain.options.notes')} checked={draft.includeNotes} onChange={(e) => edit({ includeNotes: e.target.checked })} data-testid="export-notes" />
              <CheckField label={t('secondBrain.options.annotations')} checked={draft.includeAnnotations} onChange={(e) => edit({ includeAnnotations: e.target.checked })} data-testid="export-annotations" />
            </details>
            )}

            {valid && !refs && <EstimateBlock est={est} loading={estLoading} error={estError} />}
            {!refs && <TargetNote est={est} name={folderName} />}
            {refsDone && (
              <p className="callout" role="status" data-testid="export-refs-done">
                {refsDone}
              </p>
            )}
            {conflict && (
              <p className="callout warn" role="alert" data-testid="export-conflict" data-reason={conflict}>
                {t(`secondBrain.conflict.${KNOWN_CONFLICTS.has(conflict) ? conflict : 'busy'}`)}
              </p>
            )}
            {error ? <ErrorNote testId="export-error">{exportError(error, t)}</ErrorNote> : null}
          </>
        )}
      </div>
      <div className="actions dlg-foot" ref={foot}>
        {job && !finished && (
          <button type="button" onClick={cancel} data-testid="export-cancel" data-autofocus>
            {t('secondBrain.cancel')}
          </button>
        )}
        {job && finished && status && (
          <>
            {status.state === 'done' && (
              <button type="button" onClick={() => void rl.invoke('export:reveal', { jobId: job.id }).catch((e: unknown) => setError(e))} data-testid="export-reveal">
                {t('secondBrain.result.reveal')}
              </button>
            )}
            <button type="button" onClick={() => setJob(null)} data-testid="export-again">
              {t('secondBrain.again')}
            </button>
            <button type="button" className="primary" onClick={close} data-testid="export-close" data-autofocus>
              {t('common.close')}
            </button>
          </>
        )}
        {!job && confirm !== null && (
          <>
            <div className="dlg-foot-text" role="alertdialog" aria-labelledby="export-confirm-title" data-testid="export-confirm">
              <strong id="export-confirm-title">{t('secondBrain.confirm.title')}</strong>{' '}
              {confirm.docs > 0 && <span>{t('secondBrain.confirm.footer', { count: confirm.docs })}</span>}{' '}
              {confirm.bytes > 0 && <span data-testid="export-confirm-copy">{t('secondBrain.confirm.bodyCopy', { size: formatSize(confirm.bytes) })}</span>}
            </div>
            <button type="button" onClick={() => setConfirm(null)} data-testid="export-confirm-no">
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" onClick={() => void start(true)} data-testid="export-confirm-yes" data-autofocus>
              {t('secondBrain.confirm.yes')}
            </button>
          </>
        )}
        {!job && refs && (
          <>
            <button type="button" onClick={close}>
              {t('common.close')}
            </button>
            {canCopy && (
              <button type="button" onClick={() => void copyBib()} title={t('secondBrain.refs.copyNote')} data-testid="export-copy-bib">
                {t('secondBrain.refs.copy')}
              </button>
            )}
            <button type="button" className="primary" disabled={!valid || dest === null || refsBusy || (conflict !== null && KNOWN_CONFLICTS.has(conflict))} onClick={() => void exportRefs()} data-testid="export-refs-run" data-autofocus>
              {t('secondBrain.refs.run')}
            </button>
          </>
        )}
        {!job && !refs && confirm === null && (
          <>
            <button type="button" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" disabled={!canRun} onClick={() => void start(false)} data-testid="export-run" data-autofocus>
              {est?.target?.state === 'previous-export' ? t('secondBrain.runUpdate') : t('secondBrain.run')}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
