import { z } from 'zod';
import { defineChannels } from '../registry.js';

/**
 * Commands of the palette that fill the prompt without sending it (plan §5). The predefined ones live in the renderer
 * (translated); these are the ones the user adds: Markdown files in `<dataDir>/commands/*.md` (first line `# Label`,
 * the rest is the prompt; the id is the file name). Read only: the user edits the files.
 */
export const commandsChannels = defineChannels('commands', {
  list: {
    request: z.object({}),
    response: z.object({
      items: z
        .array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/), label: z.string().max(200), prompt: z.string().max(20_000) }))
        .max(200),
    }),
  },
});
