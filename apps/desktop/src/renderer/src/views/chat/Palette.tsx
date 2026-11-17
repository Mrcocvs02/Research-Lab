import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { useAiUi } from '../../lib/aiUi';
import { useEffectiveShortcuts } from '../../lib/keymap';
import { useApp } from '../../state/app-context';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { ACTION_COMMANDS, APP_ACTIONS, PREDEFINED_COMMANDS, type AppActionId, type PaletteItem } from './commands';
import { filterItems, loadRecents, orderByRecent, rememberRecent } from './paletteModel';

/**
 * Command palette (Ctrl+K): app actions (views, backup, guide...) and the commands for Claude, predefined and the user's
 * own; search ignores case and accents and recently used entries come first. Choosing a prompt command puts its text in the chat prompt and opens the
 * panel; it never sends anything, so the user can edit the prompt, see the preview and then send.
 */
export function Palette({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { fillPrompt, setChatOpen, openExport, selection, goTo, openGuide } = useAiUi();
  const app = useApp();
  const keys = useEffectiveShortcuts();
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [custom, setCustom] = useState<PaletteItem[]>([]);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The dialog puts the focus on its first control when it opens; the search box takes it right after.
  useEffect(() => {
    const id = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let live = true;
    rl.invoke('commands:list', {}).then(
      (r) => live && setCustom(r.items.map((c) => ({ id: `user-${c.id}`, label: c.label, prompt: c.prompt, custom: true }))),
      () => {}, // the user's commands are optional: the predefined ones still work
    );
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const other = app.settings?.uiLanguage === 'en' ? 'it' : 'en';
    const actions: PaletteItem[] = APP_ACTIONS.map((a) => ({
      id: `app-${a.id}`,
      label: t(`chat.commands.${a.id}.label`, { language: t(`languages.${other}`) }),
      prompt: '',
      custom: false,
      appAction: a.id,
      ...('shortcut' in a ? { shortcut: a.shortcut } : {}),
    }));
    const all: PaletteItem[] = [
      ...PREDEFINED_COMMANDS.map((id) => ({ id, label: t(`chat.commands.${id}.label`), prompt: t(`chat.commands.${id}.prompt`), custom: false })),
      ...ACTION_COMMANDS.map((id) => ({ id, label: t(`chat.commands.${id}.label`), prompt: '', custom: false, action: id })),
      ...custom,
      ...actions,
    ];
    return filterItems(orderByRecent(all, recents), query);
  }, [t, custom, query, recents, app.settings?.uiLanguage]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);

  const runApp = (id: AppActionId) => {
    switch (id) {
      case 'goLibrary':
        return goTo('library');
      case 'goProjects':
        return goTo('projects');
      case 'goNetwork':
        return goTo('network');
      case 'goInbox':
        return goTo('inbox');
      case 'goReview':
        return goTo('review');
      case 'goSettings':
        return goTo('settings');
      case 'newLibrary':
        return goTo('newLibrary');
      case 'backupNow':
        return goTo('settings', { focus: 'backup', run: 'backupNow' });
      case 'openGuide':
        return openGuide('guide');
      case 'showShortcuts':
        return openGuide('shortcuts');
      case 'switchLanguage':
        return void app.setUiLanguage(app.settings?.uiLanguage === 'en' ? 'it' : 'en').catch(() => {});
    }
  };

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    setRecents(rememberRecent(item.id));
    if (item.appAction) {
      onClose();
      runApp(item.appAction);
      return;
    }
    if (item.action === 'exportDialog') {
      // The library selection (if any) is where the export starts from.
      openExport(selection.length > 0 ? { docIds: [...selection] } : {});
      onClose();
      return;
    }
    fillPrompt(item.prompt);
    setChatOpen(true);
    onClose();
  };

  return (
    <Dialog title={t('chat.palette')} onClose={onClose} testId="command-palette">
      <input
        type="search"
        ref={field}
        value={query}
        placeholder={t('chat.paletteSearch')}
        aria-label={t('chat.paletteSearch')}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={items[at] ? `${listId}-${at}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAt((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAt((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(items[at]);
          }
        }}
        data-testid="palette-input"
      />
      <ul id={listId} ref={list} role="listbox" className="palette-list" aria-label={t('chat.palette')}>
        {items.map((c, i) => (
          <li
            key={c.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === at}
            className={i === at ? 'palette-item on' : 'palette-item'}
            data-testid="palette-item"
            data-command={c.id}
            onMouseEnter={() => setAt(i)}
            onClick={() => choose(c)}
          >
            <span>{safeText(c.label)}</span>
            {c.custom && <span className="badge">{t('chat.paletteCustom')}</span>}
            {c.shortcut && keys[c.shortcut] && <kbd className="palette-key">{keys[c.shortcut]}</kbd>}
          </li>
        ))}
        {items.length === 0 && <li className="hint">{t('chat.paletteNone')}</li>}
      </ul>
      <p className="hint">{t('chat.paletteHint')}</p>
    </Dialog>
  );
}
