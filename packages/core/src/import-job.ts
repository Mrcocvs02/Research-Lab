import { z } from 'zod';
import { serializedErrorSchema } from './errors.js';

export const importReportSchema = z.object({
  documents: z.number().int().nonnegative(),
  taxonomyNodes: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** Optional detailed counts (additive; filled by the legacy importer). */
  tags: z.number().int().nonnegative().optional(),
  /** Taxonomy nodes by depth: "1" = roots, "2" = children of roots, ... */
  nodesByLevel: z.record(z.string(), z.number().int().nonnegative()).optional(),
  venues: z.number().int().nonnegative().optional(),
  documentTypes: z.number().int().nonnegative().optional(),
  /** Documents whose file was not found on disk (kept with `missing: true`). */
  missing: z.number().int().nonnegative().optional(),
  /** Index records that share the content of an earlier record (same id). */
  duplicates: z.number().int().nonnegative().optional(),
  /** Short human-readable warnings; never document text. */
  warnings: z.array(z.string()).default([]),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const importJobStatusSchema = z.object({
  jobId: z.string(),
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  phase: z.enum(['reading', 'taxonomy', 'documents', 'finalizing']).optional(),
  processed: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().optional(),
  report: importReportSchema.optional(),
  error: serializedErrorSchema.optional(),
});
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

/**
 * One-shot importer of the old index (read-only on the source). Implemented in `@rl/data`.
 * `sourceDir` is an absolute folder that the user picked through the main-process dialog.
 */
export interface LegacyImporter {
  run(options: {
    sourceDir: string;
    libraryRoot: string;
    dataDir: string;
    deviceId: string;
    onProgress?: (status: ImportJobStatus) => void;
    signal?: AbortSignal;
  }): Promise<ImportReport>;
}
