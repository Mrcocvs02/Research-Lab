import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, CompareColumn, CompareRow, ResponseOf } from '@rl/core';
import { AiCostPreview, costGate, costLabel, type CostEstimate } from '../../components/AiCostPreview';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconClaude } from '../../components/icons-shell';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { addColumn, cellState, defaultColumns, editCell, emptyRows, hasStar, missingCells, pruneRows } from './model';
import './compare.css';

type Estimate = ResponseOf<Channels, 'compare:estimate'>;
type Project = { id: string; name: string };
const token = () => Math.random().toString(36).slice(2, 12);

const labelOf = (d: { title: string | null; authors: string[]; year: number | null }): string => {
  const first = d.authors[0]?.trim() ?? '';
  const surname = first.includes(',') ? first.split(',')[0]! : (first.split(/\s+/).pop() ?? '');
  return safeText(`${surname ? (d.authors.length > 2 ? `${surname} et al.` : surname) : (d.title ?? '')}${d.year ? ` ${d.year}` : ''}`);
};

/**
 * The comparison table (feature 16, §17.4.7): full area like the reader, papers by columns. Cells already in the literature notes
 * are reused with no send; the preview counts the CELLS still to write and the requests that takes; every cell Claude writes has
 * its ✦ and a link to the page; the table is saved in a project (`projects/<id>/tables`) and exported to CSV on request.
 */
