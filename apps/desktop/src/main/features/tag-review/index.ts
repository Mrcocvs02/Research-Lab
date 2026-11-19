import { AppError, type TaxonomyOp } from '@rl/core';
import { conventionName, mergeOps, reviewTags, tagHealth, tagStats, type CleanupInput, type CleanupRow, type DocEdit, type Proposal, type ReviewResult } from '@rl/data/tag-vocabulary';
import { settle } from '../../ipc/handlers/organize-handlers.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { aiKeyOf, applyAi, dismissedOf, laterApplied, load, readState, toView, writeState, type Step } from './state.js';

/**
 * Vocabulary review and guided cleanup (D-493 .. D-497), loaded on demand behind the `tagReview:*` handlers: the detector,
 * the health checks, the application of proposals and rows as ONE undoable change each, and the undo of a run. The cleanup
 * rows (`@rl/data/tag-cleanup`) and the AI confirmation (`./ai.js`) are chunks of their own.
 */

const cleanup = () => import('@rl/data/tag-cleanup');
export const aiPreview = async (s: MainServices, r: { model?: string | undefined }) => (await import('./ai.js')).aiPreview(s, r);
export const aiRun = async (s: MainServices, r: { model?: string | undefined; confirmed: boolean }) => (await import('./ai.js')).aiRun(s, r);

function rowView(r: CleanupRow) {
  const { variants, ...rest } = r;
  return { ...rest, variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { ops: v.ops, docEdits: v.docEdits.length }])) };
}

export async function getReview(s: MainServices, req: { step?: number | undefined }) {
  const { loaded, state } = await load(s);
  const { tax, input } = loaded;
  const labels = new Map(tax.nodes.map((n) => [n.id, n.label]));
  const review = reviewTags(input);
  const proposals = applyAi(review.proposals, state, labels).filter((p) => !dismissedOf(state, p.id));
  const health = tagHealth(input, review.proposals);
  let rows: ReturnType<typeof rowView>[] | undefined;
  if (req.step !== undefined) {
    const plan = (await cleanup()).cleanupPlan(input, req.step as Step, review);
    rows = plan.rows.filter((r) => !dismissedOf(state, r.id)).map(rowView);
  }
  return {
    revision: tax.revision,
    proposals: proposals.map((p) => toView(p, state.ai[aiKeyOf(labels, p) ?? ''])),
    health,
    stats: tagStats(input),
    run: { ...state.run, dismissed: state.dismissed.length },
    ...(rows ? { rows } : {}),
  };
}

/** The operations and document edits of the chosen items, rebuilt from fresh detection (ids are stable). */
function itemOps(input: CleanupInput, review: ReviewResult, plans: Map<string, CleanupRow>, items: ReadonlyArray<{ id: string; keep?: string | undefined; label?: string | undefined; action?: 'merge' | 'keywords' | undefined }>) {
  const byProposal = new Map(review.proposals.map((p) => [p.id, p]));
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  const ops: TaxonomyOp[] = [];
  const docEdits: DocEdit[] = [];
  const seenKeywords = new Set<string>();
  for (const it of items) {
    const p = byProposal.get(it.id);
    if (!p) throw new AppError('NOT_FOUND', 'This proposal is no longer there', { id: it.id });
    const row = plans.get(it.id);
    if (p.kind === 'merge' || (p.kind === 'twins' && (it.action ?? p.action) === 'merge')) {
      const keep = it.keep ?? (p.keep as string);
      if (!p.tags.includes(keep)) throw new AppError('INVALID_REQUEST', 'The tag to keep is not part of the proposal', { id: it.id });
      const label = it.label ?? (keep === p.keep ? p.label : conventionName(nodes.get(keep)?.label ?? ''));
      ops.push(...mergeOps(input.nodes, p.tags, keep, label));
    } else if (p.kind === 'twins' && row) {
      for (const op of row.variants['keywords']?.ops ?? []) {
        if (op.op === 'create' || op.op === 'setFamily') {
          const key = `${op.op}:${op.id}`;
          if (seenKeywords.has(key)) continue;
          seenKeywords.add(key);
        }
        ops.push(op);
      }
    } else if (p.kind === 'parent') {
      ops.push({ op: 'move', id: p.tags[1] as string, parents: [p.tags[0] as string] });
    } else if (row) {
      const v = row.variants['default'];
      if (v) {
        ops.push(...v.ops);
        docEdits.push(...v.docEdits);
      }
    }
  }
  return { ops, docEdits };
}

async function runApply(s: MainServices, ops: TaxonomyOp[], docEdits: DocEdit[], summary: string, expectedRevision?: number) {
  const rt = await s.runtime.require();
  const r = await rt.organizer.applyTaxonomy(ops, expectedRevision, { docEdits, summary });
  await settle(s, rt, r, [{ kind: 'taxonomy' }, ...(r.reindex.length > 0 ? [{ kind: 'documents' as const, ids: r.reindex.length <= 500 ? r.reindex : undefined }] : [])]);
  return r;
}

