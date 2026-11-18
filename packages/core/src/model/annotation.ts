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
  /**
   * Hash of the PDF this annotation was placed on (set at every save). Files written before this field existed have
   * none: such an annotation inherits the file-level `forHash`.
   */
  forHash: sha256Schema.optional(),
  /** Geometry generation: 2 = rectangles computed on the corrected (unstretched) text layer. Absent = legacy, to be repaired. */
  geom: z.literal(2).optional(),
  /**
   * Set once the annotation was written into the PDF (§8.3.10): object number and generation of the annotation object, and
   * `rev`, the hash of the semantic content that was written (the base of the three-way comparison of §8.3.7).
   * `missing`: it was written, and another program took it out of the PDF; it waits for the user's choice and is not written again.
   */
  pdf: z.object({ objNum: z.number().int().positive(), gen: z.number().int().nonnegative(), rev: sha256Schema, missing: z.literal(true).optional() }).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Annotation = z.infer<typeof annotationSchema>;

/** `<dataDir>/annotations/<docId>.json`. Annotations never modify the PDF. */
export const annotationFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  docId: documentIdSchema,
  /** Hash of the PDF when the file was first written; per-annotation `forHash` is the one that counts once present. Never overwritten after it is set. */
  forHash: sha256Schema.optional(),
  annotations: z.array(annotationSchema).default([]),
  /** 'app-only': this document is never written to (after "take them out of the PDF", restore, or the user's choice). */
  pdfMode: z.enum(['app-only']).optional(),
});
export type AnnotationFile = z.infer<typeof annotationFileSchema>;
