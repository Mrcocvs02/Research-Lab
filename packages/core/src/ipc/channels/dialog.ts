import { z } from 'zod';
import { defineChannels } from '../registry.js';

export const dialogChannels = defineChannels('dialog', {
  /**
   * Opens the OS folder picker in the main process. This is the ONLY way an absolute path
   * enters the renderer; the main process remembers it as "approved" for this session
   * (see `library:create`, `import:startLegacy`). Returns null when cancelled.
   */
  chooseFolder: {
    request: z.object({
      purpose: z.enum(['library-root', 'legacy-index', 'export-destination']),
      /** Dialog title (already localised by the renderer). */
      title: z.string().max(200).optional(),
    }),
    response: z.object({ path: z.string(), name: z.string() }).nullable(),
  },
});