export async function applyReview(
  s: MainServices,
  req: { items?: Array<{ id: string; keep?: string | undefined; label?: string | undefined; action?: 'merge' | 'keywords' | undefined }> | undefined; step?: number | undefined; rows?: Array<{ id: string; variant?: string | undefined }> | undefined; expectedRevision?: number | undefined },
) {
  const { rt, loaded, state } = await load(s);
  const { input } = loaded;
  const review = reviewTags(input);
  let ops: TaxonomyOp[] = [];
  let docEdits: DocEdit[] = [];
  let applied = 0;
  if (req.step !== undefined) {
    const step = req.step as Step;
    const { cleanupPlan, planOps } = await cleanup();
    const plan = cleanupPlan(input, step, review);
    const chosen = new Map((req.rows ?? []).map((r) => [r.id, r.variant]));
    const planned = planOps(plan, chosen);
    if (planned.picked.length < chosen.size) throw new AppError('CONFLICT', 'The proposals changed since they were shown', { conflict: 'revision' });
    ops = planned.ops;
    docEdits = planned.docEdits;
    const picked = planned.picked;
    applied = picked.length;
    if (state.run.startedAt === null) {
      state.run.startedAt = new Date().toISOString();
      state.run.before = tagStats(input);
    }
    if (ops.length === 0 && docEdits.length === 0) {
      state.run.steps.push({ step, status: 'applied', changeIds: [], at: new Date().toISOString() });
      await writeState(rt.store.dataDir, state);
      return { changeId: '', changeIds: [], applied: 0, documentsChanged: 0, run: { ...state.run, dismissed: state.dismissed.length } };
    }
  } else {
    const plans = new Map<string, CleanupRow>();
    const { cleanupPlan } = await cleanup();
    for (const st of [1, 2, 3, 5] as Step[]) for (const r of cleanupPlan(input, st, review).rows) plans.set(r.id, r);
    ({ ops, docEdits } = itemOps(input, review, plans, req.items ?? []));
    applied = (req.items ?? []).length;
  }
  if (ops.length === 0 && docEdits.length === 0) throw new AppError('INVALID_REQUEST', 'Nothing to apply');
  const r = await runApply(s, ops, docEdits, req.step !== undefined ? `Vocabulary cleanup, step ${req.step}` : `Vocabulary review (${applied})`, req.expectedRevision);
  if (req.step !== undefined) {
    state.run.steps = state.run.steps.filter((x) => x.step !== req.step);
    const after = tagStats({ nodes: (await rt.store.readTaxonomy()).nodes, docs: (await rt.store.documents.list()).filter((d) => !d.missing).map((d) => ({ id: d.id, tags: d.tags })) });
    state.run.steps.push({ step: req.step as Step, status: 'applied', changeIds: [r.changeId], at: new Date().toISOString(), tagsBefore: tagStats(input).tags, tagsAfter: after.tags });
    await writeState(rt.store.dataDir, state);
  }
  return { changeId: r.changeId, changeIds: [r.changeId], applied, documentsChanged: r.documentsChanged, run: { ...state.run, dismissed: state.dismissed.length } };
}

export async function rejectReview(s: MainServices, req: { ids: string[] }) {
  const { rt, loaded, state } = await load(s);
  const review = reviewTags(loaded.input);
  const ops: TaxonomyOp[] = [];
  let rejected = 0;
  for (const id of req.ids) {
    const p = review.proposals.find((x) => x.id === id);
    if (!p) continue;
    rejected++;
    if (p.kind === 'merge') {
      const keep = p.keep ?? (p.tags[0] as string);
      for (const t of p.tags) if (t !== keep) ops.push({ op: 'markDistinct', a: keep, b: t });
      if (p.tags.length > 2) for (let i = 0; i < p.tags.length; i++) for (let j = i + 1; j < p.tags.length && p.tags.length <= 6; j++) ops.push({ op: 'markDistinct', a: p.tags[i] as string, b: p.tags[j] as string });
    } else state.dismissed.push(id);
  }
  let changeId: string | null = null;
  if (ops.length > 0) changeId = (await runApply(s, ops, [], 'Marked as different')).changeId;
  if (state.dismissed.length > 0 || ops.length === 0) await writeState(rt.store.dataDir, state);
  return { changeId, rejected };
}

export async function skipStep(s: MainServices, req: { step: number }) {
  const rt = await s.runtime.require();
  const state = await readState(rt.store.dataDir);
  if (state.run.startedAt === null) state.run.startedAt = new Date().toISOString();
  state.run.steps = state.run.steps.filter((x) => x.step !== req.step);
  state.run.steps.push({ step: req.step as Step, status: 'skipped', changeIds: [], at: new Date().toISOString() });
  await writeState(rt.store.dataDir, state);
  return { ...state.run, dismissed: state.dismissed.length };
}

export async function undoRun(s: MainServices, req: { step?: number | undefined }) {
  const rt = await s.runtime.require();
  const state = await readState(rt.store.dataDir);
  const applied = state.run.steps.filter((x) => x.status === 'applied' && x.changeIds.length > 0);
  // D-504: steps are undone like a stack, later ones first. One step alone is refused while a later one still stands,
  // because the later step may have worked on the same documents and tags.
  if (req.step !== undefined) {
    const later = laterApplied(applied, req.step);
    if (later > 0) throw new AppError('CONFLICT', `Undo the ${later} later step${later === 1 ? '' : 's'} first (or use Undo all)`, { conflict: 'later-steps', later });
  }
  const todo = state.run.steps.filter((x) => x.status === 'applied' && (req.step === undefined || x.step === req.step)).reverse();
  let undone = 0;
  const settled = new Set<string>();
  for (const st of todo) {
    for (const id of [...st.changeIds].reverse()) {
      const r = await rt.organizer.undo(id, settled);
      for (const d of r.docIds) settled.add(d);
      await settle(s, rt, r, [{ kind: 'taxonomy' }, { kind: 'documents' }]);
      undone++;
    }
    st.status = 'undone';
  }
  if (req.step === undefined && todo.length > 0) state.run = { ...state.run, startedAt: null, steps: state.run.steps.map((x) => (x.status === 'applied' ? { ...x, status: 'undone' as const } : x)) };
  await writeState(rt.store.dataDir, state);
  return { undone, run: { ...state.run, dismissed: state.dismissed.length } };
}
