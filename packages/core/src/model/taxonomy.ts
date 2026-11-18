import { z } from 'zod';
import { isoDateSchema, itemIdSchema, legacySchema, schemaVersionSchema } from '../common.js';

/**
 * Upper bounds of a taxonomy file (the file is synced and untrusted). Texts and per-node lists match what the
 * `taxonomy:apply` channel accepts; the totals are far above any real library.
 */
export const TAXONOMY_FILE_LIMITS = { nodes: 50_000, types: 2_000, venues: 20_000, label: 200, aliases: 500, links: 200, mergedFrom: 5_000, group: 100 } as const;
const L = TAXONOMY_FILE_LIMITS;
const labelText = z.string().min(1).max(L.label);
const aliasList = z.array(z.string().max(L.label)).max(L.aliases);

export const taxonomyNodeStatusSchema = z.enum(['active', 'candidate', 'deprecated']);
export const taxonomyOriginSchema = z.enum(['user', 'ai', 'import']);

/**
 * A taxonomy node. Levels are free: depth is defined by `parents` only
 * (no parents = root, e.g. a former "macro"). Multiple parents are allowed (DAG).
 * Documents reference nodes by id.
 */
export const taxonomyNodeSchema = z.object({
  id: itemIdSchema,
  label: labelText,
  parents: z.array(itemIdSchema).max(L.links).default([]),
  aliases: aliasList.default([]),
  /** Tagging with this node implies tagging with these nodes (ids). */
  implies: z.array(itemIdSchema).max(L.links).default([]),
  /** One line saying what the node covers (AI-built taxonomies, D-446): feeds the candidate retrieval of the tagging. */
  definition: z.string().max(400).optional(),
  /** Level of an AI-built node: field, subfield, topic, or method/object (D-446). Free for the user's own nodes. */
  level: z.enum(['field', 'subfield', 'topic', 'method']).optional(),
  status: taxonomyNodeStatusSchema.default('active'),
  origin: taxonomyOriginSchema.default('user'),
  /** Display colour, `#rrggbb`. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Ids of nodes merged into this one: a stale reference to them still resolves here. */
  mergedFrom: z.array(itemIdSchema).max(L.mergedFrom).optional(),
  /** Free grouping hint (e.g. imported "macro" | "micro" | "extra:<group>"). Not semantic. */
  group: z.string().max(L.group).optional(),
  createdAt: isoDateSchema.optional(),
  legacy: legacySchema.optional(),
});
export type TaxonomyNode = z.infer<typeof taxonomyNodeSchema>;

export const documentTypeSchema = z.object({
  id: itemIdSchema,
  label: labelText,
  aliases: aliasList.default([]),
});
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const venueSchema = z.object({
  id: itemIdSchema,
  name: labelText,
  aliases: aliasList.default([]),
});
export type Venue = z.infer<typeof venueSchema>;

/** `<dataDir>/taxonomy.json` */
export const taxonomyFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** Monotonic revision, bumped at each change (used for sync conflict hints). */
  revision: z.number().int().nonnegative().default(0),
  nodes: z.array(taxonomyNodeSchema).max(L.nodes).default([]),
  documentTypes: z.array(documentTypeSchema).max(L.types).default([]),
  venues: z.array(venueSchema).max(L.venues).default([]),
  legacy: legacySchema.optional(),
});
export type TaxonomyFile = z.infer<typeof taxonomyFileSchema>;
