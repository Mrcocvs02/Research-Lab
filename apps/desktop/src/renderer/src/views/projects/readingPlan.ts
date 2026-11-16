import type { ProjectDetail, StudyState } from '@rl/core';

export type PlanItemView = ProjectDetail['readingPlan'][number];
export type MemberView = ProjectDetail['members'][number];

/** The plan in order (stable for equal `order`). */
export const sortPlan = (items: readonly PlanItemView[]): PlanItemView[] => [...items].sort((a, b) => a.order - b.order);

/** Moves one item to a new position and renumbers: orders become 0..n-1. */
export function moveItem(items: readonly PlanItemView[], from: number, to: number): PlanItemView[] {
  if (from < 0 || from >= items.length) return renumber(items);
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved!);
  return renumber(next);
}

export const renumber = (items: readonly PlanItemView[]): PlanItemView[] => items.map((it, i) => ({ ...it, order: i }));

/** Body of `projects:setReadingPlan` for these items (the view-only fields are left out; the state of a document is the document's own, not the plan's). */
export function toRequestItems(items: readonly PlanItemView[]) {
  return renumber(items).map((it) => {
    const out: { docId: string; order: number; due?: string; note?: string } = { docId: it.docId, order: it.order };
    if (it.due) out.due = it.due;
    if (it.note) out.note = it.note;
    return out;
  });
}

/** Members that are not in the plan yet. */
export function notInPlan(members: readonly MemberView[], plan: readonly PlanItemView[]): MemberView[] {
  const planned = new Set(plan.map((p) => p.docId));
  return members.filter((m) => !planned.has(m.docId));
}

/** The state of an item is the study state of its document ("to read" when the document is unknown). */
export const effectiveStatus = (it: Pick<PlanItemView, 'studyState'>): StudyState => it.studyState ?? 'to-read';

/** A new plan item for a member, at the end. */
export function appendMembers(plan: readonly PlanItemView[], members: readonly MemberView[]): PlanItemView[] {
  const base = renumber(sortPlan(plan));
  const extra = members.map<PlanItemView>((m, i) => ({
    docId: m.docId,
    order: base.length + i,
    studyState: m.studyState,
    title: m.title,
    missing: m.missing,
  }));
  return [...base, ...extra];
}

export function planProgress(items: readonly PlanItemView[]): Record<StudyState | 'total', number> {
  const out = { total: items.length, 'to-read': 0, reading: 0, read: 0 };
  for (const it of items) out[effectiveStatus(it)]++;
  return out;
}
