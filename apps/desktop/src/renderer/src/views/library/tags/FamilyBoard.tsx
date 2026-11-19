import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { safeText } from '../safeText';
import { placeTargets, treeSections } from '../taxonomyModel';
import { useTaxonomy } from '../useTaxonomy';
import { ghostsByParent, type Ghost, type RowState } from './tagCleanupModel';

/**
 * Step 4 of the cleanup: "To sort" on the left, the families on the right. Select tags (or drag them) and "Put in…"; the proposals
 * already stand in place as ghost rows to confirm or drop (a tick per ghost).
 */
export function FamilyBoard({ ghosts, state, onState }: { ghosts: Ghost[]; state: Record<string, RowState>; onState(rowId: string, s: RowState): void }) {
  const { t } = useTranslation();
  const { model, apply, labelOf } = useTaxonomy();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState('');
  const sections = useMemo(() => treeSections(model), [model]);
  const targets = useMemo(() => placeTargets(model), [model]);
  const byParent = useMemo(() => ghostsByParent(ghosts), [ghosts]);
  const left = useMemo(() => [...sections.unsortedIds].sort((a, b) => (model.byId.get(b)?.counts.direct ?? 0) - (model.byId.get(a)?.counts.direct ?? 0) || labelOf(a).localeCompare(labelOf(b))), [sections, model, labelOf]);

  const place = async (ids: string[], to: string) => {
    if (!to || ids.length === 0) return;
    const r = await apply(ids.map((id) => ({ op: 'move' as const, id, parents: [to] })));
    if (r) setPicked(new Set());
  };
  const flip = (id: string) => setPicked((cur) => new Set(cur.has(id) ? [...cur].filter((x) => x !== id) : [...cur, id]));
  const drop = (e: DragEvent, to: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) void place(picked.has(id) ? [...picked] : [id], to);
  };

  const ghostRow = (g: Ghost) => (
    <li key={`g-${g.rowId}-${g.tagId}`} className="tag-board__ghost" data-testid="tag-board-ghost">
      <label>
        <input type="checkbox" checked={state[g.rowId]?.checked ?? true} onChange={(e) => onState(g.rowId, { checked: e.target.checked })} />
        <span>{safeText(labelOf(g.tagId))}</span>
        {g.family && <span className="badge">{t(`tax.family.${g.family}`)}</span>}
      </label>
    </li>
  );
  const node = (id: string, depth: number): ReactNode => (
    <li key={id} data-node={id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, id)}>
      <span className="tag-board__node">{safeText(labelOf(id))}</span>
      {((model.children.get(id) ?? []).length > 0 || byParent.has(id)) && depth < 3 && (
        <ul>
          {(model.children.get(id) ?? []).map((c) => node(c, depth + 1))}
          {(byParent.get(id) ?? []).map(ghostRow)}
        </ul>
      )}
    </li>
  );

  return (
    <div className="tag-board" data-testid="tag-board">
      <section aria-label={t('tax.board.unsorted', { count: left.length })}>
        <h3>{t('tax.board.unsorted', { count: left.length })}</h3>
        <div className="tag-board__put">
          <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label={t('tax.board.putIn')} data-testid="tag-board-dest">
            <option value="">{t('tax.board.putIn')}</option>
            {targets.map((x) => (
              <option key={x.id} value={x.id}>
                {safeText(x.path)}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!dest || picked.size === 0} onClick={() => void place([...picked], dest)} data-testid="tag-board-place">
            {t('tax.board.put', { count: picked.size })}
          </Button>
        </div>
        <ul className="tag-board__list" data-testid="tag-board-unsorted">
          {left.slice(0, 400).map((id) => (
            <li key={id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}>
              <label>
                <input type="checkbox" checked={picked.has(id)} onChange={() => flip(id)} />
                {safeText(labelOf(id))} <span className="facet-count">{model.byId.get(id)?.counts.direct ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t('tax.board.families')}>
        <h3>{t('tax.board.families')}</h3>
        <ul className="tag-board__tree" data-testid="tag-board-families">
          {[...sections.families, ...(sections.keywords ? [sections.keywords] : [])].map((r) => node(r, 0))}
          {(byParent.get(null) ?? []).map(ghostRow)}
        </ul>
      </section>
    </div>
  );
}
