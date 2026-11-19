import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SEARCH_LIMITS } from '@rl/core';
import { useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { useTaxonomy } from './useTaxonomy';

/** Adds and removes tags on documents, creating a tag when the typed text names none. Shared by the card and the bulk editor. */
export function useTagActions() {
  const { t } = useTranslation();
  const { apply } = useTaxonomy();
  const { invalidate } = useLibraryEvents();
  const { info, fail, reportError } = useNotify();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const tag = useCallback(
    async (docIds: string[], change: { add?: string[]; remove?: string[] }): Promise<boolean> => {
      // Only a change of several documents is exclusive (and shows as busy); the card of one document keeps its own order.
      const bulk = docIds.length > 1;
      if (bulk && running.current) return false;
      // One change takes at most `idsMax` documents (what a selection by Ctrl+A holds); a longer range is refused here, with the reason.
      if (docIds.length > SEARCH_LIMITS.idsMax) {
        fail(t('bulk.tooMany', { limit: SEARCH_LIMITS.idsMax, n: docIds.length }));
        return false;
      }
      if (bulk) {
        running.current = true;
        setBusy(true);
      }
      try {
        const r = await rl.invoke('documents:tag', { docIds, ...change });
        invalidate('documents');
        info(t('tags.changed', { count: r.changed }));
        return true;
      } catch (e) {
        reportError(e);
        return false;
      } finally {
        if (bulk) {
          running.current = false;
          setBusy(false);
        }
      }
    },
    [invalidate, info, fail, reportError, t],
  );

  /** Creates the tag at the top level, then puts it on the documents. */
  const createAndAdd = useCallback(
    async (docIds: string[], label: string): Promise<void> => {
      const result = await apply([{ op: 'create', label }]);
      const id = result?.created[0]?.id;
      if (id) await tag(docIds, { add: [id] });
    },
    [apply, tag],
  );
  return { tag, createAndAdd, busy };
}
