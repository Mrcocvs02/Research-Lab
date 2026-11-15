import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, schemaVersionSchema, sha256Schema } from '../common.js';

/** Rectangle in page space, normalised to 0..1 of the page width/height (origin top-left). */
export const normRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const annotationSchema = z.object({
  id: itemIdSchema,
  kind: z.enum(['highlight', 'underline']),
  /** 1-based page. */
  page: z.number().int().positive(),
  rects: z.array(normRectSchema).min(1),
  /** Selected text (for search and export). */
  text: z.string().default(''),
  color: z.string().default('yellow'),
  comment: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Annotation = z.infer<typeof annotationSchema>;

/** `<dataDir>/annotations/<docId>.json`. Annotations never modify the PDF. */
export const annotationFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  docId: documentIdSchema,
  /** Hash of the PDF the annotations were made on. */
  forHash: sha256Schema.optional(),
  annotations: z.array(annotationSchema).default([]),
});
export type AnnotationFile = z.infer<typeof annotationFileSchema>;
