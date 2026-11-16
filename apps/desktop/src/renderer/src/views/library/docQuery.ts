import type { SearchFilters } from '@rl/core';
import { docMatchesTag, type TaxonomyModel } from './taxonomyModel';

export const SORTS = ['relevance', 'title', 'author', 'year-desc', 'year-asc', 'added-desc'] as const;
export type SortKey = (typeof SORTS)[number];

export type TagMode = 'all' | 'any';

/** Everything the user chose in the library view that decides which documents are listed. */
export interface BrowseState {
  text: string;
  sort: SortKey;
  /** Facet filters (authors, types, venues, study states, years); tags and folders live in the fields below. */
  filters: Omit<SearchFilters, 'tags' | 'folders'>;
  tags: { include: string[]; exclude: string[]; mode: TagMode };
  /** Selected folder (relative path); '' = the library root; null = no folder chosen. */
  folder: string | null;
  includeSub: boolean;
}

export const initialBrowse = (): BrowseState => ({
  text: '',
  sort: 'relevance',
  filters: {},
  tags: { include: [], exclude: [], mode: 'all' },
  folder: null,
  includeSub: true,
});

/** The minimum a row must carry for the client-side filter. */
export interface FilterableRow {
  path: string;
  tags: readonly string[] | null;
}

export interface QueryPlan {
  /** What goes to the index. */
  text: string;
  filters: SearchFilters;
  sort: Exclude<SortKey, 'relevance'> | 'relevance';
  /**
   * The index cannot express "any of these tags", "not this tag" or "only this folder, not below it" (the contract
   * has "all of" and "folder and below"), so those parts are decided here on the full result: the view then loads
   * every page of the broader query and filters it.
   */
  client: ClientFilter | null;
  /** Stable text of everything that changes the result, to reset the list when it changes. */
  key: string;
}

export interface ClientFilter {
  anyTags: string[];
  excludeTags: string[];
  exactFolder: string | null;
}

export function planQuery(s: BrowseState): QueryPlan {
  const filters: SearchFilters = { ...s.filters };
  const { include, exclude, mode } = s.tags;
  const anyTags = mode === 'any' && include.length > 1 ? include : [];
  if (include.length > 0 && anyTags.length === 0) filters.tags = include;
  if (s.folder) filters.folders = [s.folder];
  const exactFolder = s.folder !== null && !s.includeSub ? s.folder : null;
  const needsClient = anyTags.length > 0 || exclude.length > 0 || exactFolder !== null;
  const client: ClientFilter | null = needsClient ? { anyTags, excludeTags: exclude, exactFolder } : null;
  // An empty text has no relevance: the list falls back to the title order.
  const sort = s.sort === 'relevance' && s.text.trim() === '' ? 'title' : s.sort;
  return { text: s.text, filters, sort, client, key: JSON.stringify({ t: s.text, f: filters, s: sort, c: client }) };
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** Applies the client-side part of a plan to one row (rows without known tags pass the tag tests only when the tests are empty). */
export function passesClient(model: TaxonomyModel, c: ClientFilter, row: FilterableRow): boolean {
  if (c.exactFolder !== null && dirOf(row.path) !== c.exactFolder) return false;
  if (c.anyTags.length === 0 && c.excludeTags.length === 0) return true;
  const tags = row.tags ?? [];
  if (c.anyTags.length > 0 && !c.anyTags.some((t) => docMatchesTag(model, tags, t))) return false;
  if (c.excludeTags.some((t) => docMatchesTag(model, tags, t))) return false;
  return true;
}

export function hasAnyCondition(s: BrowseState): boolean {
  return (
    s.text.trim() !== '' ||
    Object.keys(s.filters).length > 0 ||
    s.tags.include.length > 0 ||
    s.tags.exclude.length > 0 ||
    s.folder !== null
  );
}

/** Adds a tag to the included or excluded list (a tag is in one list at most). */
export function setTagFilter(tags: BrowseState['tags'], id: string, as: 'include' | 'exclude' | null): BrowseState['tags'] {
  const include = tags.include.filter((t) => t !== id);
  const exclude = tags.exclude.filter((t) => t !== id);
  if (as === 'include') include.push(id);
  if (as === 'exclude') exclude.push(id);
  return { ...tags, include, exclude };
}
