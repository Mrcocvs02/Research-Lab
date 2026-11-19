import { MANUSCRIPT_LIMITS, type Manuscript } from '@rl/core';
import type { Heading } from './headings.js';

export type Section = Manuscript['sections'][number];
export interface Changes {
  added: number;
  renamed: number;
  removed: number;
}

/** Title as compared between two readings of the file: no case, accents or punctuation. */
export const normTitle = (t: string): string =>
  t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Dice coefficient on the bigrams of two titles (0-1). */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      hit++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

/** Index of the nearest earlier item with a lower level, or -1. */
function parents(levels: number[]): number[] {
  const out: number[] = [];
  const stack: number[] = [];
  levels.forEach((lv, i) => {
    while (stack.length > 0 && levels[stack[stack.length - 1]!]! >= lv) stack.pop();
    out.push(stack.length > 0 ? stack[stack.length - 1]! : -1);
    stack.push(i);
  });
  return out;
}

/**
 * Matches the sections of the last reading with the headings of the new one: (title, level, occurrence), then the title alone,
 * then the same place under the same parent with a similar title (Dice >= 0.6). A section that vanished keeps its assignments
 * (`gone`, shown as "Senza sezione"); one without assignments just goes away. Sections already `gone` stay as they are.
 */
export function realign(old: Section[], next: Heading[], hasAssignments: (id: string) => boolean, newId: () => string): { sections: Section[]; changes: Changes } {
  const live = old.filter((s) => !s.gone).sort((a, b) => a.order - b.order);
  const goneOld = old.filter((s) => s.gone);
  const norm = live.map((s) => normTitle(s.title));
  const nNorm = next.map((h) => normTitle(h.title));
  const match: Array<number | null> = next.map(() => null); // new index -> old index
  const taken = new Set<number>();

  const exact = new Map<string, number[]>();
  live.forEach((s, j) => {
    const k = `${norm[j]}\u0000${s.level}`;
    exact.set(k, [...(exact.get(k) ?? []), j]);
  });
  next.forEach((h, i) => {
    const q = exact.get(`${nNorm[i]}\u0000${h.level}`);
    const j = q?.shift();
    if (j !== undefined) {
      match[i] = j;
      taken.add(j);
    }
  });

  const byTitle = new Map<string, number[]>();
  live.forEach((_s, j) => {
    if (!taken.has(j)) byTitle.set(norm[j]!, [...(byTitle.get(norm[j]!) ?? []), j]);
  });
  next.forEach((_h, i) => {
    if (match[i] !== null) return;
    const j = byTitle.get(nNorm[i]!)?.shift();
    if (j !== undefined) {
      match[i] = j;
      taken.add(j);
    }
  });

  const oldParent = parents(live.map((s) => s.level));
  const newParent = parents(next.map((h) => h.level));
  next.forEach((_h, i) => {
    if (match[i] !== null) return;
    const p = newParent[i]!;
    const want = p < 0 ? -1 : match[p];
    if (want === null || want === undefined) return;
    let best = -1;
    let bestScore = 0.6;
    live.forEach((_s, j) => {
      if (taken.has(j) || oldParent[j] !== want) return;
      const d = dice(norm[j]!, nNorm[i]!);
      if (d >= bestScore) {
        best = j;
        bestScore = d;
      }
    });
    if (best >= 0) {
      match[i] = best;
      taken.add(best);
    }
  });

  const changes: Changes = { added: 0, renamed: 0, removed: 0 };
  const sections: Section[] = next.map((h, i) => {
    const j = match[i];
    if (j === null || j === undefined) {
      changes.added++;
      return { id: newId(), title: h.title, level: h.level, order: i };
    }
    if (nNorm[i] !== norm[j]) changes.renamed++;
    return { id: live[j]!.id, title: h.title, level: h.level, order: i };
  });
  live.forEach((s, j) => {
    if (taken.has(j)) return;
    changes.removed++;
    if (hasAssignments(s.id)) sections.push({ id: s.id, title: s.title, level: s.level, order: 0, gone: true });
  });
  for (const g of goneOld) if (hasAssignments(g.id)) sections.push(g);
  return { sections: sections.slice(0, MANUSCRIPT_LIMITS.sections).map((s, order) => ({ ...s, order })), changes };
}
