import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, Claim, ManuscriptRef, ResponseOf } from '@rl/core';
import { Button } from '../../../components/Button';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { IconButton } from '../../../components/IconButton';
import { IconMore } from '../../../components/icons';
import { IconProject } from '../../../components/icons-shell';
import { Lazy, lazyView } from '../../../components/Lazy';
import { Menu, type MenuGroups } from '../../../components/Menu';
import { Segmented } from '../../../components/Segmented';
import { rl } from '../../../lib/rl';
import { useNotify } from '../../../lib/notify';
import { safeText } from '../../library/safeText';
import { buildCells, buildColumns, buildRows, liveSections, onlyGaps, orphans, refKey, REF_KINDS, sectionsToText, summarize, textToSections, type Counts, type Paper } from './manuscriptModel';
import './manuscript.css';

const ManuscriptMatrix = lazyView(() => import('./ManuscriptMatrix'), ['projects']);
const AssignDialog = lazyView(() => import('./AssignDialog'), ['projects']);
const AssignSuggestDialog = lazyView(() => import('./AssignSuggestDialog'), ['projects']);

export type ManuscriptState = ResponseOf<Channels, 'project:manuscript'>;
type Confirm = { kind: 'unlink' } | { kind: 'drop'; sectionId: string; count: number } | null;

