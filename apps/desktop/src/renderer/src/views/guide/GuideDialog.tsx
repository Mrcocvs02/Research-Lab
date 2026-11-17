import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { useAiUi, type GuideKind } from '../../lib/aiUi';
import { ShortcutList } from './ShortcutList';
import './guide.css';

/** Tasks of the guide, in the order shown (texts: `guide.tasks.<id>.title` and `.body`). */
export const GUIDE_TASKS = ['addDocs', 'tags', 'read', 'chat', 'network', 'export', 'backup'] as const;

/**
 * The in-app guide (F1 or the palette; D-257, D-262): short, by task, in the interface language; the shortcuts table at
 * the end is generated from the keymap. `kind: 'shortcuts'` (Ctrl+/) shows only the shortcut list. No network, no files.
 */
export function GuideDialog({ kind, onClose }: { kind: GuideKind; onClose(): void }) {
  const { t } = useTranslation();
  const { goTo } = useAiUi();
  const only = kind === 'shortcuts';
  return (
    <Dialog title={only ? t('guide.shortcutsTitle') : t('guide.title')} onClose={onClose} testId={only ? 'shortcuts-dialog' : 'guide-dialog'}>
      <div className="guide-dialog">
        {!only && (
          <>
            <p className="hint">{t('guide.intro')}</p>
            {GUIDE_TASKS.map((id) => (
              <section key={id} data-testid="guide-task" data-task={id}>
                <h3>{t(`guide.tasks.${id}.title`)}</h3>
                <p>{t(`guide.tasks.${id}.body`)}</p>
              </section>
            ))}
            <h3>{t('guide.shortcutsTitle')}</h3>
          </>
        )}
        <ShortcutList />
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              onClose();
              goTo('settings');
            }}
            data-testid="guide-edit-shortcuts"
          >
            {t('guide.editShortcuts')}
          </button>
          <button type="button" className="primary" onClick={onClose} data-testid="guide-close">
            {t('common.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
