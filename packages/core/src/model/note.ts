import { z } from 'zod';
import { documentIdSchema, isoDateSchema } from '../common.js';

/**
 * Notes are Markdown files with YAML frontmatter, written only by the user.
 * File note: `notes/<docId>.md`. Page note: `notes/<docId>/p<page>.md`.
 * AI output is never written here.
 */
export const noteFrontmatterSchema = z.object({
  docId: documentIdSchema,
  scope: z.enum(['file', 'page']).default('file'),
  /** 1-based page, required when scope = page. */
  page: z.number().int().positive().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>;

export const noteSchema = z
  .object({
    frontmatter: noteFrontmatterSchema,
    /** Markdown body (without the frontmatter block). */
    body: z.string(),
  })
  .refine((n) => n.frontmatter.scope === 'file' || n.frontmatter.page !== undefined, {
    message: 'page notes need a page',
    path: ['frontmatter', 'page'],
  });
export type Note = z.infer<typeof noteSchema>;
