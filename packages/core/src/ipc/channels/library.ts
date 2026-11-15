import { z } from 'zod';
import { itemIdSchema, languageSchema } from '../../common.js';
import { dataDirNameSchema, libraryConfigPatchSchema, libraryConfigSchema, libraryProfileSchema } from '../../settings.js';
import { defineChannels } from '../registry.js';

const libraryId = z.object({ libraryId: itemIdSchema });

export const libraryChannels = defineChannels('library', {
  /**
   * Creates a profile and initialises its data dir (library.json with defaults).
   * `rootPath` MUST be a path the main process returned from `dialog:chooseFolder`
   * in this session; anything else is rejected with PERMISSION_DENIED.
   */
  create: {
    request: z.object({
      name: z.string().trim().min(1).max(120),
      rootPath: z.string().min(1),
      language: languageSchema.optional(),
      dataDirName: dataDirNameSchema.optional(),
    }),
    response: libraryProfileSchema,
  },
  list: {
    request: z.object({}),
    response: z.object({ profiles: z.array(libraryProfileSchema), activeLibraryId: itemIdSchema.nullable() }),
  },
  setActive: { request: libraryId, response: z.object({ activeLibraryId: itemIdSchema }) },
  /** Removes the profile only. Never deletes any file. */
  forget: { request: libraryId, response: z.object({ activeLibraryId: itemIdSchema.nullable() }) },
  /** Reads library.json of the given (default: active) library. */
  getConfig: { request: z.object({ libraryId: itemIdSchema.optional() }), response: libraryConfigSchema },
  setConfig: {
    request: z.object({ libraryId: itemIdSchema.optional(), patch: libraryConfigPatchSchema }),
    response: libraryConfigSchema,
  },
});
