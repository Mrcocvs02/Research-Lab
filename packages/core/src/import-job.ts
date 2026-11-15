import { z } from 'zod';
import { serializedErrorSchema } from './errors.js';

export const importReportSchema = z.object({
  documents: z.number().int().nonnegative(),
  taxonomyNodes: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
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
