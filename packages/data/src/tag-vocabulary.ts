/**
 * The tag vocabulary tools (detector, health, incoming-name resolution; D-493 .. D-497). A subpath of its own so that the code
 * stays out of the chunk every start loads: only the lazy `tag-review` feature (and the import code) imports it. The cleanup
 * rows are the further subpath `@rl/data/tag-cleanup`, a chunk of its own.
 */
export { reviewTags, conventionName, mergeOps, type Proposal, type ReviewResult } from './organize/tag-review.js';
export { tagHealth, tagStats } from './organize/tag-health.js';
export { resolveIncomingLabels, type ResolvedLabels } from './organize/tag-resolve.js';
export type { CleanupInput, CleanupRow, CleanupPlan } from './organize/tag-cleanup.js';
export type { DocEdit } from './organize/taxonomy-ops-ext.js';
