import type { TaxonomyNodeView } from '@rl/core';
import { fold, pathLabel, type TaxonomyModel } from './taxonomyModel';

export interface TagSuggestion {
  id: string;
  label: string;
  /** Set when the query matched an alias (and not the label): shown so the user sees why it was proposed. */
  viaAlias?: string;
  /** Ancestors, "Methods › Statistics". */
  path: string;
  score: number;
  deprecated: boolean;
}

const words = (s: string) => s.split(/[\s\-_/.,;:()]+/).filter(Boolean);

function scoreText(text: string, q: string): number {
  const f = fold(text);
  if (f === q) return 100;
  if (f.startsWith(q)) return 80;
  if (words(f).some((w) => w.startsWith(q))) return 60;
  if (f.includes(q)) return 40;
  return 0;
}

/**
 * Completion for tag entry. Matches the label, the aliases and the id, without case or accents; alias hits rank
 * a little below the same hit on the label. Deprecated nodes are never offered (a deprecated tag cannot be added).
 */
export function suggestTags(model: TaxonomyModel, query: string, opts: { exclude?: ReadonlySet<string>; limit?: number } = {}): TagSuggestion[] {
  const q = fold(query);
  const limit = opts.limit ?? 8;
  const out: TagSuggestion[] = [];
  for (const n of model.nodes) {
    if (n.status === 'deprecated' || opts.exclude?.has(n.id)) continue;
    if (q === '') {
      out.push({ id: n.id, label: n.label, path: pathLabel(model, n.id), score: n.counts.direct, deprecated: false });
      continue;
    }
    const labelScore = scoreText(n.label, q);
    let aliasScore = 0;
    let alias: string | undefined;
    for (const a of n.aliases) {
      const s = scoreText(a, q) - 5;
      if (s > aliasScore) {
        aliasScore = s;
        alias = a;
      }
    }
    const idScore = fold(n.id).startsWith(q) ? 20 : 0;
    const best = Math.max(labelScore, aliasScore, idScore);
    if (best <= 0) continue;
    const suggestion: TagSuggestion = { id: n.id, label: n.label, path: pathLabel(model, n.id), score: best, deprecated: false };
    if (labelScore < aliasScore && alias !== undefined) suggestion.viaAlias = alias;
    out.push(suggestion);
  }
  out.sort((a, b) => b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return out.slice(0, limit);
}

/** The node that a typed text names exactly (label, alias or id), deprecated ones included. */
export function exactNode(model: TaxonomyModel, text: string): TaxonomyNodeView | null {
  const q = fold(text);
  if (q === '') return null;
  for (const n of model.nodes) {
    if (fold(n.label) === q || fold(n.id) === q || n.aliases.some((a) => fold(a) === q)) return n;
  }
  return null;
}

/** Offer to create a tag when the text is not already the name of one. */
export function canCreateTag(model: TaxonomyModel, text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && exactNode(model, trimmed) === null;
}
