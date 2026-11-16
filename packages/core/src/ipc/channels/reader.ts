import { z } from 'zod';
import { documentIdSchema, sha256Schema } from '../../common.js';
import { defineChannels } from '../registry.js';

export const readerChannels = defineChannels('reader', {
  /**
   * Opens a document in the in-app reader. Only a present PDF of the active library (others: PERMISSION_DENIED with
   * `details.reason` 'not-pdf' or 'missing'). Answers the `rl-doc://` URL the reader loads (see `DOC_SCHEME`): never a
   * path. The study state is not changed by opening.
   */
  open: {
    request: z.object({ docId: documentIdSchema }),
    response: z.object({ url: z.string().startsWith('rl-doc://doc/'), hash: sha256Schema, title: z.string().nullable() }),
  },
  /**
   * Opens a link clicked in a PDF in the system browser. Only `http:` and `https:` URLs (others: PERMISSION_DENIED);
   * called only on a click of the user, never by the document itself.
   */
  openLink: {
    request: z.object({ url: z.string().url().max(2_000) }),
    response: z.object({ ok: z.literal(true) }),
  },
});
