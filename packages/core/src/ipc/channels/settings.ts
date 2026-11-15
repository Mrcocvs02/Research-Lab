import { z } from 'zod';
import { appSettingsPatchSchema, appSettingsSchema } from '../../settings.js';
import { defineChannels } from '../registry.js';

export const settingsChannels = defineChannels('settings', {
  /** Current per-machine settings (never includes secrets). */
  get: { request: z.object({}), response: appSettingsSchema },
  /** Patch user profile / UI language. Returns the new settings. */
  set: { request: appSettingsPatchSchema, response: appSettingsSchema },
});
