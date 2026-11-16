import { useEffect, useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaxonomyNodeView } from '@rl/core';
import { Tree } from '../../components/Tree';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { splitLines } from '../../lib/validate';
import { safeText } from './safeText';
import { TagChip, TagPicker } from './TagParts';
import { canDelete, descendants, parentsAfterDrop, fold, flattenTree, impliesCycle, pathLabel, wouldCycle, type TreeRow } from './taxonomyModel';
import { useTaxonomy } from './useTaxonomy';

export const PRESET_COLORS = ['#d9480f', '#e8590c', '#f08c00', '#2f9e44', '#0c8599', '#1971c2', '#4263eb', '#7048e8', '#ae3ec9', '#d6336c', '#868e96', '#495057'];

function CommitText({ label, value, onCommit, testId, multiline }: { label: string; value: string; onCommit(v: string): void; testId: string; multiline?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} data-testid={testId} />
      ) : (
        <input
          id={id}
          type="text"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          data-testid={testId}
        />
      )}
    </div>
  );
}

/** Edits one node: name, colour, aliases, parents, implications, status, merge and delete. */
function NodeEditor({ node, onGone, onSelect }: { node: TaxonomyNodeView; onGone(): void; onSelect(id: string): void }) {
  const { t } = useTranslation();
  const { model, apply, labelOf } = useTaxonomy();
  const { fail } = useNotify();
  const [mergeInto, setMergeInto] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const colorId = useId();
  useEffect(() => {
    setMergeInto(null);
    setConfirmDelete(false);
    setCreating(false);
  }, [node.id]);

  const blocked = useMemo(() => {
    const out = new Set<string>([node.id, ...descendants(model, node.id)]);
    return out;
  }, [model, node.id]);

  const setParents = async (parents: string[]) => {
    if (wouldCycle(model, node.id, parents)) {
      fail(t('tax.cycle'));
      return;
    }
    await apply([{ op: 'move', id: node.id, parents }]);
  };
  const setImplies = async (implies: string[]) => {
    if (impliesCycle(model, node.id, implies)) {
      fail(t('tax.cycle'));
      return;
    }
    await apply([{ op: 'setImplies', id: node.id, implies }]);
  };

  const deletable = canDelete(model, node);
  const parents = node.parents.filter((p) => model.byId.has(p));
  const mergeTarget = mergeInto ? model.byId.get(mergeInto) : undefined;

  return (
    <div className="node-editor" data-testid="node-editor" data-node={node.id}>
      <header className="panel-head">
        <div className="panel-title">
          <h2 data-testid="node-title">{safeText(node.label)}</h2>
          <p className="hint">{pathLabel(model, node.id) || t('tax.topLevel')}</p>
        </div>
        {node.status === 'deprecated' && <span className="badge badge-warn">{t('tax.deprecated')}</span>}
        {node.status === 'candidate' && <span className="badge">{t('tax.candidate')}</span>}
      </header>

      <p className="node-counts" data-testid="node-counts">
        {t('tax.counts', { direct: node.counts.direct, implied: node.counts.implied, subtree: node.counts.subtree })}
      </p>

      <CommitText label={t('tax.label')} value={node.label} onCommit={(v) => v.trim() && void apply([{ op: 'rename', id: node.id, label: v.trim() }])} testId="node-label" />

      <div className="field">
        <span className="label" id={`${colorId}-l`}>
          {t('tax.color')}
        </span>
        <div className="swatches" role="group" aria-labelledby={`${colorId}-l`}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={node.color?.toLowerCase() === c ? 'swatch-button selected' : 'swatch-button'}
              style={{ '--swatch': c } as CSSProperties}
              aria-label={t('tax.colorValue', { color: c })}
              aria-pressed={node.color?.toLowerCase() === c}
              onClick={() => void apply([{ op: 'setColor', id: node.id, color: c }])}
              data-testid="color-swatch"
              data-color={c}
            />
          ))}
          <input
            type="color"
            aria-label={t('tax.customColor')}
            value={node.color ?? '#868e96'}
            onBlur={(e) => e.target.value.toLowerCase() !== (node.color ?? '').toLowerCase() && void apply([{ op: 'setColor', id: node.id, color: e.target.value }])}
            onChange={() => {}}
            data-testid="color-custom"
          />
          <button type="button" className="link" disabled={!node.color} onClick={() => void apply([{ op: 'setColor', id: node.id, color: null }])} data-testid="color-clear">
            {t('tax.removeColor')}
          </button>
        </div>
      </div>

      <CommitText label={t('tax.aliases')} value={node.aliases.join('\n')} multiline onCommit={(v) => void apply([{ op: 'setAliases', id: node.id, aliases: splitLines(v) }])} testId="node-aliases" />
      <p className="hint">{t('tax.aliasesHint')}</p>

      <div className="field" data-testid="node-parents">
        <span className="label">{t('tax.parents')}</span>
        <div className="tag-list">
          {parents.length === 0 && <span className="hint">{t('tax.topLevel')}</span>}
          {parents.map((p) => (
            <TagChip key={p} id={p} label={labelOf(p)} removeLabel={t('tax.removeParent', { name: labelOf(p) })} onRemove={() => void setParents(node.parents.filter((x) => x !== p))} />
          ))}
        </div>
        <TagPicker
          model={model}
          exclude={new Set([...blocked, ...node.parents])}
          ariaLabel={t('tax.addParent')}
          placeholder={t('tax.addParentPlaceholder')}
          onPick={(id) => void setParents([...node.parents, id])}
          testId="parent-input"
        />
        {parents.length > 0 && (
          <button type="button" className="link" onClick={() => void setParents([])} data-testid="make-top-level">
            {t('tax.makeTopLevel')}
          </button>
        )}
      </div>

      <div className="field" data-testid="node-implies">
        <span className="label">{t('tax.implies')}</span>
        <div className="tag-list">
          {node.implies.length === 0 && <span className="hint">{t('tax.noImplies')}</span>}
          {node.implies.map((p) => (
            <TagChip key={p} id={p} label={labelOf(p)} removeLabel={t('tax.removeImplies', { name: labelOf(p) })} onRemove={() => void setImplies(node.implies.filter((x) => x !== p))} />
          ))}
        </div>
        <TagPicker
          model={model}
          exclude={new Set([node.id, ...node.implies])}
          ariaLabel={t('tax.addImplies')}
          placeholder={t('tax.addImpliesPlaceholder')}
          onPick={(id) => void setImplies([...node.implies, id])}
          testId="implies-input"
        />
        <p className="hint">{t('tax.impliesHint')}</p>
      </div>

      <div className="node-actions">
        <button type="button" onClick={() => setCreating(true)} data-testid="add-child">
          {t('tax.addChild')}
        </button>
        {node.status === 'deprecated' ? (
          <button type="button" onClick={() => void apply([{ op: 'restore', id: node.id }])} data-testid="restore-node">
            {t('tax.restore')}
          </button>
        ) : (
          <button type="button" onClick={() => void apply([{ op: 'deprecate', id: node.id }])} data-testid="deprecate-node">
            {t('tax.deprecate')}
          </button>
        )}
      </div>
      {creating && (
        <NewNodeForm
          parent={node.id}
          onDone={(id) => {
            setCreating(false);
            if (id) onSelect(id);
          }}
        />
      )}

      <div className="field" data-testid="node-merge">
        <span className="label">{t('tax.merge')}</span>
        <TagPicker model={model} exclude={new Set([node.id])} ariaLabel={t('tax.mergeInto')} placeholder={t('tax.mergeIntoPlaceholder')} onPick={setMergeInto} testId="merge-input" />
        {mergeTarget && (
          <div className="confirm">
            <p>{t('tax.mergeConfirm', { from: safeText(node.label), to: safeText(mergeTarget.label), count: node.counts.direct })}</p>
            <div className="actions">
              <button type="button" onClick={() => setMergeInto(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  void apply([{ op: 'merge', from: node.id, into: mergeTarget.id }]).then((r) => {
                    if (r) onSelect(mergeTarget.id);
                  })
                }
                data-testid="merge-confirm"
              >
                {t('tax.mergeDo')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="field" data-testid="node-delete">
        <span className="label">{t('tax.delete')}</span>
        {!deletable && <p className="hint">{t('tax.deleteBlocked')}</p>}
        {!confirmDelete ? (
          <button type="button" className="danger" disabled={!deletable} onClick={() => setConfirmDelete(true)} data-testid="delete-node">
            {t('tax.deleteNode')}
          </button>
        ) : (
          <div className="confirm">
            <p>{t('tax.deleteConfirm', { name: safeText(node.label) })}</p>
            <div className="actions">
              <button type="button" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  void apply([{ op: 'delete', id: node.id }]).then((r) => {
                    if (r) onGone();
                  })
                }
                data-testid="delete-confirm"
              >
                {t('tax.deleteDo')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One-line form that creates a tag (top-level, or under `parent`). */
function NewNodeForm({ parent, onDone }: { parent: string | null; onDone(createdId: string | null): void }) {
  const { t } = useTranslation();
  const { apply, labelOf } = useTaxonomy();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    const r = await apply([{ op: 'create', label: label.trim(), ...(parent ? { parents: [parent] } : {}) }]);
    setBusy(false);
    if (r) onDone(r.created[0]?.id ?? null);
  };
  return (
    <form className="inline-form" onSubmit={(e) => void submit(e)} data-testid="new-node-form" onKeyDown={(e) => e.key === 'Escape' && onDone(null)}>
      <input type="text" autoFocus value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} aria-label={parent ? t('tax.newChildOf', { name: labelOf(parent) }) : t('tax.newTopLevel')} placeholder={parent ? t('tax.newChildOf', { name: labelOf(parent) }) : t('tax.newTopLevel')} data-testid="new-node-label" />
      <button type="submit" className="primary" disabled={busy || !label.trim()} data-testid="new-node-create">
        {t('tax.create')}
      </button>
      <button type="button" onClick={() => onDone(null)}>
        {t('common.cancel')}
      </button>
    </form>
  );
}

/** Document types and venues of the taxonomy: a short list and a form to add one. */
function TypesAndVenues() {
  const { t } = useTranslation();
  const { view, apply } = useTaxonomy();
  const [type, setType] = useState('');
  const [venue, setVenue] = useState('');
  if (!view) return null;
  return (
    <details className="types-venues" data-testid="types-venues">
      <summary>{t('tax.typesVenues')}</summary>
      <div className="two-col">
        <div>
          <h3>{t('tax.types')}</h3>
          <ul className="plain-list">
            {view.documentTypes.map((x) => (
              <li key={x.id}>{safeText(x.label)}</li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (type.trim()) void apply([{ op: 'addType', label: type.trim() }]).then((r) => r && setType(''));
            }}
          >
            <input type="text" value={type} maxLength={200} aria-label={t('tax.addType')} placeholder={t('tax.addType')} onChange={(e) => setType(e.target.value)} data-testid="add-type-input" />
            <button type="submit" disabled={!type.trim()}>
              {t('tax.add')}
            </button>
          </form>
        </div>
        <div>
          <h3>{t('tax.venues')}</h3>
          <ul className="plain-list">
            {view.venues.map((x) => (
              <li key={x.id}>{safeText(x.name)}</li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (venue.trim()) void apply([{ op: 'addVenue', name: venue.trim() }]).then((r) => r && setVenue(''));
            }}
          >
            <input type="text" value={venue} maxLength={200} aria-label={t('tax.addVenue')} placeholder={t('tax.addVenue')} onChange={(e) => setVenue(e.target.value)} data-testid="add-venue-input" />
            <button type="submit" disabled={!venue.trim()}>
              {t('tax.add')}
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}

/** The taxonomy as a tree of free levels: create, rename, move (drag or "parents"), aliases, implications, colour, merge, deprecate, delete. */
export function TaxonomyManager({ onBack }: { onBack(): void }) {
  const { t } = useTranslation();
  const { model, loaded, error, apply, view } = useTaxonomy();
  const { fail } = useNotify();
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showDeprecated, setShowDeprecated] = useState(true);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const queryId = useId();

  const visible = useMemo(() => {
    const q = fold(query);
    if (!q) return null;
    const hits = new Set<string>();
    for (const n of model.nodes) if (fold(n.label).includes(q) || n.aliases.some((a) => fold(a).includes(q))) hits.add(n.id);
    // keep the ancestors of every hit so the tree stays connected
    const keep = new Set(hits);
    const up = (id: string) => {
      for (const p of model.byId.get(id)?.parents ?? []) {
        if (!keep.has(p)) {
          keep.add(p);
          up(p);
        }
      }
    };
    for (const h of hits) up(h);
    return keep;
  }, [model, query]);

  const rows = useMemo(
    () => flattenTree(model, visible ? 'all' : expanded, (n) => (!showDeprecated && n.status === 'deprecated') || (visible !== null && !visible.has(n.id))),
    [model, expanded, showDeprecated, visible],
  );
  const node = selected ? model.byId.get(selected) : undefined;
  useEffect(() => {
    if (selected && loaded && !model.byId.has(selected)) setSelected(null);
  }, [selected, loaded, model]);

  const toggle = (row: TreeRow) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });

  const drop = (dragged: TreeRow, target: TreeRow | null) => {
    const n = model.byId.get(dragged.id);
    if (!n || (target && target.id === dragged.id)) return;
    const parents = parentsAfterDrop(n, dragged.parentId, target?.id ?? null);
    if (target && wouldCycle(model, dragged.id, [target.id])) {
      fail(t('tax.cycle'));
      return;
    }
    if (parents.length === n.parents.length && parents.every((p, i) => p === n.parents[i])) return;
    if (target) setExpanded((cur) => new Set([...cur, target.key]));
    void apply([{ op: 'move', id: dragged.id, parents }]);
  };

  if (error && !loaded) return <ErrorNote>{errorMessage(error, t)}</ErrorNote>;
  return (
    <div className="taxonomy-manager" data-testid="taxonomy-manager">
      <div className="taxonomy-tree-pane">
        <div className="tax-toolbar">
          <button type="button" onClick={onBack} data-testid="taxonomy-back">
            {t('tax.back')}
          </button>
          <button type="button" className="primary" onClick={() => setCreating(true)} data-testid="new-top-level">
            {t('tax.newTopLevelButton')}
          </button>
        </div>
        {creating && (
          <NewNodeForm
            parent={null}
            onDone={(id) => {
              setCreating(false);
              if (id) setSelected(id);
            }}
          />
        )}
        <div className="field">
          <label htmlFor={queryId}>{t('tax.search')}</label>
          <input id={queryId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="tax-search" />
        </div>
        <div className="check">
          <input id={`${queryId}-dep`} type="checkbox" checked={showDeprecated} onChange={(e) => setShowDeprecated(e.target.checked)} />
          <label htmlFor={`${queryId}-dep`}>{t('tax.showDeprecated')}</label>
        </div>
        <p className="hint">{t('tax.dragHint')}</p>
        {loaded && rows.length === 0 ? (
          <p className="empty" data-testid="tax-empty">
            {query ? t('tax.noMatch') : t('tax.empty')}
          </p>
        ) : (
          <Tree
            items={rows}
            selectedKey={rows.find((r) => r.id === selected)?.key ?? null}
            ariaLabel={t('tax.treeLabel')}
            testId="tax-tree"
            draggable
            dataKey={(r) => r.id}
            onSelect={(r) => setSelected(r.id)}
            onToggle={toggle}
            onDrop={drop}
            renderLabel={(r) => {
              const n = model.byId.get(r.id)!;
              return (
                <>
                  <span className="swatch" style={n.color ? ({ background: n.color } as CSSProperties) : undefined} aria-hidden="true" />
                  <span className={n.status === 'deprecated' ? 'tree-name deprecated' : 'tree-name'}>{safeText(n.label)}</span>
                  {n.parents.length > 1 && <span className="badge" title={t('tax.multiParent')}>{n.parents.length}↑</span>}
                  <span className="facet-count" title={t('tags.countHint')} data-testid="tax-count">
                    {n.counts.subtree}
                  </span>
                </>
              );
            }}
          />
        )}
        {view && <TypesAndVenues />}
      </div>
      <div className="taxonomy-editor-pane">
        {node ? (
          <NodeEditor key={node.id} node={node} onGone={() => setSelected(null)} onSelect={setSelected} />
        ) : (
          <p className="hint">{t('tax.selectHint')}</p>
        )}
      </div>
    </div>
  );
}
