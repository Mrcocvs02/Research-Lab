import type { DocumentRecord } from './document.js';

/**
 * Research-group tags (D-488): the groups (institutions) that authored a paper become a tag family of their own,
 * derived from `record.groups` and never stored among the user's `tags`. The id is `grp:<name>`, so the label is
 * the name itself and no taxonomy node is needed. A user hides one with `record.groupsHidden`.
 */
export const GROUP_TAG_PREFIX = 'grp:';

const clean = (name: string): string => name.replace(/\s+/g, ' ').trim();

export const isGroupTag = (id: string): boolean => id.startsWith(GROUP_TAG_PREFIX);
export const groupTagId = (name: string): string => `${GROUP_TAG_PREFIX}${clean(name)}`;
export const groupTagLabel = (id: string): string => (isGroupTag(id) ? id.slice(GROUP_TAG_PREFIX.length) : id);

/** The group names of a list without repeats (case and spacing ignored; the first spelling wins) and without empty names. */
export function dedupeGroups(names: readonly string[], max = 12): string[] {
  const seen = new Map<string, string>();
  for (const n of names) {
    const c = clean(n);
    if (c !== '' && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].slice(0, max);
}

/** The group tag ids a record shows: its groups minus the ones the user hid. Not part of `areas` (macro-areas come from the topic hierarchy). */
export function visibleGroupTags(rec: Pick<DocumentRecord, 'groups' | 'groupsHidden'>): string[] {
  const hidden = new Set((rec.groupsHidden ?? []).map((n) => clean(n).toLowerCase()));
  return dedupeGroups(rec.groups ?? []).filter((n) => !hidden.has(n.toLowerCase())).map(groupTagId);
}
