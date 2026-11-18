import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { ANNOTATION_COLORS, STUDY_LIMITS } from '../../limits.js';
import { annotationSchema, cropMetaSchema, normRectSchema } from '../../model/annotation.js';
import { underlinedSchema } from '../../model/document.js';
import { defineChannels, defineEvents } from '../registry.js';

/** Why a PDF is not (or not yet) written (§8.3.5); `locked` and `unavailable` are waits, not refusals. */
export const pdfReasonSchema = z.enum(['encrypted', 'permission', 'signed', 'xfa', 'damaged', 'read-only', 'too-large', 'too-many-revisions', 'verify-failed', 'locked', 'unavailable', 'changed']);
export type PdfReason = z.infer<typeof pdfReasonSchema>;

/** What the reader shows about the PDF of a document (group PDF of the Study menu). */
export const pdfStateSchema = z.object({
  mode: z.enum(['write', 'app-only', 'off']),
  state: z.enum(['synced', 'pending', 'writing', 'refused', 'none']),
  /** The library has not answered the question "write into the PDFs too?" yet (D-348). */
  needsConsent: z.boolean(),
  /** Annotations without `geom: 2`: never written (§8.1.2). */
  needsRepair: z.number().int().nonnegative(),
  reason: pdfReasonSchema.optional(),
  /** Annotations that are only in the app (not written yet, or never written). */
  appOnly: z.number().int().nonnegative(),
  /** Annotations of other programs found in the PDF (read-only). */
  external: z.number().int().nonnegative().default(0),
  /** Written by us and no longer in the PDF: waiting for the user's choice. */
  missing: z.number().int().nonnegative().default(0),
  lastWrittenAt: isoDateSchema.optional(),
  /** The PDF holds a copy of the original (restore is possible). */
  canRestore: z.boolean().default(false),
  /** Annotations of other programs that a byte-exact restore would drop; present when the PDF was written by us. */
  droppedOnRestore: z.number().int().nonnegative().optional(),
});
export type PdfState = z.infer<typeof pdfStateSchema>;

/** An annotation made by another program, as the reader lists it for the import (J5). `inApp`: an equal one already exists in the app. */
export const externalItemSchema = z.object({
  key: z.string().min(1).max(40),
  kind: z.enum(['highlight', 'underline']),
  page: z.number().int().positive(),
  rects: z.array(normRectSchema).min(1).max(STUDY_LIMITS.rectsPerAnnotation),
  color: z.string().max(20).optional(),
  comment: z.string().max(STUDY_LIMITS.annotationComment).optional(),
  author: z.string().max(200).optional(),
  inApp: z.boolean(),
});
export type ExternalItem = z.infer<typeof externalItemSchema>;

const jobId = z.object({ jobId: z.string().min(1).max(100) });

export const annotationColorSchema = z.enum(ANNOTATION_COLORS);

/**
 * What the reader sends to create (no `id`) or change (`id` of an existing one) an annotation. `text` and `color` have
 * NO schema default: on create a missing `text` is '' and a missing `color` is 'yellow' (the handler decides); on update
 * a missing field keeps the stored value, so a partial update never resets what it does not mention. `comment` is the
 * exception kept from D-188: on update, an omitted `comment` removes the comment.
 */
