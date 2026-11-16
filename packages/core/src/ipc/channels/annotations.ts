import { z } from 'zod';
import { documentIdSchema, itemIdSchema } from '../../common.js';
import { ANNOTATION_COLORS, STUDY_LIMITS } from '../../limits.js';
import { annotationSchema, normRectSchema } from '../../model/annotation.js';
import { underlinedSchema } from '../../model/document.js';
import { defineChannels } from '../registry.js';

export const annotationColorSchema = z.enum(ANNOTATION_COLORS);

/** What the reader sends to create (no `id`) or change (`id` of an existing one) an annotation. */
export const annotationInputSchema = z.object({
  id: itemIdSchema.optional(),
  kind: z.enum(['highlight', 'underline']),
  page: z.number().int().positive().max(STUDY_LIMITS.pageMax),
  rects: z.array(normRectSchema).min(1).max(STUDY_LIMITS.rectsPerAnnotation),
  text: z.string().max(STUDY_LIMITS.annotationText).default(''),
  color: annotationColorSchema.default('yellow'),
  comment: z.string().max(STUDY_LIMITS.annotationComment).optional(),
});
export type AnnotationInput = z.input<typeof annotationInputSchema>;

/**
 * Highlights and underlines of a PDF, kept in `annotations/<docId>.json` in the data folder: the PDF itself is never
 * written. Each change re-indexes the document (annotated text is searchable) and updates the "underlined" flag: it
 * follows the annotations (`origin: 'annotations'`) unless the user set it to true by hand (`origin: 'manual'`,
 * value true), which is kept. Emits `library:changed` with kind `annotations`.
 */
export const annotationsChannels = defineChannels('annotations', {
  list: {
    request: z.object({ docId: documentIdSchema }),
    response: z.object({
      annotations: z.array(annotationSchema),
      /** The file changed since the annotations were made (its hash differs): positions may no longer match. */
      stale: z.boolean(),
    }),
  },
  /** Creates or changes one annotation; at most `STUDY_LIMITS.annotationsPerDoc` per document. */
  save: {
    request: z.object({ docId: documentIdSchema, annotation: annotationInputSchema }),
    response: z.object({ annotation: annotationSchema, underlined: underlinedSchema }),
  },
  remove: {
    request: z.object({ docId: documentIdSchema, id: itemIdSchema }),
    response: z.object({ removed: z.boolean(), underlined: underlinedSchema }),
  },
});
