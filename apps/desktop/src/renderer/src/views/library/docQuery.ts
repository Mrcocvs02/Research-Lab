import type { SearchFilters } from '@rl/core';

export const SORTS = ['relevance', 'title', 'author', 'year-desc', 'year-asc', 'added-desc', 'size-desc', 'size-asc'] as const;
export type SortKey = (typeof SORTS)[number];

export type TagMode = 'all' | 'any';

/** Everything the user chose in the library view that decides which documents are listed. */
export interface BrowseState {
  text: string;
  sort: SortKey;
  /** Facet filters (authors, types, venues, study states, years); tags and folders live in the fields below. */
  filters: Omit<SearchFilters, 'tags' | 'tagsAny' | 'tagsExclude' | 'folders' | 'folder' | 'includeSubfolders'>;
  tags: { include: string[]; exclude: string[]; mode: TagMode };
  /** Selected folder (relative path); '' = the library root; null = no folder chosen. */
  folder: string | null;
  includeSub: boolean;
}

/** The starting filter asked by another view (`lib/libraryIntent.ts`), or the empty one. */
export const browseFromIntent = (i: { tags?: string[]; authors?: string[]; docIds?: string[] } | null): BrowseState => {
  const b = initialBrowse();
  if (!i) return b;
  if (i.tags?.length) b.tags = { include: i.tags, exclude: [], mode: 'all' };
  if (i.authors?.length) b.filters = { ...b.filters, authors: i.authors };
  // `docIds` is in the request schema; the search service applies it as D3 / N4 land.
  if (i.docIds?.length) b.filters = { ...b.filters, docIds: i.docIds } as BrowseState['filters'];
  return b;
};

export const initialBrowse = (): BrowseState => ({
  text: '',
  sort: 'relevance',
  filters: {},
  tags: { include: [], exclude: [], mode: 'all' },
  folder: null,
  includeSub: true,
});

export interface QueryPlan {
  /** What goes to the index: every condition is decided by the server (D-122). */
  text: string;
  filters: SearchFilters;
  sort: SortKey;
  /** Stable text of everything that changes the result, to reset the list when it changes. */
  key: string;
}

export function planQuery(s: BrowseState): QueryPlan {
  const filters: SearchFilters = { ...s.filters };
  const { include, exclude, mode } = s.tags;
  if (include.length > 0) {
    // One tag is the same under "all" and "any".
    if (mode === 'any' && include.length > 1) filters.tagsAny = include;
    else filters.tags = include;
  }
  if (exclude.length > 0) filters.tagsExclude = exclude;
  if (s.folder !== null) {
    filters.folder = s.folder;
    filters.includeSubfolders = s.includeSub;
  }
  // An empty text has no relevance: the list falls back to the title order.
  const sort = s.sort === 'relevance' && s.text.trim() === '' ? 'title' : s.sort;
  return { text: s.text, filters, sort, key: JSON.stringify({ t: s.text, f: filters, s: sort }) };
}

/** Turns "show missing documents" on or off (off removes the key, so the filter list stays empty). */
export function withMissing(filters: BrowseState['filters'], on: boolean): BrowseState['filters'] {
  const { includeMissing: _drop, ...rest } = filters;
  return on ? { ...rest, includeMissing: true } : rest;
}

export function hasAnyCondition(s: BrowseState): boolean {
  return (
    s.text.trim() !== '' ||
    Object.keys(s.filters).some((k) => k !== 'includeMissing') ||
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
