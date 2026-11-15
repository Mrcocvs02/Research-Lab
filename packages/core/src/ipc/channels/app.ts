import { z } from 'zod';
import { defineChannels } from '../registry.js';

export const appChannels = defineChannels('app', {
  info: {
    request: z.object({}),
    response: z.object({
      name: z.string(),
      version: z.string(),
      platform: z.string(),
      electron: z.string(),
    }),
  },
});
