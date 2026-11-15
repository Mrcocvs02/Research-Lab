import { z } from 'zod';
import { itemIdSchema } from '../../common.js';
import { importJobStatusSchema } from '../../import-job.js';
import { defineChannels, defineEvents } from '../registry.js';

export const importChannels = defineChannels('import', {
  /**
   * Starts the one-shot import of an old index into a library. `sourcePath` must come from
   * `dialog:chooseFolder` (purpose legacy-index). Read-only on the source.
   */
  startLegacy: {
    request: z.object({ libraryId: itemIdSchema, sourcePath: z.string().min(1) }),
    response: z.object({ jobId: z.string() }),
  },
  status: { request: z.object({ jobId: z.string() }), response: importJobStatusSchema },
});

export const importEvents = defineEvents('import', {
  progress: importJobStatusSchema,
});
