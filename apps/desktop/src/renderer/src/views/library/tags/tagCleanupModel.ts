import type { TagCleanupRow, TagRun, TagStats } from '@rl/core';

export type StepState = 'todo' | 'applied' | 'skipped' | 'undone';
export const STEPS = [1, 2, 3, 4, 5] as const;
/** The step after the five: the summary. */
export const SUMMARY = 6;

/** The last thing the run recorded for a step. */
export function stepState(run: TagRun, step: number): StepState {
  const last = [...run.steps].reverse().find((s) => s.step === step);
  return last ? last.status : 'todo';
}

/** The first step still to do (an undone one counts as to do); the summary when all five are applied or skipped. */
export function currentStep(run: TagRun): number {
  for (const s of STEPS) {
    const st = stepState(run, s);
    if (st === 'todo' || st === 'undone') return s;
  }
  return SUMMARY;
}

export const appliedSteps = (run: TagRun): number[] => STEPS.filter((s) => stepState(run, s) === 'applied');

export interface RowState {
  checked?: boolean;
  variant?: string;
}

export const rowChecked = (row: TagCleanupRow, state: Record<string, RowState>): boolean => state[row.id]?.checked ?? row.checked;
export const rowVariant = (row: TagCleanupRow, state: Record<string, RowState>): string => {
  const v = state[row.id]?.variant;
  return v && v in row.variants ? v : row.variant;
};

/** The rows to send to `tagReview:apply`: the ticked ones, with a variant only where it is not the proposed one. */
export function rowsToApply(rows: readonly TagCleanupRow[], state: Record<string, RowState>): Array<{ id: string; variant?: string }> {
  return rows
    .filter((r) => rowChecked(r, state))
    .map((r) => {
      const v = rowVariant(r, state);
      return v === r.variant ? { id: r.id } : { id: r.id, variant: v };
    });
}

/** Documents the ticked rows would edit (the cost shown on the button). */
export const docEdits = (rows: readonly TagCleanupRow[], state: Record<string, RowState>): number =>
  rows.filter((r) => rowChecked(r, state)).reduce((n, r) => n + (r.variants[rowVariant(r, state)]?.docEdits ?? 0), 0);

export interface SummaryLine {
  key: keyof TagStats;
  before: number;
  after: number;
}
/** The before/after table of the summary. */
export function summaryLines(before: TagStats | null, now: TagStats): SummaryLine[] {
  const b = before ?? now;
  return (['tags', 'singletons', 'dupeConcepts', 'orphans', 'maxDepth'] as const).map((key) => ({ key, before: b[key], after: now[key] }));
}

/** A row of step 4 as a placement: the tag, the parent it would go under (null: a new family root) and the family kind it gets. */
export interface Ghost {
  rowId: string;
  tagId: string;
  parentId: string | null;
  family: string | null;
}
export function ghosts(rows: readonly TagCleanupRow[], state: Record<string, RowState>): Ghost[] {
  const out: Ghost[] = [];
  for (const r of rows) {
    if (!rowChecked(r, state)) continue;
    const ops = r.variants[rowVariant(r, state)]?.ops ?? [];
    const family = new Map<string, string | null>();
    for (const op of ops) if (op.op === 'setFamily') family.set(op.id, op.family);
    for (const op of ops) {
      if (op.op === 'move') out.push({ rowId: r.id, tagId: op.id, parentId: op.parents[0] ?? null, family: family.get(op.id) ?? null });
      else if (op.op === 'setFamily' && !ops.some((o) => o.op === 'move' && o.id === op.id)) out.push({ rowId: r.id, tagId: op.id, parentId: null, family: op.family });
    }
  }
  return out;
}

/** The ghosts under each parent (null = new roots), for drawing them in the family trees. */
export function ghostsByParent(g: readonly Ghost[]): Map<string | null, Ghost[]> {
  const out = new Map<string | null, Ghost[]>();
  for (const x of g) out.set(x.parentId, [...(out.get(x.parentId) ?? []), x]);
  return out;
}

/** Rows "Accept all" takes in a step (D-512): the row of a proposal only if main finds it acceptable; other rows unless they are "maybe". Default variants. */
export function rowsAcceptAll(rows: readonly TagCleanupRow[], proposalIds: ReadonlySet<string>, acceptable: ReadonlySet<string>): { rows: Array<{ id: string }>; sure: number; likely: number } {
  const take = rows.filter((r) => (proposalIds.has(r.id) ? acceptable.has(r.id) : r.confidence !== 'maybe'));
  const sure = take.filter((r) => r.confidence === 'sure' || r.confidence === undefined).length;
  return { rows: take.map((r) => ({ id: r.id })), sure, likely: take.length - sure };
}