/** The manuscript of a project (§18.1): its sections as a list or as a matrix with the papers, the gaps, and what is assigned to each section. */
export default function ManuscriptView({ projectId, papers, claims, onChanged }: { projectId: string; papers: readonly Paper[]; claims: readonly Claim[]; onChanged(): void }) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const [state, setState] = useState<ManuscriptState | null>(null);
  const [readAt, setReadAt] = useState(() => new Date());
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [gapsOnly, setGapsOnly] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [assign, setAssign] = useState<string | null>(null);
  const [reassign, setReassign] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [menu, setMenu] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const alive = useRef(true);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const load = useCallback(() => {
    rl.invoke('project:manuscript', { projectId }).then(
      (r) => {
        if (!alive.current) return;
        setState(r);
        setReadAt(new Date());
        if (r.changes) changed.current();
      },
      reportError,
    );
  }, [projectId, reportError]);
  // On opening and when the window gets the focus back: a changed file is read again (no watcher, D-478).
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [load]);

  const m = state?.manuscript ?? null;
  const claimMap = useMemo(() => new Map(claims.map((c) => [c.id, c])), [claims]);
  const rows = useMemo(() => (m ? buildRows(m) : []), [m]);
  const columns = useMemo(() => (m ? buildColumns(m, papers, claimMap) : []), [m, papers, claimMap]);
  const cells = useMemo(() => (m ? buildCells(m, claimMap) : new Map()), [m, claimMap]);
  const lost = useMemo(() => (m ? orphans(m) : []), [m]);
  const summary = summarize(rows, columns);
  const titles = useMemo(() => new Map(papers.map((p) => [p.docId, p.title])), [papers]);

  const write = async (op: () => Promise<{ manuscript: NonNullable<ManuscriptState['manuscript']> } | ManuscriptState>) => {
    try {
      const r = await op();
      if ('file' in r) {
        if (r.cancelled) return false;
        setState(r);
      } else setState((s) => (s ? { ...s, manuscript: r.manuscript } : s));
      onChanged();
      return true;
    } catch (e) {
      reportError(e);
      return false;
    }
  };
  const linkFile = () => void write(() => rl.invoke('project:setManuscript', { projectId, source: { kind: 'file' } }));
  const unassign = (sectionId: string, ref: ManuscriptRef) => void write(() => rl.invoke('project:assign', { projectId, sectionId, refs: [ref], on: false }));
  const toggleDoc = (sectionId: string, docId: string, on: boolean) => void write(() => rl.invoke('project:assign', { projectId, sectionId, refs: [{ kind: 'doc', docId }], on }));

  if (!state) return <p className="hint">{t('common.loading')}</p>;

  if (editing !== null) {
    const prev = m ? liveSections(m) : [];
    return (
      <form
        className="ms-editor"
        data-testid="ms-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void write(() => rl.invoke('project:setManuscript', { projectId, source: { kind: 'app', sections: textToSections(editing, prev) } })).then((ok) => ok && setEditing(null));
        }}
      >
        <label htmlFor="ms-editor-text">{t('ms.editorLabel')}</label>
        <textarea id="ms-editor-text" rows={12} value={editing} placeholder={'# Introduction\n## Motivation'} onChange={(e) => setEditing(e.target.value)} data-testid="ms-editor-text" />
        <div className="actions">
          <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={editing.trim() === ''} data-testid="ms-editor-save">
            {t('common.save')}
          </Button>
        </div>
      </form>
    );
  }

  if (!m) {
    return (
      <div data-testid="ms-empty">
        <EmptyState icon={<IconProject size={24} />} title={t('ms.emptyTitle')} action={<Button variant="primary" onClick={linkFile} data-testid="ms-link-file">{t('ms.linkFile')}</Button>}>
          {t('ms.emptyText')}
          <br />
          <button type="button" className="link" onClick={() => setEditing('')} data-testid="ms-start-app">
            {t('ms.startApp')}
          </button>
        </EmptyState>
      </div>
    );
  }

  const file = state.file;
  const time = readAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const shown = gapsOnly ? onlyGaps(rows, columns) : { rows, cols: columns };
  const groups: MenuGroups = [
    {
      id: 'source',
      items: [
        { id: 'change', testId: 'ms-change-file', label: t('ms.change'), onSelect: linkFile },
        { id: 'write', testId: 'ms-write-here', label: t('ms.writeHere'), onSelect: () => setEditing(sectionsToText(liveSections(m))) },
        { id: 'unlink', testId: 'ms-unlink', label: t('ms.unlink'), danger: true, onSelect: () => setConfirm({ kind: 'unlink' }) },
      ],
    },
    {
      id: 'more',
      items: [
        { id: 'propose', testId: 'ms-propose', label: t('ms.propose'), onSelect: () => setSuggest(true) },
        {
          id: 'csv',
          testId: 'ms-export-csv',
          label: t('ms.exportCsv'),
          onSelect: () => {
            const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
            const head = ['', ...columns.map((c) => c.label)].map(q).join(',');
            const body = rows.map((r) => [q(`${'  '.repeat(r.section.level - 1)}${r.section.title}`), ...columns.map((c) => (cells.get(`${r.section.id}|${c.docId}`)?.state ?? 'empty').replace('empty', ''))].join(','));
            void navigator.clipboard.writeText([head, ...body].join('\n')).then(() => info(t('ms.csvCopied')), reportError);
          },
        },
      ],
    },
  ];
  const count = (c: Counts) => REF_KINDS.filter((k) => c[k] > 0).map((k) => t(`ms.count.${k}`, { count: c[k] }));
  const entryLabel = (r: ManuscriptRef) => {
    switch (r.kind) {
      case 'doc':
        return `📄 ${safeText(titles.get(r.docId) ?? r.docId)}`;
      case 'ann':
        return `▌ ${t('ms.highlight')} · ${safeText(titles.get(r.docId) ?? r.docId)} ${t('ms.page', { n: r.page })}`;
      case 'note':
      case 'litnote':
        return `✎ ${t('ms.note')} · ${safeText(titles.get(r.docId) ?? r.docId)}${r.kind === 'note' && r.page ? ` ${t('ms.page', { n: r.page })}` : ''}`;
      case 'claim':
        return `◆ «${safeText(claimMap.get(r.claimId)?.text ?? r.claimId).slice(0, 80)}»`;
    }
  };
  const hidden = (i: number) => {
    for (let p = rows[i]!.parent; p >= 0; p = rows[p]!.parent) if (closed.has(rows[p]!.section.id)) return true;
    return false;
  };
  const toggleOpen = (id: string) => setClosed((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : new Set(cur).add(id)));
  const sectionTitle = (id: string) => liveSections(m).find((s) => s.id === id)?.title ?? '';

  return (
    <div className="ms" data-testid="ms-view">
      <div className="ms-bar">
        {m.source.kind === 'file' ? (
          file && file.state !== 'ok' ? (
            <>
              <Chip kind="status" tone="warning">
                {file.state === 'missing' ? t('ms.missing', { name: safeText(file.name) }) : t('ms.unreadable', { name: safeText(file.name), reason: file.reason ? ` · ${file.reason}` : '' })}
              </Chip>
              <Button variant="ghost" size="sm" onClick={linkFile} data-testid="ms-find-file">
                {t('ms.find')}
              </Button>
            </>
          ) : (
            <button type="button" className="ms-source" onClick={load} title={t('ms.refreshLabel')} data-testid="ms-source">
              {t('ms.readAt', { name: safeText(m.source.name), time })} <span data-testid="ms-refresh" aria-hidden="true">↻</span>
            </button>
          )
        ) : (
          <span className="ms-source" data-testid="ms-source">
            {t('ms.appSource')} ·{' '}
            <button type="button" className="link" onClick={() => setEditing(sectionsToText(liveSections(m)))} data-testid="ms-edit-sections">
              {t('ms.editSections')}
            </button>
          </span>
        )}
        {state.changes && (state.changes.added > 0 || state.changes.renamed > 0 || state.changes.removed > 0) && (
          <Chip kind="status" tone="info">
            <span data-testid="ms-changes">{t('ms.changes', state.changes)}</span>
          </Chip>
        )}
        {file && file.read.total > file.read.files && <Chip kind="status" tone="warning">{t('ms.partial', file.read)}</Chip>}
        <span className="spacer" />
        <Segmented<'list' | 'matrix'>
          label={t('ms.viewLabel')}
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: t('ms.viewList'), testId: 'ms-view-list' },
            { value: 'matrix', label: t('ms.viewMatrix'), testId: 'ms-view-matrix' },
          ]}
        />
        <label className="schema-only">
          <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} data-testid="ms-gaps-only" /> {t('ms.gapsOnly')}
        </label>
        <span ref={anchor}>
          <IconButton label={t('ms.more')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} data-testid="ms-more">
            <IconMore size={16} />
          </IconButton>
        </span>
        <Menu anchor={anchor} open={menu} onClose={() => setMenu(false)} groups={groups} label={t('ms.more')} />
      </div>
      {(summary.gaps > 0 || summary.unused > 0) && (
        <p className="hint ms-summary" data-testid="ms-summary">
          {summary.gaps > 0 && (
            <button type="button" className="link" onClick={() => setGapsOnly(true)}>
              ⚠ {t('ms.summaryGaps', { count: summary.gaps })}
            </button>
          )}
          {summary.gaps > 0 && summary.unused > 0 && ' · '}
          {summary.unused > 0 && (
            <button type="button" className="link" onClick={() => setGapsOnly(true)}>
              {t('ms.summaryUnused', { count: summary.unused })}
            </button>
          )}
        </p>
      )}
      {view === 'matrix' ? (
        <Lazy>
          <ManuscriptMatrix rows={shown.rows} columns={shown.cols} cells={cells} manuscript={m} claims={claimMap} onToggleDoc={toggleDoc} onUnassign={unassign} entryLabel={entryLabel} />
        </Lazy>
      ) : (
        <ul className="ms-list" data-testid="ms-list">
          {rows.map((r, i) => {
            if (hidden(i) || (gapsOnly && !r.gap)) return null;
            const s = r.section;
            const parentOf = rows.some((x) => x.parent === i);
            const open = !closed.has(s.id);
            const own = m.assignments.filter((a) => a.sectionId === s.id);
            return (
              <li key={s.id} className="ms-section" style={{ paddingLeft: (s.level - 1) * 20 }} data-testid="ms-section" data-section-id={s.id} data-gap={r.gap || undefined}>
                <div className="ms-section__head">
                  <button type="button" className="ms-toggle" aria-expanded={open} onClick={() => toggleOpen(s.id)} disabled={!parentOf && own.length === 0} aria-label={safeText(s.title)}>
                    {parentOf || own.length > 0 ? (open ? '▾' : '▸') : '·'} {safeText(s.title)}
                  </button>
                  {r.gap ? <Chip kind="status" tone="warning"><span data-testid="ms-gap">⚠ {t('ms.gap')}</span></Chip> : !open && <span className="hint">{count(r.subtree).join(' · ')}</span>}
                  <span className="spacer" />
                  <Button variant="ghost" size="sm" onClick={() => setAssign(s.id)} data-testid="ms-section-add">
                    {t('ms.assign')}
                  </Button>
                </div>
                {open && own.length > 0 && (
                  <ul className="ms-entries">
                    {own.map((a) => (
                      <li key={refKey(a.ref)}>
                        <span>{entryLabel(a.ref)}</span>
                        <button type="button" className="link" onClick={() => unassign(s.id, a.ref)} aria-label={t('ms.unassign', { what: entryLabel(a.ref) })} data-testid="ms-unassign">
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lost.length > 0 && (
        <section className="ms-orphans" data-testid="ms-orphans">
          {[...new Set(lost.map((a) => a.sectionId))].map((id) => {
            const n = lost.filter((a) => a.sectionId === id).length;
            return (
              <div key={id} className="ms-orphan">
                <span>{t('ms.orphans', { count: n })} · {t('ms.orphansHint')}</span>
                <span className="spacer" />
                <Button size="sm" onClick={() => setReassign(id)} data-testid="ms-reassign">
                  {t('ms.reassign')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'drop', sectionId: id, count: n })} data-testid="ms-drop">
                  {t('ms.drop')}
                </Button>
                {reassign === id && (
                  <Lazy>
                    <AssignDialog projectId={projectId} papers={papers} claims={claims} moveFrom={id} onClose={() => setReassign(null)} onDone={(manuscript) => (setState((s) => (s ? { ...s, manuscript } : s)), onChanged())} />
                  </Lazy>
                )}
              </div>
            );
          })}
        </section>
      )}
      {suggest && (
        <Lazy>
          <AssignSuggestDialog projectId={projectId} sections={new Map(liveSections(m).map((x) => [x.id, x.title]))} titles={titles} onClose={() => setSuggest(false)} onDone={(manuscript) => (setState((x) => (x ? { ...x, manuscript } : x)), onChanged())} />
        </Lazy>
      )}
      {assign !== null && (
        <Lazy>
          <AssignDialog projectId={projectId} papers={papers} claims={claims} section={{ id: assign, title: sectionTitle(assign) }} existing={new Set(m.assignments.filter((a) => a.sectionId === assign).map((a) => refKey(a.ref)))} onClose={() => setAssign(null)} onDone={(manuscript) => (setState((s) => (s ? { ...s, manuscript } : s)), onChanged())} />
        </Lazy>
      )}
      {confirm && (
        <Dialog title={confirm.kind === 'unlink' ? t('ms.unlinkTitle') : t('ms.dropTitle')} onClose={() => setConfirm(null)} testId="ms-confirm">
          <p>{confirm.kind === 'unlink' ? t('ms.unlinkText') : t('ms.dropText', { count: confirm.count })}</p>
          <div className="actions">
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              data-testid="ms-confirm-ok"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c.kind === 'unlink') void write(() => rl.invoke('project:setManuscript', { projectId, source: { kind: 'none' } }));
                else void write(() => rl.invoke('project:moveAssignments', { projectId, from: c.sectionId, to: null }));
              }}
            >
              {confirm.kind === 'unlink' ? t('ms.unlinkConfirm') : t('ms.drop')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
