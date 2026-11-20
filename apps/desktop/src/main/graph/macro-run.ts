import { AppError, type MacroProposal, type TaxonomyOp } from '@rl/core';
import { proposeCut, type CutInput, type CutProposal, type LatentAncestor } from '@rl/graph';
import { settle } from '../ipc/handlers/organize-handlers.js';
import type { MainServices } from '../ipc/handlers/services.js';
import { areaModel, topicNodes, weightsOf } from './areas-run.js';
import type { Scope } from './family-run.js';
import { loadView, scopeIds } from './view.js';

/**
 * Macro-areas (D-520, D-533, loaded on first use): a cut of the tree of Topic (or of a family of several values) that makes the blocks of the
 * Map clearer, proposed by `macro-cut` and applied as ONE change of the taxonomy. The tags of the papers do not change, only where the values
 * stand in the tree. Nothing here calls Claude.
 */
export interface MacroHooks {
  /** Concepts of the field vocabulary above the family's nodes, when a vocabulary is on: they become the parents of the gathered values. */
  latent?: (family: string) => Promise<readonly LatentAncestor[]>;
  /** Creates the nodes of those concepts (before the operations, in the same group); returns the operations that put them in place. */
  materialize?: (concepts: readonly string[], ops: TaxonomyOp[]) => Promise<TaxonomyOp[]>;
}

/** What the cut reads: the values of level 1 today, the tree under them, the weighted tags of each paper and its fixed main value. */
async function cutInput(s: MainServices, family: string, scope: Scope): Promise<{ input: CutInput; label: string }> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const wanted = await scopeIds(rt, view, scope);
  const recs = view.records.filter((r) => !wanted || wanted.has(r.id));
  const nodes = (view.tax?.nodes ?? []) as Array<{ id: string; label: string; parents: string[]; status?: string; family?: string }>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let top: string[];
  let root: string | undefined;
  let key: string;
  let label = 'Topic';
  if (family === 'topic') {
    top = (await areaModel(rt, view, scope)).areas.map((a) => a.id);
    key = 'topic';
    // The level 1 values hang under one family root (Topic) or are roots themselves.
    const common = top.map((t) => byId.get(t)?.parents ?? []).reduce<string[] | null>((acc, ps) => (acc === null ? ps : acc.filter((p) => ps.includes(p))), null) ?? [];
    root = common.length > 0 && !top.includes(common[0] as string) ? common[0] : undefined;
  } else if (family.startsWith('root:')) {
    const r = byId.get(family.slice(5));
    if (!r || r.parents.length > 0 || r.family !== 'many') throw new AppError('INVALID_REQUEST', 'This family has no macro-areas to cut', { reason: 'family' });
    root = r.id;
    key = r.id;
    label = r.label;
    top = nodes.filter((n) => n.status !== 'deprecated' && n.parents.includes(r.id)).map((n) => n.id);
  } else throw new AppError('INVALID_REQUEST', 'This family has no macro-areas to cut', { reason: 'family' });
  const pool = family === 'topic' ? topicNodes(nodes) : nodes;
  return {
    label,
    input: {
      nodes: pool.map((n) => ({ id: n.id, label: n.label, parents: n.parents, status: n.status })),
      top,
      root,
      docs: recs.map((r) => ({ id: r.id, tags: weightsOf(r), pin: r.mainTags?.[key] ?? null })),
      n: recs.length,
    },
  };
}

async function build(s: MainServices, family: string, scope: Scope, hooks?: MacroHooks): Promise<{ prop: CutProposal | null; label: string }> {
  const { input, label } = await cutInput(s, family, scope);
  const latent = hooks?.latent ? await hooks.latent(family) : undefined;
  return { prop: proposeCut({ ...input, ...(latent && latent.length > 0 ? { latent } : {}) }), label };
}

/** `mapEdit:macroPropose`: the moves, and the cut that follows from the ones not in `skip`. */
export async function macroPropose(s: MainServices, req: { family: string; scope?: Scope; skip?: string[] | undefined }, hooks?: MacroHooks): Promise<MacroProposal> {
  const { prop } = await build(s, req.family, req.scope, hooks);
  if (!prop) {
    const zero = { blocks: 0, clearPct: 0, coverage: 0, largestPct: 0, smallest: 0 };
    return { family: req.family, before: zero, after: zero, cut: [], moves: [], ops: [], materialize: [], reason: 'no-cut', skipped: [], unclear: [] };
  }
  const sel = prop.select(req.skip ?? []);
  return {
    family: req.family,
    before: prop.before,
    after: sel.after,
    cut: sel.cut,
    moves: prop.moves,
    ops: sel.ops,
    materialize: sel.materialize,
    ...(prop.moves.length === 0 ? { reason: prop.before.clearPct >= 70 ? ('fine' as const) : ('no-cut' as const) } : {}),
    skipped: sel.skipped,
    unclear: prop.unclear,
  };
}

/** `mapEdit:macroApply`: the ticked moves as one `taxonomy:apply` (plus the materializations, with a vocabulary on), one entry of the history. */
export async function macroApply(s: MainServices, req: { family: string; scope?: Scope; moves: string[]; names: Record<string, string> }, hooks?: MacroHooks): Promise<{ changeId: string; applied: number }> {
  const rt = await s.runtime.require();
  const { prop, label } = await build(s, req.family, req.scope, hooks);
  const known = new Set(prop?.moves.map((m) => m.id));
  // The library changed since the proposal: the moves are not the ones the user ticked.
  if (!prop || req.moves.some((m) => !known.has(m))) throw new AppError('CONFLICT', 'The proposal is out of date', { reason: 'stale' });
  const sel = prop.select(prop.moves.map((m) => m.id).filter((id) => !req.moves.includes(id)), req.names);
  let ops = sel.ops as TaxonomyOp[];
  if (sel.materialize.length > 0) {
    if (!hooks?.materialize) throw new AppError('INVALID_REQUEST', 'The field vocabulary is not available', { reason: 'pack' });
    ops = await hooks.materialize(sel.materialize, ops);
  }
  const done = prop.moves.length - sel.skipped.length;
  const r = await rt.organizer.applyTaxonomy(ops, undefined, { summary: `Macro-areas of ${label} (${done} moves)` });
  await settle(s, rt, r, [{ kind: 'taxonomy' }, ...(r.reindex.length > 0 ? [{ kind: 'documents' as const, ids: r.reindex.length <= 500 ? r.reindex : undefined }] : [])]);
  return { changeId: r.changeId, applied: done };
}
