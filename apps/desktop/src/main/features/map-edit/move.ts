import { AppError } from '@rl/core';
import { mainValue, parseFamily, valueSpecificity } from '@rl/graph';
import { areaModel } from '../../graph/areas-run.js';
import { valuesOf, type Scope } from '../../graph/family-run.js';
import { loadView, type LibraryView } from '../../graph/view.js';
import { settle } from '../../ipc/handlers/organize-handlers.js';
import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * `mapEdit:move` (D-522, loaded on first use): papers dragged into a block of an editable family. The family decides what a move means:
 * of one value, the paper's tags of the family are replaced by the target; of several values, the target becomes the paper's fixed main
 * value (D-521) and the other values stay, unless `removeFrom` takes the tags under the old main value off too. One change for the gesture.
 */
export interface Family {
  /** Whether a paper takes one value or several. */
  kind: 'one' | 'many';
  /** Key of the fixed main value in `mainTags`: the family root, or `topic`. */
  key: string;
  label: string;
  /** The values of level 1 (the blocks) and every tag under them. */
  values: Set<string>;
  tags: Set<string>;
  /** The tags under a value, itself included. */
  under(value: string): Set<string>;
}

/** The editable family `family` (Topic or a family root of one or several values), or INVALID_REQUEST `family`. */
export async function editableFamily(s: MainServices, view: LibraryView, family: string, scope: Scope): Promise<Family> {
  const ref = parseFamily(family);
  const nodes = view.tax?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let kind: 'one' | 'many' = 'many';
  let key = 'topic';
  let label = 'Topic';
  let values: string[];
  if (ref.kind === 'topic') values = (await areaModel(await s.runtime.require(), view, scope)).areas.map((a) => a.id);
  else if (ref.kind === 'root') {
    const root = byId.get(ref.value);
    if (!root || root.parents.length > 0 || (root.family !== 'one' && root.family !== 'many')) throw new AppError('INVALID_REQUEST', 'This family cannot be edited', { reason: 'family' });
    kind = root.family;
    key = root.id;
    label = root.label;
    values = nodes.filter((n) => n.status !== 'deprecated' && n.parents.includes(root.id)).map((n) => n.id);
  } else throw new AppError('INVALID_REQUEST', 'This family cannot be edited', { reason: 'family' });
  const kids = new Map<string, string[]>();
  for (const n of nodes) for (const p of n.parents) (kids.get(p) ?? kids.set(p, []).get(p)!).push(n.id);
  const memo = new Map<string, Set<string>>();
  const under = (v: string): Set<string> => {
    let out = memo.get(v);
    if (!out) {
      out = new Set([v]);
      const stack = [v];
      while (stack.length > 0) for (const c of kids.get(stack.pop() as string) ?? []) if (!out.has(c)) (out.add(c), stack.push(c));
      memo.set(v, out);
    }
    return out;
  };
  return { kind, key, label, values: new Set(values), tags: new Set(values.flatMap((v) => [...under(v)])), under };
}

export async function move(
  s: MainServices,
  req: { family: string; docIds: string[]; to: string | null; removeFrom?: boolean | undefined; scope?: Scope },
): Promise<{ changeId: string | null; changed: number; removed: string[]; already: number }> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const fam = await editableFamily(s, view, req.family, req.scope);
  if (req.to !== null && !fam.values.has(req.to)) throw new AppError('INVALID_REQUEST', 'The target is not a value of this family', { reason: 'target' });
  const many = fam.kind === 'many';
  // The old main value of each paper (the one a block shows today), only when the old value is to be taken off.
  let mains: Map<string, string | null> | null = null;
  if (many && req.removeFrom && req.to !== null) {
    const v = await valuesOf(s, view, req.scope, req.family, view.records);
    const spec = valueSpecificity(v.docs.values());
    mains = new Map([...v.docs].map(([id, list]) => [id, mainValue(list, spec)]));
  }
  const items = req.docIds.map((docId) => {
    const have = view.byId.get(docId)?.tags ?? [];
    if (req.to === null) return { docId, remove: have.filter((t) => fam.tags.has(t)), ...(many ? { main: { key: fam.key, tag: null } } : {}) };
    if (!many) return { docId, add: [req.to], remove: have.filter((t) => fam.tags.has(t) && t !== req.to) };
    const old = mains?.get(docId);
    const gone = old && old !== req.to ? fam.under(old) : null;
    const keep = fam.under(req.to);
    return { docId, add: [req.to], ...(gone ? { remove: have.filter((t) => gone.has(t) && !keep.has(t)) } : {}), main: { key: fam.key, tag: req.to } };
  });
  const label = (t: string): string => view.lookup.tagLabel(t) ?? t;
  const summary = req.to === null ? `Removed ${req.docIds.length} paper(s) from the values of ${fam.label}` : `Moved ${req.docIds.length} paper(s) to "${label(req.to)}" (${fam.label})`;
  const r = await rt.organizer.retagEach(items, summary);
  const ids = r.reindex.length <= 500 ? r.reindex : undefined;
  await settle(s, rt, r, r.reindex.length > 0 ? [{ kind: 'documents', ids }] : []);
  return { changeId: r.changeId, changed: r.changed, removed: r.removed.slice(0, 20).map(label), already: r.already };
}