export function CompareView({ docIds, onClose }: { docIds: string[]; onClose(): void }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const { info, reportError } = useNotify();
  const { openReader } = useReader();
  const models = config?.ai.models ?? [];
  const label = (id: string) => models.find((m) => m.id === id)?.label || id;
  const [columns, setColumns] = useState<CompareColumn[]>(() => defaultColumns((k) => t(`compare.col.${k}`)));
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [limit, setLimit] = useState(false);
  const [adding, setAdding] = useState('');
  const [edit, setEdit] = useState<{ docId: string; colId: string } | null>(null);
  const [title, setTitle] = useState(() => t('compare.defaultTitle'));
  const [saved, setSaved] = useState<{ projectId: string; id: string; projectName: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const autoRan = useRef(false);

  // The rows: one per paper, labelled from the record, with no cells until a fill.
  useEffect(() => {
    let live = true;
    Promise.all(docIds.map((docId) => rl.invoke('documents:get', { docId }).then((d) => ({ docId, label: labelOf(d) }), () => ({ docId, label: docId.slice(0, 8) })))).then((ls) => live && setRows(emptyRows(ls)));
    return () => {
      live = false;
    };
  }, [docIds]);

  const sig = JSON.stringify([columns.map((c) => c.id), rows?.map((r) => Object.keys(r.cells).length)]);
  useEffect(() => {
    if (!rows) return;
    let live = true;
    rl.invoke('compare:estimate', { docIds, columns, existing: rows.filter((r) => Object.keys(r.cells).length > 0), ...(model ? { model } : {}) }).then(
      (e) => live && setEst(e),
      (e: unknown) => live && (setEst(null), setError(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIds, sig, model, rows !== null]);

  const fill = useCallback(
    async (confirmed: boolean) => {
      if (!rows) return;
      const tk = token();
      setBusy(tk);
      setError(null);
      setLimit(false);
      setDialog(false);
      try {
        const r = await rl.invoke('compare:run', { token: tk, docIds, columns, existing: rows.filter((x) => Object.keys(x.cells).length > 0), confirmed, ...(model ? { model } : {}) });
        setRows(r.rows);
        info(t('compare.done', { notes: r.fromNotes, written: r.written }));
      } catch (e) {
        const code = RlError.from(e).code;
        if (code === 'AI_BUDGET_EXCEEDED') setLimit(true);
        else if (code !== 'CANCELLED') setError(e);
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, columns, docIds, model],
  );

  // Nothing to send (every missing cell is in a note, or no cell is missing): the table fills itself, with no send.
  useEffect(() => {
    if (!est || !rows || autoRan.current || busy) return;
    if (est.requests === 0 && est.cells.fromNotes > 0) {
      autoRan.current = true;
      void fill(false);
    }
  }, [est, rows, busy, fill]);

  const click = () => {
    if (!est) return;
    const g = costGate(est);
    if (g === 'send' || g === 'not-enabled') void fill(false);
    else setDialog(true);
  };

  const missing = rows ? missingCells(rows, columns) : 0;
  const writing = busy !== null;
  const setCell = (docId: string, colId: string, text: string) => setRows((cur) => (cur ? editCell(cur, docId, colId, text) : cur));
  const addCol = () => {
    const c = addColumn(columns, adding);
    if (c) {
      setColumns([...columns, c]);
      setAdding('');
    }
  };
  const dropCol = (id: string) => {
    const next = columns.filter((c) => c.id !== id);
    if (next.length === 0) return;
    setColumns(next);
    setRows((cur) => (cur ? pruneRows(cur, next) : cur));
  };

  const save = async (projectId: string, projectName: string) => {
    if (!rows) return;
    try {
      const r = await rl.invoke('compare:save', { ...(saved ? { id: saved.id } : {}), projectId, title: title.trim() || t('compare.defaultTitle'), columns, rows });
      setSaved({ projectId, id: r.table.id, projectName });
      setSaveOpen(false);
      info(t('compare.saved', { project: safeText(projectName) }));
    } catch (e) {
      reportError(e);
    }
  };

  const exportCsv = () => {
    if (!saved) return;
    rl.invoke('compare:exportCsv', { projectId: saved.projectId, id: saved.id }).then((r) => r.path && info(t('compare.csvDone')), reportError);
  };

  const preview = useMemo(() => {
    if (!est) return null;
    const ready = est.cells.ready + est.cells.fromNotes;
    return t('compare.preview', { ready, toWrite: est.cells.toWrite, count: est.requests });
  }, [est, t]);

  return (
    <div className="cmp-page" role="region" aria-label={t('compare.title')} data-testid="compare-view" onKeyDown={(e) => e.key === 'Escape' && !edit && !dialog && !saveOpen && onClose()}>
      <header className="cmp-head">
        <nav aria-label={t('compare.crumbs')} className="cmp-crumbs">
          <span>{saved ? safeText(saved.projectName) : t('compare.library')}</span>
          <span aria-hidden="true">›</span>
          <input className="cmp-title" aria-label={t('compare.titleLabel')} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="compare-title" />
        </nav>
        <span className="cmp-actions">
          <Button size="sm" onClick={() => (saved ? void save(saved.projectId, saved.projectName) : setSaveOpen(true))} disabled={!rows} data-testid="compare-save">
            {saved ? t('compare.update') : t('compare.save')}
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!saved} disabledReason={t('compare.csvNeedsSave')} data-testid="compare-csv">
            {t('compare.csv')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="compare-close">
            {t('common.close')}
          </Button>
        </span>
      </header>
      <div className="cmp-bar" data-testid="compare-bar">
        <p className="hint" data-testid="compare-preview" role="status">
          {preview ?? t('compare.reading')}
        </p>
        <Button size="sm" variant="secondary" icon={<IconClaude size={16} />} busy={writing} disabled={writing || !est || (est.cells.toWrite === 0 && missing === 0)} disabledReason={t('compare.nothingToWrite')} onClick={click} data-testid="compare-run">
          {est && est.cells.toWrite > 0 ? costLabel(t, t('compare.write'), est, label(est.model)) : t('compare.fill')}
        </Button>
        {busy && (
          <button type="button" className="link" onClick={() => void rl.invoke('compare:cancel', { token: busy })} data-testid="compare-cancel">
            {t('common.cancel')}
          </button>
        )}
        {est && est.cells.notEnabled > 0 && (
          <span className="hint" data-testid="compare-not-enabled">
            {t('compare.notEnabled', { count: est.cells.notEnabled })}
          </span>
        )}
        {limit && (
          <span className="hint" role="status" data-testid="compare-limit">
            {t('compare.limit')}
          </span>
        )}
      </div>
      {error !== null && <ErrorNote testId="compare-error">{errorMessage(error, t)}</ErrorNote>}
      <div className="cmp-scroll">
        <table className="cmp-table" data-testid="compare-table" aria-busy={writing}>
          <thead>
            <tr>
              <th scope="col">{t('compare.paper')}</th>
              {columns.map((c) => (
                <th key={c.id} scope="col">
                  <span>{safeText(c.name)}</span> {c.key !== null || <span className="ai-badge" aria-hidden="true">{t('ai.badge')}</span>}
                  {columns.length > 1 && (
                    <button type="button" className="cmp-x" aria-label={t('compare.removeColumn', { name: safeText(c.name) })} onClick={() => dropCol(c.id)}>
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th scope="col" className="cmp-add">
                <input value={adding} maxLength={60} placeholder={t('compare.addColumn')} aria-label={t('compare.addColumn')} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCol()} data-testid="compare-add-column" />
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.docId} data-doc-id={r.docId}>
                <th scope="row">
                  <button type="button" className="link" onClick={() => openReader(r.docId)}>
                    {r.label}
                  </button>
                </th>
                {columns.map((c) => {
                  const cell = r.cells[c.id];
                  const st = cellState(cell, writing);
                  const editing = edit?.docId === r.docId && edit.colId === c.id;
                  return (
                    <td key={c.id} className={`cmp-cell is-${st}`} data-state={st} data-testid={`compare-cell-${r.docId}-${c.id}`}>
                      {editing ? (
                        <textarea
                          autoFocus
                          rows={3}
                          defaultValue={cell?.text ?? ''}
                          aria-label={t('compare.editCell')}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== (cell?.text ?? '')) setCell(r.docId, c.id, e.target.value);
                            setEdit(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setEdit(null);
                            } else if (e.key === 'Enter' && !e.shiftKey) e.currentTarget.blur();
                          }}
                        />
                      ) : (
                        <>
                          {cell && cell.text !== '' ? (
                            <button type="button" className="cmp-text" onClick={() => setEdit({ docId: r.docId, colId: c.id })} title={t('compare.editCell')}>
                              {safeText(cell.text)}
                            </button>
                          ) : (
                            <button type="button" className="cmp-text hint" onClick={() => setEdit({ docId: r.docId, colId: c.id })}>
                              {st === 'not-enabled' ? t('compare.stateNotEnabled') : st === 'not-found' ? t('compare.stateNotFound') : st === 'writing' ? t('compare.stateWriting') : t('compare.stateWaiting')}
                            </button>
                          )}
                          {cell?.pages.map((p) => (
                            <button key={p} type="button" className="link cmp-pg" onClick={() => openReader(r.docId, p)} aria-label={t('compare.openPage', { page: p })}>
                              {t('compare.page', { page: p })}
                            </button>
                          ))}
                          {hasStar(st) && (
                            <span className="ai-badge" title={t('compare.writtenByClaude')}>
                              {t('ai.badge')}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && est && (
        <AiCostPreview what={t('compare.what', { count: est.cells.toWrite })} requests={est.requests} estimate={est as CostEstimate} modelLabel={label(est.model)} models={models} model={model || est.model} onModel={setModel} onConfirm={() => void fill(true)} onCancel={() => setDialog(false)} />
      )}
      {saveOpen && <SaveDialog onCancel={() => setSaveOpen(false)} onSave={save} title={title} />}
    </div>
  );
}

/** Where the table goes: a project of the list, or a new one named here. */
function SaveDialog({ onCancel, onSave, title }: { onCancel(): void; onSave(projectId: string, projectName: string): Promise<void>; title: string }) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rl.invoke('projects:list', {}).then(
      (r) => {
        const items = r.items.map((p) => ({ id: p.id, name: p.name }));
        setProjects(items);
        setPick(items[0]?.id ?? '__new');
      },
      (e: unknown) => {
        reportError(e);
        setProjects([]);
        setPick('__new');
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fresh = pick === '__new';
  const go = async () => {
    setBusy(true);
    try {
      if (fresh) {
        const p = await rl.invoke('projects:create', { name: (name.trim() || title).slice(0, 120) });
        await onSave(p.project.id, p.project.name);
      } else await onSave(pick, projects?.find((p) => p.id === pick)?.name ?? '');
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('compare.saveTitle')} onClose={onCancel} testId="compare-save-dialog">
      <div className="dlg-scroll">
        <label className="field">
          <span>{t('compare.saveProject')}</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={projects === null} data-testid="compare-save-project">
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {safeText(p.name)}
              </option>
            ))}
            <option value="__new">{t('compare.saveNew')}</option>
          </select>
        </label>
        {fresh && (
          <label className="field">
            <span>{t('compare.saveName')}</span>
            <input value={name} maxLength={120} placeholder={title} onChange={(e) => setName(e.target.value)} data-testid="compare-save-name" />
          </label>
        )}
      </div>
      <div className="actions dlg-foot">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" disabled={busy || projects === null} onClick={() => void go()} data-testid="compare-save-confirm">
          {t('compare.save')}
        </button>
      </div>
    </Dialog>
  );
}
