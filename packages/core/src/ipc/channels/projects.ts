import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { studyStateSchema } from '../../model/document.js';
import { PROJECT_LIMITS, projectKindSchema, projectStatusSchema } from '../../model/project.js';
import { defineChannels } from '../registry.js';

export const studyCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  toRead: z.number().int().nonnegative(),
  reading: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  /** Members whose file is missing from the library or whose record is gone (not counted in the three above). */
  missing: z.number().int().nonnegative(),
});

export const projectSummarySchema = z.object({
  id: itemIdSchema,
  kind: projectKindSchema,
  name: z.string(),
  description: z.string(),
  status: projectStatusSchema,
  revision: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  counts: studyCountsSchema,
});

export const projectMemberViewSchema = z.object({
  docId: documentIdSchema,
  addedAt: isoDateSchema,
  note: z.string().optional(),
  /** False when no record with this id exists any more (the member stays listed so nothing is lost silently). */
  known: z.boolean(),
  /** The file is not found by the last scan. */
  missing: z.boolean(),
  title: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  /** Relative to the library root; null when `known` is false. */
  path: relativePathSchema.nullable(),
  studyState: studyStateSchema.nullable(),
});

export const readingPlanItemViewSchema = z.object({
  docId: documentIdSchema,
  order: z.number().int().nonnegative(),
  /** The document's own study state (same as `studyState`; kept for older callers). Change it with `documents:update`. */
  status: studyStateSchema.optional(),
  due: isoDateSchema.optional(),
  note: z.string().optional(),
  /** The document's own study state (null when unknown). */
  studyState: studyStateSchema.nullable(),
  title: z.string().nullable(),
  missing: z.boolean(),
});

export const projectDetailSchema = z.object({
  project: projectSummarySchema.extend({ notes: z.string(), archivedFrom: projectStatusSchema.optional() }),
  members: z.array(projectMemberViewSchema),
  readingPlan: z.array(readingPlanItemViewSchema),
  /** Present on responses of operations that changed something. */
  changeId: z.string().optional(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

const name = z.string().trim().min(1).max(PROJECT_LIMITS.name);
const docIds = z.array(documentIdSchema).min(1).max(5000);
const projectId = z.object({ projectId: itemIdSchema });

export const projectsChannels = defineChannels('projects', {
  /** Projects and collections with their study counts; archived ones only with `includeArchived` (or `status: 'archived'`). */
  list: {
    request: z.object({ kind: projectKindSchema.optional(), status: projectStatusSchema.optional(), includeArchived: z.boolean().optional() }),
    response: z.object({ items: z.array(projectSummarySchema) }),
  },
  get: { request: z.object({ id: itemIdSchema }), response: projectDetailSchema },
  create: {
    request: z.object({
      id: itemIdSchema.optional(),
      kind: projectKindSchema.optional(),
      name,
      description: z.string().max(PROJECT_LIMITS.description).optional(),
      notes: z.string().max(PROJECT_LIMITS.notes).optional(),
      status: projectStatusSchema.optional(),
      /** Initial members (any folder). */
      docIds: z.array(documentIdSchema).max(5000).optional(),
    }),
    response: projectDetailSchema,
  },
  update: {
    request: z.object({
      id: itemIdSchema,
      patch: z
        .strictObject({
          kind: projectKindSchema,
          name,
          description: z.string().max(PROJECT_LIMITS.description),
          notes: z.string().max(PROJECT_LIMITS.notes),
          status: projectStatusSchema,
        })
        .partial()
        .refine((p) => Object.keys(p).length > 0, 'empty patch'),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
    response: projectDetailSchema,
  },
  /** Archives the project (status `archived`); nothing is deleted. Undo it with `projects:restore` or `history:undo`. */
  delete: { request: z.object({ id: itemIdSchema }), response: projectDetailSchema },
  /** Brings an archived project back to the status it had. */
  restore: { request: z.object({ id: itemIdSchema }), response: projectDetailSchema },
  addMembers: { request: projectId.extend({ docIds, note: z.string().max(PROJECT_LIMITS.note).optional() }), response: projectDetailSchema },
  removeMembers: { request: projectId.extend({ docIds }), response: projectDetailSchema },
  /** Replaces the reading plan; every item must be a member. A per-item `status` is deprecated and not saved.  Items are kept sorted by `order` (stable). */
  setReadingPlan: {
    request: projectId.extend({
      items: z
        .array(z.object({ docId: documentIdSchema, order: z.number().int().min(0).max(1_000_000), /** @deprecated accepted and ignored: the reading state is the document's (`documents:update`). */ status: studyStateSchema.optional(), due: isoDateSchema.optional(), note: z.string().max(PROJECT_LIMITS.note).optional() }))
        .max(PROJECT_LIMITS.members),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
    response: projectDetailSchema,
  },
});
