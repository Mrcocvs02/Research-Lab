/** How many tag diamonds one expansion of a paper adds (D-491); the rest stays behind a "+N" note. */
export const TOP_TAGS = 8;

/**
 * The tags worth drawing for a paper: heaviest first (the accepted score, 1 for a tag set by hand), then those shared with more papers
 * (they connect, a tag on one paper is a dead end), then by id so the order is stable. Returns the shown tags and how many were left out.
 */
export function topTags(tags: ReadonlyArray<{ id: string; w: number }>, shared: (id: string) => number, cap: number = TOP_TAGS): { shown: string[]; hidden: number } {
  const sorted = [...tags].sort((a, b) => b.w - a.w || shared(b.id) - shared(a.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = Math.max(0, Math.min(cap, sorted.length));
  return { shown: sorted.slice(0, n).map((t) => t.id), hidden: sorted.length - n };
}
