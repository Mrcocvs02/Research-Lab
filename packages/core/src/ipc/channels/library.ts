import { z } from 'zod';
import { itemIdSchema, languageSchema, relativePathSchema } from '../../common.js';
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
      /** Folders (relative to the root) whose documents may be sent to the AI. Default: none. */
      aiEnabledFolders: z.array(relativePathSchema).optional(),
      /**
       * Starting taxonomy from a JSON file (taxonomy.json format). MUST come from
       * `dialog:chooseFile` in this session. Omitted: empty taxonomy.
       */
      taxonomyFilePath: z.string().min(1).optional(),
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
  /** Renames the profile and the library name in library.json. Never touches other files. */
  rename: { request: z.object({ libraryId: itemIdSchema, name: z.string().trim().min(1).max(120) }), response: libraryProfileSchema },
  /**
   * Lists the direct sub-folders of `parent` (relative to the root, default the root itself).
   * Target root: `rootPath` (must be dialog-approved; used by the first-run wizard before the
   * library exists) or else the profile of `libraryId` (default: active). Hidden folders
   * (starting with a dot) are not listed. Read-only.
   */
  listFolders: {
    request: z.object({
      rootPath: z.string().min(1).optional(),
      libraryId: itemIdSchema.optional(),
      parent: relativePathSchema.optional(),
    }),
    response: z.object({
      folders: z.array(z.object({ path: relativePathSchema, name: z.string(), hasChildren: z.boolean() })),
    }),
  },
  setConfig: {
    request: z.object({ libraryId: itemIdSchema.optional(), patch: libraryConfigPatchSchema }),
    response: libraryConfigSchema,
  },
});
