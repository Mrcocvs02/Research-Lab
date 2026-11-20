import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { useChangeVersion, useLibraryEvents } from '../../../lib/events';
import { useNotify } from '../../../lib/notify';
import { rl } from '../../../lib/rl';
import { publishTagCount } from '../../../lib/tagCount';

export type TagData = ResponseOf<Channels, 'tagReview:get'>;

/**
 * Proposals, health and run state of the vocabulary (`tagReview:get`), kept current with the taxonomy and the documents; with `step`
 * also the rows of that cleanup step. A failed load leaves `data` as it was: the tree works without it.
 */
export function useTagReview(step?: number, enabled = true) {
  const version = useChangeVersion('taxonomy') + useChangeVersion('documents');
  const [data, setData] = useState<TagData | null>(null);
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const d = await rl.invoke('tagReview:get', step ? { step: step as 1 | 2 | 3 | 4 | 5 } : {});
      if (mine === ticket.current) {
        setData(d);
        if (!step) publishTagCount(d.proposals.filter((p) => p.confidence !== 'maybe').length);
      }
    } catch {
      /* shown nowhere: the manager works without the review */
    }
  }, [step]);
  useEffect(() => {
    if (enabled) void load();
  }, [load, version, enabled]);
  return { data, reload: load };
}

/** Writes of the review and the cleanup: one undoable change each; they tell the rest of the app and offer "Undo" in a notice. */
export function useTagChange() {
  const { t } = useTranslation();
  const { invalidate, invalidateAll } = useLibraryEvents();
  const { info, reportError } = useNotify();
  const changed = useCallback(() => {
    invalidate('taxonomy');
    invalidate('documents');
  }, [invalidate]);
  /** Runs a call; a failure is shown and gives null. */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        const r = await fn();
        changed();
        return r;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [changed, reportError],
  );
  const undo = useCallback(
    async (changeId: string) => {
      try {
        const r = await rl.invoke('history:undo', { changeId });
        info(t('history.undone', { summary: r.summary }));
        invalidateAll();
      } catch (e) {
        reportError(e);
      }
    },
    [info, invalidateAll, reportError, t],
  );
  /** A notice with "Undo" for one change. */
  const offerUndo = useCallback((text: string, changeId: string | null | undefined) => info(text, changeId ? { label: t('tax.review.undo'), run: () => void undo(changeId) } : undefined), [info, t, undo]);
  return { run, undo, offerUndo, changed };
}
