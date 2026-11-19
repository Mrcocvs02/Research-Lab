import type { TaxonomyFile } from '@rl/core';

/**
 * Resolver of near-new labels for the cleaning of AI answers (D-496): a label that is a variant of an existing tag by the sure
 * rules maps to that tag. The detector is a lazy subpath, loaded only when an answer is cleaned.
 */
export async function labelResolver(tax: TaxonomyFile | null): Promise<(labels: readonly string[]) => Record<string, string>> {
  if (!tax) return () => ({});
  const { resolveIncomingLabels } = await import('@rl/data/tag-vocabulary');
  return (labels) => resolveIncomingLabels(labels, tax.nodes).matched;
}
