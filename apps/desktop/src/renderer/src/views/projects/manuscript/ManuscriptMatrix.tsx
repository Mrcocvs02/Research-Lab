import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Claim, Manuscript, ManuscriptRef } from '@rl/core';
import { safeText } from '../../library/safeText';
import { cellOf, refDocs, refKey, windowOf, type Cell, type Column, type Row } from './manuscriptModel';

const ROW = 28;
const COL = 72;
const HEAD = 56;
const SIDE = 240;

/** The matrix (§18.1): sections by papers. Only the rows and columns in view are drawn (500 x 300 without a stutter); arrows move, Space toggles the paper, Enter opens the cell. */
export default function ManuscriptMatrix({
  rows,
  columns,
  cells,
  manuscript,
  claims,
  onToggleDoc,
  onUnassign,
  entryLabel,
}: {
  rows: readonly Row[];
  columns: readonly Column[];
  cells: ReadonlyMap<string, Cell>;
  manuscript: Manuscript;
  claims: ReadonlyMap<string, Claim>;
  onToggleDoc(sectionId: string, docId: string, on: boolean): void;
  onUnassign(sectionId: string, ref: ManuscriptRef): void;
  entryLabel(r: ManuscriptRef): string;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0, w: 800, h: 400 });
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [popover, setPopover] = useState<{ r: number; c: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (el) setScroll({ x: el.scrollLeft, y: el.scrollTop, w: el.clientWidth || 800, h: el.clientHeight || 400 });
  }, [rows.length, columns.length]);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    box.current?.querySelector<HTMLElement>(`[data-r="${active.r}"][data-c="${active.c}"]`)?.focus();
  }, [active]);

  const [r0, r1] = windowOf(rows.length, ROW, scroll.y, scroll.h);
  const [c0, c1] = windowOf(columns.length, COL, scroll.x, Math.max(0, scroll.w - SIDE));
  const firstUnused = columns.findIndex((c) => c.unused);
  const desc = (c: Cell) => (c.state === 'empty' ? t('ms.cell.empty') : `${t(`ms.cell.${c.state === 'direct' ? 'direct' : 'indirect'}`)}${c.n > 0 && c.state === 'direct' ? ` · +${c.n}` : ''}`);

  const go = (r: number, c: number) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(columns.length - 1, c)) };
    const el = box.current;
    if (el) {
      if (next.r * ROW < el.scrollTop) el.scrollTop = next.r * ROW;
      else if ((next.r + 1) * ROW > el.scrollTop + el.clientHeight - HEAD) el.scrollTop = (next.r + 1) * ROW - el.clientHeight + HEAD;
      if (next.c * COL < el.scrollLeft) el.scrollLeft = next.c * COL;
      else if ((next.c + 1) * COL > el.scrollLeft + el.clientWidth - SIDE) el.scrollLeft = (next.c + 1) * COL - el.clientWidth + SIDE;
    }
    moved.current = true;
    setActive(next);
  };
  const toggle = (r: number, c: number) => {
    const row = rows[r];
    const col = columns[c];
    if (row && col) onToggleDoc(row.section.id, col.docId, cellOf(cells, row.section.id, col.docId).state !== 'direct');
  };
  const key = (e: KeyboardEvent, r: number, c: number) => {
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = d[e.key];
    if (step) {
      e.preventDefault();
      go(r + step[0], c + step[1]);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggle(r, c);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setPopover({ r, c });
    } else if (e.key === 'Escape') setPopover(null);
  };
  const pop = popover ? { row: rows[popover.r], col: columns[popover.c] } : null;
  const entries = pop?.row && pop.col ? manuscript.assignments.filter((a) => a.sectionId === pop.row!.section.id && refDocs(a.ref, claims).includes(pop.col!.docId)) : [];

  if (rows.length === 0 || columns.length === 0) return <p className="hint" data-testid="ms-matrix-empty">{t('ms.matrixEmpty')}</p>;
  return (
    <>
      <div
        ref={box}
        className="ms-matrix"
        role="grid"
        aria-label={t('ms.matrixLabel')}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
        data-testid="ms-matrix"
        onScroll={(e) => {
          const el = e.currentTarget;
          setScroll({ x: el.scrollLeft, y: el.scrollTop, w: el.clientWidth, h: el.clientHeight });
        }}
      >
        <div style={{ width: SIDE + columns.length * COL, height: HEAD + rows.length * ROW, position: 'relative' }}>
          <div className="ms-matrix__head" role="row" style={{ height: HEAD, width: SIDE + columns.length * COL }}>
            <div className="ms-matrix__corner" role="columnheader" style={{ width: SIDE }} />
            {columns.slice(c0, c1).map((c, k) => {
              const j = c0 + k;
              return (
                <div key={c.docId} role="columnheader" className={`ms-matrix__col${c.unused ? ' is-unused' : ''}${j === firstUnused ? ' is-first-unused' : ''}`} style={{ left: SIDE + j * COL, width: COL }} title={safeText(c.title)} data-testid={c.unused ? 'ms-unused-source' : undefined}>
                  {safeText(c.label)}
                </div>
              );
            })}
          </div>
          {rows.slice(r0, r1).map((row, k) => {
            const i = r0 + k;
            return (
              <div key={row.section.id} role="row" className="ms-matrix__row" style={{ top: HEAD + i * ROW, height: ROW }} data-section-id={row.section.id}>
                <div role="rowheader" className={`ms-matrix__side${row.gap ? ' is-gap' : ''}`} style={{ width: SIDE, paddingLeft: 8 + (row.section.level - 1) * 12 }} title={safeText(row.section.title)}>
                  {row.gap && <span aria-hidden="true">⚠ </span>}
                  {safeText(row.section.title)}
                </div>
                {columns.slice(c0, c1).map((col, q) => {
                  const j = c0 + q;
                  const cell = cellOf(cells, row.section.id, col.docId);
                  const label = `${safeText(row.section.title)} × ${safeText(col.label)}: ${desc(cell)}`;
                  return (
                    <div key={col.docId} role="gridcell" className={`ms-matrix__cellbox${j === firstUnused ? ' is-first-unused' : ''}`} style={{ left: SIDE + j * COL, width: COL }}>
                      <button
                        type="button"
                        className="ms-cell"
                        data-testid="ms-cell"
                        data-state={cell.state}
                        data-r={i}
                        data-c={j}
                        tabIndex={active.r === i && active.c === j ? 0 : -1}
                        aria-label={label}
                        title={label}
                        onFocus={() => setActive({ r: i, c: j })}
                        onClick={() => (setActive({ r: i, c: j }), toggle(i, j))}
                        onKeyDown={(e) => key(e, i, j)}
                      >
                        {cell.state === 'direct' ? `●${cell.n > 0 ? cell.n : ''}` : cell.state === 'indirect' ? `○${cell.n}` : '·'}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {pop?.row && pop.col && (
        <div className="ms-cell-pop" role="group" aria-label={t('ms.cellEntries', { section: safeText(pop.row.section.title), paper: safeText(pop.col.label) })} data-testid="ms-cell-popover">
          <strong>{safeText(pop.row.section.title)} × {safeText(pop.col.label)}</strong>
          {entries.length === 0 ? (
            <p className="hint">{t('ms.cell.empty')}</p>
          ) : (
            <ul className="ms-entries">
              {entries.map((a) => (
                <li key={refKey(a.ref)}>
                  <span>{entryLabel(a.ref)}</span>
                  <button type="button" className="link" onClick={() => onUnassign(a.sectionId, a.ref)} aria-label={t('ms.unassign', { what: entryLabel(a.ref) })} data-testid="ms-unassign">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link" onClick={() => setPopover(null)}>
            {t('common.close')}
          </button>
        </div>
      )}
    </>
  );
}
