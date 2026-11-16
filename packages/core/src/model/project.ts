import { z } from 'zod';
import { studyStateSchema } from './document.js';
import { documentIdSchema, isoDateSchema, itemIdSchema, schemaVersionSchema } from '../common.js';

/** Upper bounds of the free text of a project. */
export const PROJECT_LIMITS = { name: 200, description: 5000, notes: 200_000, note: 2000, members: 20_000 } as const;

export const projectKindSchema = z.enum(['project', 'collection']);
export const projectStatusSchema = z.enum(['active', 'paused', 'done', 'archived']);

export const projectMemberSchema = z.object({
  docId: documentIdSchema,
  addedAt: isoDateSchema,
  /** Free per-member remark (why it is in the project). */
  note: z.string().max(PROJECT_LIMITS.note).optional(),
});

export const readingPlanItemSchema = z.object({
  docId: documentIdSchema,
  order: z.number().int().nonnegative(),
  /** Reading state of this item within the plan (independent of the document's own study state). */
  status: studyStateSchema.optional(),
  due: isoDateSchema.optional(),
  note: z.string().max(PROJECT_LIMITS.note).optional(),
});

/** `<dataDir>/projects/<id>.json` */
export const projectSchema = z.object({
  schemaVersion: schemaVersionSchema,
  id: itemIdSchema,
  /** Bumped by the store at each write (optimistic concurrency). */
  revision: z.number().int().nonnegative().optional(),
  /** Absent = `project`. */
  kind: projectKindSchema.optional(),
  name: z.string().min(1).max(PROJECT_LIMITS.name),
  description: z.string().max(PROJECT_LIMITS.description).default(''),
  status: projectStatusSchema.default('active'),
  members: z.array(projectMemberSchema).max(PROJECT_LIMITS.members).default([]),
  /** User's Markdown notes for the project. */
  notes: z.string().max(PROJECT_LIMITS.notes).default(''),
  readingPlan: z.array(readingPlanItemSchema).max(PROJECT_LIMITS.members).default([]),
  /** Status before archiving (`projects:delete`), restored by `projects:restore`. */
  archivedFrom: projectStatusSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Project = z.infer<typeof projectSchema>;
