import { z } from 'zod';
import { documentTypeSchema, taxonomyFamilySchema, taxonomyNodeSchema, venueSchema } from '../../model/taxonomy.js';
import { itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** How many documents carry a node. */
export const nodeCountsSchema = z.object({
  /** Documents tagged with this node itself. */
  direct: z.number().int().nonnegative(),
  /** Documents that have it directly or through implications (computed, never stored as tags). */
  implied: z.number().int().nonnegative(),
  /** Documents that have it or any descendant (children by `parents`), counting implications. */
  subtree: z.number().int().nonnegative(),
});

/** A node as the interface sees it: no `legacy` (verbatim leftovers of an import), plus the counts. */
export const taxonomyNodeViewSchema = taxonomyNodeSchema.omit({ legacy: true }).extend({ counts: nodeCountsSchema });
export type TaxonomyNodeView = z.infer<typeof taxonomyNodeViewSchema>;

export const taxonomyViewSchema = z.object({
  /** Pass it back as `expectedRevision` to detect that somebody else changed the taxonomy. */
  revision: z.number().int().nonnegative(),
  nodes: z.array(taxonomyNodeViewSchema),
  documentTypes: z.array(documentTypeSchema),
  venues: z.array(venueSchema),
});
export type TaxonomyView = z.infer<typeof taxonomyViewSchema>;

const label = z.string().trim().min(1).max(200);
const aliasList = z.array(z.string().trim().min(1).max(200)).max(200);
const idList = z.array(itemIdSchema).max(200);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * One taxonomy operation. A batch is applied in order, all or nothing. Ids are lower-case slugs; an id
 * not given on `create` is derived from the label. Parents and implications must not form cycles.
 */
export const taxonomyOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), id: itemIdSchema.optional(), label, parents: idList.optional(), aliases: aliasList.optional(), implies: idList.optional(), color: color.optional(), group: z.string().max(100).optional() }),
  z.object({ op: z.literal('rename'), id: itemIdSchema, label }),
  /** Replaces the parents (several allowed; empty = root). */
  z.object({ op: z.literal('move'), id: itemIdSchema, parents: idList }),
  z.object({ op: z.literal('setAliases'), id: itemIdSchema, aliases: aliasList }),
  z.object({ op: z.literal('setImplies'), id: itemIdSchema, implies: idList }),
  /** `null` removes the colour. */
  z.object({ op: z.literal('setColor'), id: itemIdSchema, color: color.nullable() }),
  /** Sets or clears the free grouping hint; `extra:<Name>` puts the tag in the family <Name> of the Map (D-491). */
  z.object({ op: z.literal('setGroup'), id: itemIdSchema, group: z.string().trim().min(1).max(100).nullable() }),
  /** Documents tagged `from` get `into`; `from` disappears and its label and aliases become aliases of `into`. */
  z.object({ op: z.literal('merge'), from: itemIdSchema, into: itemIdSchema }),
  /** Makes a root a family (or clears it with `null`); at most one `keywords` family. */
  z.object({ op: z.literal('setFamily'), id: itemIdSchema, family: taxonomyFamilySchema.nullable() }),
  /** Links the node to a concept of the field vocabulary (`<packId>/<conceptId>`), or unlinks it with `null` (D-516). */
  z.object({ op: z.literal('setPack'), id: itemIdSchema, pack: z.string().min(3).max(120).nullable() }),
  z.object({ op: z.literal('markDistinct'), a: itemIdSchema, b: itemIdSchema }),
  z.object({ op: z.literal('unmarkDistinct'), a: itemIdSchema, b: itemIdSchema }),
  z.object({ op: z.literal('deprecate'), id: itemIdSchema }),
  z.object({ op: z.literal('restore'), id: itemIdSchema }),
  /** Only a node that no document uses and no other node refers to. */
  z.object({ op: z.literal('delete'), id: itemIdSchema }),
  z.object({ op: z.literal('addType'), id: itemIdSchema.optional(), label, aliases: aliasList.optional() }),
  z.object({ op: z.literal('addVenue'), id: itemIdSchema.optional(), name: label, aliases: aliasList.optional() }),
]);
export type TaxonomyOp = z.infer<typeof taxonomyOpSchema>;

export const TAXONOMY_LIMITS = { ops: 200 } as const;

export const taxonomyChannels = defineChannels('taxonomy', {
  /** The whole taxonomy with the document counts of each node. */
  get: { request: z.object({}), response: taxonomyViewSchema },
  /**
   * Applies the operations in order, atomically (one invalid operation rejects the batch and nothing changes),
   * and logs them as ONE undoable change. `expectedRevision` is the revision the caller read (CONFLICT otherwise).
   * Errors: NOT_FOUND (unknown node), INVALID_REQUEST (cycle, merge into itself, reserved id, deprecated target),
   * ALREADY_EXISTS (id taken), CONFLICT (`details.conflict` = `revision` | `in-use`).
   */
  apply: {
    request: z.object({ ops: z.array(taxonomyOpSchema).min(1).max(TAXONOMY_LIMITS.ops), expectedRevision: z.number().int().nonnegative().optional() }),
    response: z.object({
      taxonomy: taxonomyViewSchema,
      changeId: z.string(),
      /** The id given to each `create` / `addType` / `addVenue` (`index` = position of the operation in the request). */
      created: z.array(z.object({ index: z.number().int().nonnegative(), id: itemIdSchema })),
      /** Documents whose tags changed (merge). */
      documentsChanged: z.number().int().nonnegative(),
    }),
  },
});
