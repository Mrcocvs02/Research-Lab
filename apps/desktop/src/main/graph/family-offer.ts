/**
 * Which tag groups are provenance (where a tag came from) and not a classification (D-499): an import group of the old index, a sidecar
 * file, tags typed by hand. They are tag sources, never offered as a way to group the papers. Matching is on the words of the name.
 */
const SOURCE_WORDS = new Set(['sidecar', 'sidecars', 'import', 'imports', 'imported', 'manual', 'manually', 'legacy', 'source', 'sources', 'unsorted', 'misc']);

export function isSourceFamily(label: string): boolean {
  const words = label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && words.some((w) => SOURCE_WORDS.has(w));
}
