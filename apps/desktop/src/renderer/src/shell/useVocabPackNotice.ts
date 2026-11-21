import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiUi } from '../lib/aiUi';
import { errorMessage } from '../lib/errors';
import { openTagManager } from '../lib/libraryIntent';
import { useNotify } from '../lib/notify';
import { rl } from '../lib/rl';
import { publishActivity } from './activityModel';

const SOURCE = 'vocab-pack-auto';

/**
 * The field vocabulary applied itself (D-565): main says so and the window shows "Vocabolario del campo applicato: N tag riconosciuti ·
 * Annulla · Rivedi" as a row of the Activity panel and as a toast. Undo turns the pack off with its links undone (it never applies itself
 * again); Review opens the field vocabulary dialog on what is left of the pack to take.
 */
export function useVocabPackNotice(): void {
  const { t } = useTranslation();
  const notify = useNotify();
  const { goTo } = useAiUi();
  useEffect(
    () =>
      rl.on('vocabPack:autoApplied', (e) => {
        const text = t('packAuto.text', { count: e.n });
        const review = { label: t('packAuto.review'), run: () => openTagManager(() => goTo('library'), 'pack') };
        const undo = {
          label: t('packAuto.undo'),
          run: () => {
            void rl.invoke('vocabPack:disable', { undo: true }).then(
              (r) => {
                publishActivity(SOURCE, []);
                notify.info(r.stopped ? t('packAuto.stopped', { reason: r.stopped }) : t('packAuto.undone'));
              },
              (err: unknown) => notify.fail(errorMessage(err, t)),
            );
          },
        };
        publishActivity(SOURCE, [{ id: SOURCE, group: 'recent', text, action: review, alt: undo, dismiss: () => publishActivity(SOURCE, []) }]);
        notify.info(text, [undo, review]);
      }),
    [t, notify, goTo],
  );
}
