import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissHaikuProgress, haikuRunning, useElapsed, useHaikuProgress } from '../lib/haikuProgress';
import { rl } from '../lib/rl';
import { publishActivity, type GenericActivity } from './activityModel';

/**
 * Lists Haiku's run (D-515) in the Activity chip and popover: "Haiku sta decidendo… 120/600" with the call, the time and a Cancel
 * while it runs; the summary (decided, left to the user, errors) when it ends. A source of `publishActivity`, nothing polled.
 */
export function useHaikuActivity(): void {
  const { t } = useTranslation();
  const p = useHaikuProgress();
  const running = haikuRunning(p);
  const elapsed = useElapsed(p?.startedAt, running);
  useEffect(() => {
    if (!p) return publishActivity('tag-haiku', []);
    const left = Math.max(0, p.total - p.decided - p.errors);
    let row: GenericActivity;
    if (running) {
      row = {
        id: 'tag-haiku',
        group: 'running',
        text: t('tax.haiku.progress', { done: p.done, total: p.total }),
        detail: t('tax.haiku.progressDetail', { batch: Math.max(1, p.batch), batches: p.batches, time: elapsed, decided: p.decided }),
        progress: p.total > 0 ? p.done / p.total : undefined,
        action: { label: t('tax.haiku.stop'), run: () => void rl.invoke('tagReview:aiCancel', {}).catch(() => undefined) },
      };
    } else {
      row = {
        id: 'tag-haiku',
        group: p.state === 'failed' || p.errors > 0 ? 'attention' : 'recent',
        text: t(p.state === 'cancelled' ? 'tax.haiku.stopped' : p.state === 'failed' ? 'tax.haiku.failed' : 'tax.haiku.finished'),
        detail: t('tax.haiku.summary', { decided: p.decided, left, errors: p.errors }) + (p.message && p.state === 'failed' ? ` (${p.message})` : ''),
        dismiss: dismissHaikuProgress,
      };
    }
    publishActivity('tag-haiku', [row]);
  }, [p, running, elapsed, t]);
  useEffect(() => () => publishActivity('tag-haiku', []), []);
}
