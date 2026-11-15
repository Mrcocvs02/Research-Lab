import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, schemaVersionSchema } from '../common.js';

export const projectStatusSchema = z.enum(['active', 'paused', 'done', 'archived']);

export const projectMemberSchema = z.object({
  docId: documentIdSchema,
  addedAt: isoDateSchema,
  /** Free per-member remark (why it is in the project). */
  note: z.string().optional(),
});

export const readingPlanItemSchema = z.object({
  docId: documentIdSchema,
  order: z.number().int().nonnegative(),
  due: isoDateSchema.optional(),
  note: z.string().optional(),
});

/** `<dataDir>/projects/<id>.json` */
export const projectSchema = z.object({
  schemaVersion: schemaVersionSchema,
  id: itemIdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  status: projectStatusSchema.default('active'),
  members: z.array(projectMemberSchema).default([]),
  /** User's Markdown notes for the project. */
  notes: z.string().default(''),
  readingPlan: z.array(readingPlanItemSchema).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Project = z.infer<typeof projectSchema>;
