import { z } from 'zod';

/** Why an index record was left out of an import (stable codes, translated by the UI). */
export const importSkipReasonSchema = z.enum(['invalid-line', 'line-too-long', 'invalid-record', 'unsafe-path', 'outside-root', 'unreadable', 'not-a-file']);
export type ImportSkipReason = z.infer<typeof importSkipReasonSchema>;

export const importSkippedFileSchema = z.object({
  /** Library-relative path as written in the old index (clipped), or empty when the line had none. */
  path: z.string().max(300),
  reason: importSkipReasonSchema,
  /** 1-based line of the old index file, when the record could not be read at all. */
  line: z.number().int().positive().optional(),
});
export type ImportSkippedFile = z.infer<typeof importSkippedFileSchema>;

/**
 * Additions to the legacy import report (to be merged into `importReportSchema` by the owner of `import-job.ts`).
 * The importer already returns them.
 */
export const importReportExtrasSchema = z.object({
  /** Records skipped because of a problem (not the ones already imported), capped; `skipped` holds the full count. */
  skippedFiles: z.array(importSkippedFileSchema).default([]),
  /** The user's own author names from the old index (`settings.self_names`), to offer as author variants of the profile. */
  selfNames: z.array(z.string()).default([]),
});
export type ImportReportExtras = z.infer<typeof importReportExtrasSchema>;
