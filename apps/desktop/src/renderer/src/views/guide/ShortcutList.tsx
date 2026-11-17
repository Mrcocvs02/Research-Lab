import { useTranslation } from 'react-i18next';
import { SHORTCUT_COMMANDS, SHORTCUT_IDS } from '@rl/core';
import { useEffectiveShortcuts } from '../../lib/keymap';
import '../../settings/shortcuts.css';

const SCOPES = ['global', 'reader'] as const;

/** The shortcuts in force, generated from `SHORTCUT_COMMANDS` (so the list can never drift from the keymap). */
export function ShortcutList() {
  const { t } = useTranslation();
  const keys = useEffectiveShortcuts();
  return (
    <div data-testid="shortcut-list">
      {SCOPES.map((scope) => (
        <div key={scope}>
          <h4>{t(`shortcuts.scope.${scope}`)}</h4>
          <table className="shortcut-table">
            <caption className="sr-only">{t(`shortcuts.scope.${scope}`)}</caption>
            <tbody>
              {SHORTCUT_IDS.filter((id) => SHORTCUT_COMMANDS[id].scope === scope).map((id) => (
                <tr key={id} data-command={id}>
                  <th scope="row">{t(`shortcuts.commands.${id}`)}</th>
                  <td>
                    {keys[id] ? (
                      <kbd className="kbd" data-testid="shortcut-list-key">
                        {keys[id]}
                      </kbd>
                    ) : (
                      <span className="hint">{t('shortcuts.off')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="hint">{t('shortcuts.fixed')}</p>
    </div>
  );
}
