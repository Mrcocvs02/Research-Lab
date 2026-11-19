import { normalizeName } from '../normalize.js';
import { conventionName, formKey, splitAcronymName, stemToken, tokenRelation, tokensOf, type ReviewNode } from './tag-review.js';

/** What `resolveIncomingLabels` found for a list of labels coming from an import, the AI or the user (D-497). */
export interface ResolvedLabels {
  /** Incoming label -> id of the existing tag it is (only the sure rules R1, R2 sure, R3, R6). */
  matched: Record<string, string>;
  /** Labels that matched a tag through a new spelling: they become aliases of it. */
  aliasAdds: Array<{ id: string; alias: string }>;
  /** Labels with no match: new tags, to be created with the naming convention (original kept as alias). */
  fresh: string[];
}

const stemKey = (s: string): string => tokensOf(s).map(stemToken).join(' ');

/**
 * Resolves incoming names to the canonical tags of the vocabulary with the sure rules only. Derived (`grp:`) and
 * deprecated nodes are never targets. Pure; one pass over the nodes builds the lookups.
 */
export function resolveIncomingLabels(labels: readonly string[], nodes: ReadonlyArray<Pick<ReviewNode, 'id' | 'label' | 'aliases' | 'status'>>): ResolvedLabels {
  const live = nodes.filter((n) => n.status !== 'deprecated' && !n.id.startsWith('grp:'));
  const exact = new Map<string, string>();
  const byForm = new Map<string, string>();
  const byStem = new Map<string, Array<{ id: string; form: string }>>();
  for (const n of live) {
    for (const f of [n.label, ...n.aliases]) {
      if (!exact.has(normalizeName(f))) exact.set(normalizeName(f), n.id);
      const k = formKey(f);
      if (k && !byForm.has(k)) byForm.set(k, n.id);
      const sk = stemKey(f);
      if (sk) (byStem.get(sk) ?? byStem.set(sk, []).get(sk) ?? []).push({ id: n.id, form: f });
      const sp = splitAcronymName(f);
      // "X (S)" is reachable from X and from S too (R3).
      if (sp) for (const part of [sp.name, sp.acro]) if (!byForm.has(formKey(part))) byForm.set(formKey(part), n.id);
    }
  }
  const matched: Record<string, string> = {};
  const aliasAdds: ResolvedLabels['aliasAdds'] = [];
  const fresh: string[] = [];
  const seenFresh = new Set<string>();
  for (const label of labels) {
    const norm = normalizeName(label);
    if (!norm || label in matched) continue;
    let id = exact.get(norm) ?? byForm.get(formKey(label));
    if (id === undefined) {
      const ta = tokensOf(label);
      for (const c of byStem.get(stemKey(label)) ?? []) {
        const tb = tokensOf(c.form);
        if (ta.length === tb.length && ta.every((t, i) => tokenRelation(t, tb[i] as string) === 2)) {
          id = c.id;
          break;
        }
      }
    }
    if (id === undefined) {
      if (!seenFresh.has(norm)) {
        seenFresh.add(norm);
        fresh.push(label);
      }
      continue;
    }
    matched[label] = id;
    if (exact.get(norm) !== id) aliasAdds.push({ id, alias: label });
  }
  return { matched, aliasAdds, fresh };
}

/** The label a fresh incoming name gets as a new tag (naming convention; the original stays an alias). */
export const freshLabel = conventionName;
