import type { TagProposal } from '@rl/core';
import type { ReviewFilter } from './tagHealthModel';

export type { ReviewFilter };
export const REVIEW_FILTERS: readonly ReviewFilter[] = ['merge', 'twins', 'parent', 'name', 'metadata'];
const CONF = { sure: 0, likely: 1, maybe: 2 } as const;

/** Claude said "different": the row drops to the "maybe" ones, folded (D-495). */
export const isFolded = (p: TagProposal): boolean => p.ai?.verdict === 'different';

/** Sure first, then likely, then maybe (folded ones last), more shared papers first. */
export function sortProposals(list: readonly TagProposal[]): TagProposal[] {
  const rank = (p: TagProposal) => (isFolded(p) ? 3 : CONF[p.confidence]);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.evidence.shared - a.evidence.shared || a.id.localeCompare(b.id));
}

/** Rows of the kinds switched on; none switched on shows everything. */
export function filterProposals(list: readonly TagProposal[], on: ReadonlySet<ReviewFilter>): TagProposal[] {
  return on.size === 0 ? [...list] : list.filter((p) => on.has(p.kind));
}

export function countByKind(list: readonly TagProposal[]): Record<ReviewFilter, number> {
  const out: Record<ReviewFilter, number> = { merge: 0, twins: 0, parent: 0, name: 0, metadata: 0 };
  for (const p of list) out[p.kind]++;
  return out;
}

/** What "Accept the sure ones" takes: sure merges and renames (never twins, parents or metadata, which change the shape). */
export const sureOnes = (list: readonly TagProposal[]): TagProposal[] => list.filter((p) => p.confidence === 'sure' && (p.kind === 'merge' || p.kind === 'name'));

/** Uncertain rows the AI confirmation would ask about and has not answered yet. */
export const uncertainCount = (list: readonly TagProposal[]): number => list.filter((p) => p.confidence !== 'sure' && (p.kind === 'merge' || p.kind === 'parent') && !p.ai).length;

export interface RowChoice {
  keep?: string;
  label?: string;
  action?: 'merge' | 'keywords';
}
export interface ApplyItem {
  id: string;
  keep?: string;
  label?: string;
  action?: 'merge' | 'keywords';
}

/** The request item of a row: only what the user changed or the row fixes (survivor, label, twins action). */
export function applyItem(p: TagProposal, choice: RowChoice | undefined): ApplyItem {
  const out: ApplyItem = { id: p.id };
  const keep = choice?.keep ?? p.keep;
  if (keep && (p.kind === 'merge' || p.kind === 'parent')) out.keep = keep;
  const label = choice?.label?.trim() || undefined;
  if (label && label !== p.label) out.label = label;
  const action = choice?.action ?? p.action;
  if (p.kind === 'twins' && action) out.action = action;
  return out;
}

/** The works behind a row: every tag's papers, shared ones counted once. */
export const paperTotal = (p: TagProposal): number => Math.max(0, Object.values(p.evidence.papers).reduce((a, b) => a + b, 0) - p.evidence.shared);

/** Selectable survivors of a merge: the proposal's own first. */
export const keepOptions = (p: TagProposal): string[] => (p.keep && p.tags.includes(p.keep) ? [p.keep, ...p.tags.filter((t) => t !== p.keep)] : [...p.tags]);

/** Arrow-key movement between rows (clamped). */
export function moveIndex(i: number, key: string, n: number): number {
  if (n === 0) return -1;
  if (key === 'ArrowDown') return Math.min(n - 1, i + 1);
  if (key === 'ArrowUp') return Math.max(0, i - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return i;
}

/** Rows that touch a tag ("Similar" in the node editor). */
export const proposalsFor = (list: readonly TagProposal[], id: string): TagProposal[] => list.filter((p) => p.kind !== 'parent' && p.tags.includes(id));

/** What "Accept all" takes (D-512): the proposals main marked acceptable (sure and likely, past the guardrails), with how many of each. */
export function acceptAll(list: readonly TagProposal[], acceptable: readonly string[]): { items: TagProposal[]; sure: number; likely: number } {
  const ok = new Set(acceptable);
  const items = list.filter((p) => ok.has(p.id));
  const sure = items.filter((p) => p.confidence === 'sure').length;
  return { items, sure, likely: items.length - sure };
}
