import { z } from 'zod';
import { defineChannels, defineEvents } from '../registry.js';

/**
 * Something the user must be told about at startup, produced by the main process.
 * Notices never carry file contents or secrets: only a reason code and short, value-free details.
 */
export const appNoticeSchema = z.discriminatedUnion('kind', [
  /** settings.json was unreadable or invalid: it was kept aside and the app restarted from defaults. */
  z.object({
    id: z.string(),
    kind: z.literal('settings-reset'),
    reason: z.enum(['invalid-json', 'invalid-schema']),
    /** File name (not path) of the preserved copy, next to settings.json. */
    backupName: z.string().optional(),
    /** Paths of the offending fields (no values), at most 10. */
    fields: z.array(z.string()).default([]),
  }),
  /** settings.json comes from a newer version of the app: it is not modified and changes are refused. */
  z.object({
    id: z.string(),
    kind: z.literal('settings-read-only'),
    foundVersion: z.number(),
    supportedVersion: z.number(),
  }),
]);
export type AppNotice = z.infer<typeof appNoticeSchema>;

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
  /** Notices raised since startup and not yet dismissed (the renderer may subscribe too late for the event). */
  notices: { request: z.object({}), response: z.object({ notices: z.array(appNoticeSchema) }) },
  /** The user closed the banner: do not show this notice again in this session. */
  dismissNotice: { request: z.object({ id: z.string() }), response: z.object({}) },
});

export const appEvents = defineEvents('app', {
  notice: appNoticeSchema,
});
