import { z } from 'zod';
import { documentIdSchema, sha256Schema } from '../../common.js';
import { THUMB_LIMITS } from '../../limits.js';
import { defineChannels } from '../registry.js';

/** WebP bytes drawn by the renderer: `RIFF....WEBP`, at most `THUMB_LIMITS.maxBytes`. */
const webpSchema = z.custom<Uint8Array>(
  (v) =>
    v instanceof Uint8Array &&
    v.byteLength >= 16 &&
    v.byteLength <= THUMB_LIMITS.maxBytes &&
    String.fromCharCode(v[0]!, v[1]!, v[2]!, v[3]!) === 'RIFF' &&
    String.fromCharCode(v[8]!, v[9]!, v[10]!, v[11]!) === 'WEBP',
  { message: `a WebP image of at most ${THUMB_LIMITS.maxBytes} bytes` },
);

export const thumbItemSchema = z.object({
  docId: documentIdSchema,
  /** `rl-thumb://thumb/<docId>?v=<hash8>` when a thumbnail of the current content is cached, else `null`. */
  url: z.string().startsWith('rl-thumb://thumb/').nullable(),
  /** No thumbnail yet, and the document is a present PDF: the renderer may draw one and send it with `thumbs:put`. */
  drawable: z.boolean(),
  /** Hash of the current content, to send back with `thumbs:put` (present PDFs only). */
  hash: sha256Schema.optional(),
});

const thumbUrlSchema = z.string().startsWith('rl-thumb://thumb/').nullable();

export const thumbsChannels = defineChannels('thumbs', {
  /**
   * The thumbnails of some documents of the active library (the ones on screen). Nothing is drawn by main: a missing
   * thumbnail of a present PDF comes back with `drawable: true`.
   */
  list: {
    request: z.object({ docIds: z.array(documentIdSchema).min(1).max(THUMB_LIMITS.batch) }),
    response: z.object({ items: z.array(thumbItemSchema) }),
  },
  /**
   * Stores a thumbnail drawn by the renderer for the content with `hash`. When the file changed meanwhile (another
   * hash) nothing is stored and `url` is `null`. Older thumbnails of the same document are removed.
   */
  put: {
    request: z.object({ docId: documentIdSchema, hash: sha256Schema, webp: webpSchema }),
    response: z.object({ url: z.string().startsWith('rl-thumb://thumb/').nullable() }),
  },
  /**
   * Main asks the operating system shell for the thumbnail of a present PDF of the active library (the thumbnail
   * handler of the PDF app, with the system cache) and caches it like a drawn one. `url: null` means the renderer
   * should draw page 1 with pdf.js; `reason` says why: `unsupported` (no API on this platform), `failed` (the call
   * threw or timed out), `generic` (the shell gave a file-type icon or an empty/uniform image, not a page).
   */
  native: {
    request: z.object({ docId: documentIdSchema }),
    response: z.object({ url: thumbUrlSchema, reason: z.enum(['ok', 'unsupported', 'failed', 'generic']) }),
  },
});
