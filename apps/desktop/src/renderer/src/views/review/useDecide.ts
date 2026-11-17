import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf, ResponseOf } from '@rl/core';
import { useLibraryEvents } from '../../lib/events';
import { useHistory } from '../../lib/history';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';

export type DecideRequest = RequestOf<Channels, 'review:decide'>;
export type DecideResult = ResponseOf<Channels, 'review:decide'>;
export type ReviewField = DecideRequest['field'];

/**
 * Review decisions with the app's usual undo affordance: every decision is one logged change, and the notice that
 * confirms it carries an "Undo" action (history:undo of that change). Errors (a stale revision, a field that is no
 * longer proposed) are shown with the invitation to reload.
 */
export function useDecide() {
  const { t } = useTranslation();
  const { info, fail, reportError } = useNotify();
  const { invalidate } = useLibraryEvents();
  const history = useHistory();

  const undoAction = useCallback(
    (changeId: string | null) => (changeId ? { label: t('history.undo'), run: () => void history.undo(changeId) } : undefined),
    [history, t],
  );

  const decide = useCallback(
    async (req: DecideRequest): Promise<DecideResult | null> => {
      try {
        const r = await rl.invoke('review:decide', req);
        invalidate('documents');
        if (r.createdNodeIds.length > 0) invalidate('taxonomy');
        info(t(`review.done_${req.decision}`), undoAction(r.changeId));
        return r;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [info, invalidate, reportError, t, undoAction],
  );

  const decideMany = useCallback(
    async (items: Array<{ docId: string; field: ReviewField }>, decision: 'accept' | 'reject'): Promise<boolean> => {
      try {
        const r = await rl.invoke('review:decideMany', { items, decision });
        invalidate('documents');
        invalidate('taxonomy');
        info(t(`review.many_${decision}`, { count: r.changed }), undoAction(r.changeId));
        if (r.failed.length > 0) fail(t('review.someFailed', { count: r.failed.length }));
        return true;
      } catch (e) {
        reportError(e);
        return false;
      }
    },
    [fail, info, invalidate, reportError, t, undoAction],
  );

  return { decide, decideMany };
}