export const annotationInputSchema = z.object({
  id: itemIdSchema.optional(),
  kind: z.enum(['highlight', 'underline', 'area']),
  page: z.number().int().positive().max(STUDY_LIMITS.pageMax),
  rects: z.array(normRectSchema).min(1).max(STUDY_LIMITS.rectsPerAnnotation),
  text: z.string().max(STUDY_LIMITS.annotationText).optional(),
  color: annotationColorSchema.optional(),
  comment: z.string().max(STUDY_LIMITS.annotationComment).optional(),
  /** `area` only; absent on update keeps the stored value. */
  crop: cropMetaSchema.optional(),
  /**
   * 2 = the rectangles were measured on the corrected text layer (new annotations, repaired ones). Absent on update keeps
   * the stored value; null on update clears it (an undone repair is no longer trustworthy). null on create is ignored.
   */
  geom: z.union([z.literal(2), z.null()]).optional(),
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
  /** State of the PDF of a document: what is written, what waits, why a file is refused. Reads only. */
  pdfState: {
    request: z.object({
      docId: documentIdSchema,
      /** Also count the annotations of other programs that a byte-exact restore would drop (reads the file: only before the restore dialog). */
      inspect: z.boolean().optional(),
    }),
    response: pdfStateSchema,
  },
  /** Writes the pending changes now (the reader sends it when it closes a document). Never throws for a refusal: the state says it. */
  writeNow: { request: z.object({ docId: documentIdSchema }), response: pdfStateSchema },
  /** "Keep only in the app for this document" / "Write again". */
  setPdfMode: { request: z.object({ docId: documentIdSchema, mode: z.enum(['write', 'app-only']) }), response: pdfStateSchema },
  /** The answer of the consent banner or dialog (D-348): 'pdf' sets `writeToPdfConfirmedAt`, 'app-only' turns `writeToPdf` off. */
  confirmPdfWrite: { request: z.object({ choice: z.enum(['pdf', 'app-only']) }), response: z.object({ choice: z.enum(['pdf', 'app-only']), confirmedAt: isoDateSchema.nullable() }) },
  /** Takes the annotations of Research Lab out of the PDF with one more revision (the prefix stays intact); then the document is 'app-only'. */
  removeFromPdf: { request: z.object({ docId: documentIdSchema }), response: pdfStateSchema },
  /** Truncates the file to its original bytes (or restores the safety copy). */
  restoreOriginal: { request: z.object({ docId: documentIdSchema }), response: z.object({ restored: z.boolean(), droppedExternal: z.number().int().nonnegative() }) },
  /** Annotations written by us and taken out of the PDF elsewhere: 'rewrite' writes them again, 'delete' deletes them in the app too. */
  resolveMissing: { request: z.object({ docId: documentIdSchema, choice: z.enum(['rewrite', 'delete']), ids: z.array(itemIdSchema).max(10_000).optional() }), response: pdfStateSchema },
  /** Writes the existing annotations of the whole library into the PDFs, one file at a time (Activity, cancellable). */
  migrate: { request: z.object({}), response: jobId },
  /** Restores every written PDF to its original bytes, one file at a time. */
  restoreAll: { request: z.object({}), response: jobId },
  jobCancel: { request: jobId, response: z.object({}) },
  /** Safety copies of the originals (Advanced): how many, how much space, where. */
  backups: { request: z.object({}), response: z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative(), location: z.enum(['data', 'local']) }) },
  deleteBackups: { request: z.object({}), response: z.object({ deleted: z.number().int().nonnegative() }) },
  /**
   * "Export an annotated copy" (§8.3.14): a copy of the PDF with the annotations of the app written in, in the folder the user picked
   * with `dialog:chooseFolder` (purpose `export-destination`). Works also when writing into the original is off or refused (read-only
   * file, too many revisions, "only in the app"): it writes only the copy and never touches the original. `PERMISSION_DENIED` with
   * `details.reason` when the file cannot be annotated; `CONFLICT` when the file changed meanwhile or the folder is inside the library.
   */
  exportCopy: {
    request: z.object({ docId: documentIdSchema, destination: z.string().min(1).max(4096) }),
    response: z.object({ file: z.string(), annotations: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }),
  },
  /** Highlights and underlines that other programs wrote into the PDF (read only; none of ours). */
  externalList: {
    request: z.object({ docId: documentIdSchema }),
    response: z.object({ items: z.array(externalItemSchema), truncated: z.boolean() }),
  },
  /** "Import into the app": creates app annotations from the listed items (`key` of `externalList`); the PDF is not touched. */
  externalImport: {
    request: z.object({ docId: documentIdSchema, keys: z.array(z.string().min(1).max(40)).min(1).max(500) }),
    response: z.object({ imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }),
  },
  /** What `migrate` would do: files, estimated space of the copies, documents skipped (annotations to check). */
  migrationPlan: { request: z.object({}), response: z.object({ files: z.number().int().nonnegative(), bytes: z.number().nonnegative(), skipped: z.number().int().nonnegative(), written: z.number().int().nonnegative() }) },
});

/** Progress of a write of one document (`docId`) or of a job over the library (`jobId`). */
export const annotationsEvents = defineEvents('annotations', {
  pdfProgress: z.object({
    docId: documentIdSchema.optional(),
    jobId: z.string().optional(),
    state: z.enum(['writing', 'synced', 'pending', 'refused', 'running', 'done', 'cancelled']),
    reason: pdfReasonSchema.optional(),
    done: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  }),
});
