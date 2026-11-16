import { z } from 'zod';
import { documentIdSchema, itemIdSchema } from '../../common.js';
import { ANNOTATION_COLORS, STUDY_LIMITS } from '../../limits.js';
import { annotationSchema, normRectSchema } from '../../model/annotation.js';
import { underlinedSchema } from '../../model/document.js';
import { defineChannels } from '../registry.js';

export const annotationColorSchema = z.enum(ANNOTATION_COLORS);

/**
 * What the reader sends to create (no `id`) or change (`id` of an existing one) an annotation. `text` and `color` have
 * NO schema default: on create a missing `text` is '' and a missing `color` is 'yellow' (the handler decides); on update
 * a missing field keeps the stored value, so a partial update never resets what it does not mention. `comment` is the
 * exception kept from D-188: on update, an omitted `comment` removes the comment.
 */
export const annotationInputSchema = z.object({
  id: itemIdSchema.optional(),
  kind: z.enum(['highlight', 'underline']),
  page: z.number().int().positive().max(STUDY_LIMITS.pageMax),
  rects: z.array(normRectSchema).min(1).max(STUDY_LIMITS.rectsPerAnnotation),
  text: z.string().max(STUDY_LIMITS.annotationText).optional(),
  color: annotationColorSchema.optional(),
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
      /** Some annotation was made on another version of the file (its hash differs): positions may no longer match. */
      stale: z.boolean(),
      /**
       * The annotations whose effective hash (their own `forHash`, else the file-level one) differs from the current
       * file. Saving an annotation again re-confirms it (its hash becomes the current one).
       */
      staleIds: z.array(itemIdSchema).default([]),
    }),
  },
  /**
   * Creates or changes one annotation; at most `STUDY_LIMITS.annotationsPerDoc` per document. Refused with
   * INVALID_REQUEST `details {reason: 'annotations-size', limit}` (nothing written) when the file would exceed
   * `STUDY_LIMITS.annotationsFileBytes`. The annotation's `forHash` becomes the current hash; the file-level one is not overwritten.
   */
  save: {
    request: z.object({ docId: documentIdSchema, annotation: annotationInputSchema }),
    response: z.object({ annotation: annotationSchema, underlined: underlinedSchema }),
  },
  remove: {
    request: z.object({ docId: documentIdSchema, id: itemIdSchema }),
    response: z.object({ removed: z.boolean(), underlined: underlinedSchema }),
  },
});
