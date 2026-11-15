import { z } from 'zod';
import { isoDateSchema, itemIdSchema, legacySchema, schemaVersionSchema } from '../common.js';

export const taxonomyNodeStatusSchema = z.enum(['active', 'candidate', 'deprecated']);
export const taxonomyOriginSchema = z.enum(['user', 'ai', 'import']);

/**
 * A taxonomy node. Levels are free: depth is defined by `parents` only
 * (no parents = root, e.g. a former "macro"). Multiple parents are allowed (DAG).
 * Documents reference nodes by id.
 */
export const taxonomyNodeSchema = z.object({
  id: itemIdSchema,
  label: z.string().min(1),
  parents: z.array(itemIdSchema).default([]),
  aliases: z.array(z.string()).default([]),
  /** Tagging with this node implies tagging with these nodes (ids). */
  implies: z.array(itemIdSchema).default([]),
  status: taxonomyNodeStatusSchema.default('active'),
  origin: taxonomyOriginSchema.default('user'),
  /** Free grouping hint (e.g. imported "macro" | "micro" | "extra:<group>"). Not semantic. */
  group: z.string().optional(),
  createdAt: isoDateSchema.optional(),
  legacy: legacySchema.optional(),
});
export type TaxonomyNode = z.infer<typeof taxonomyNodeSchema>;

export const documentTypeSchema = z.object({
  id: itemIdSchema,
  label: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const venueSchema = z.object({
  id: itemIdSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});
export type Venue = z.infer<typeof venueSchema>;

/** `<dataDir>/taxonomy.json` */
export const taxonomyFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** Monotonic revision, bumped at each change (used for sync conflict hints). */
  revision: z.number().int().nonnegative().default(0),
  nodes: z.array(taxonomyNodeSchema).default([]),
  documentTypes: z.array(documentTypeSchema).default([]),
  venues: z.array(venueSchema).default([]),
  legacy: legacySchema.optional(),
});
export type TaxonomyFile = z.infer<typeof taxonomyFileSchema>;
