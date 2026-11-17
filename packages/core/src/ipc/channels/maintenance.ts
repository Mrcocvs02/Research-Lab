import { z } from 'zod';
import { itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Rebuildable local data that can be cleaned from the settings (the search index has `index:rebuild`). */
export const MAINTENANCE_TARGETS = ['cache', 'thumbs', 'graph', 'logs'] as const;
export const maintenanceTargetSchema = z.enum(MAINTENANCE_TARGETS);

const bytes = z.number().int().nonnegative();

/**
 * Housekeeping and performance information (plan §8), all local and read-only except `clean`. Nothing here ever lists
 * a document title or an absolute path.
 */
export const maintenanceChannels = defineChannels('maintenance', {
  /** Sizes of the data of a library on this computer and a snapshot of the app process. */
  report: {
    request: z.object({ libraryId: itemIdSchema.optional() }),
    response: z.object({
      documents: z.number().int().nonnegative(),
      /** Bytes of the library data folder (synced) and of the local folders of the library (never synced). */
      dataBytes: bytes,
      local: z.object({ index: bytes, cache: bytes, thumbs: bytes, graph: bytes, chats: bytes }),
      logsBytes: bytes,
      process: z.object({ rssMb: z.number().nonnegative(), heapMb: z.number().nonnegative(), uptimeSec: z.number().nonnegative(), startupMs: z.number().nonnegative().nullable() }),
      /** Worker threads alive right now (scan, graph): they close after 60 s idle. */
      workers: z.number().int().nonnegative(),
    }),
  },
  /**
   * Deletes rebuildable data only (never the library data folder, never the index, chats or settings); the data is
   * recomputed on demand. Returns the bytes freed. CONFLICT `busy` while a scan, graph build or backup is running.
   */
  clean: { request: z.object({ libraryId: itemIdSchema.optional(), targets: z.array(maintenanceTargetSchema).min(1).max(MAINTENANCE_TARGETS.length) }), response: z.object({ freedBytes: bytes }) },
  /** Shows the log folder in the file manager. */
  openLogs: { request: z.object({}), response: z.object({ ok: z.literal(true) }) },
  /**
   * Text for a bug report, copied to the clipboard by main and returned: app, Electron and OS versions, language,
   * counts and sizes, switches (AI, MCP, auto backup on/off). No paths, names, titles, keys or tokens.
   */
  copyDiagnostics: { request: z.object({}), response: z.object({ text: z.string().max(10_000) }) },
});
