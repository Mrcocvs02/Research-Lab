import { openTagManager } from '../../lib/libraryIntent';
import { setMapIntent } from '../../lib/mapIntent';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShortcutId } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { Kbd } from '../../components/Kbd';
import { requestAdd } from '../../lib/addRequest';
import { useAiUi } from '../../lib/aiUi';
import { useHistory } from '../../lib/history';
import { useInbox } from '../../lib/inbox';
import { useEffectiveShortcuts } from '../../lib/keymap';
import { useNotify } from '../../lib/notify';
import { canRead, useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { applyTheme, isDarkTheme } from '../../lib/theme';
import { useApp } from '../../state/app-context';
import { searchSettings } from '../../settings/settingsIndex';
import { safeText } from '../library/safeText';
import { ACTION_COMMANDS, PREDEFINED_COMMANDS } from './commands';
import { PALETTE_ACTIONS, filterItems, groupItems, loadRecents, orderByRecent, rememberRecent, type PaletteActionId, type PaletteGroup } from './paletteModel';
import './chat.css';

interface Item {
  id: string;
  label: string;
  group: PaletteGroup;
  prompt: string;
  custom: boolean;
  action?: (typeof ACTION_COMMANDS)[number];
  appAction?: PaletteActionId;
  docId?: string;
  /** A setting of `settingsIndex.ts`: the id the settings page focuses. */
  settingId?: string;
  openable?: boolean;
  shortcut?: ShortcutId;
  /** Shown instead of running when the item cannot be used now (never hidden: 17.1). */
  disabledReason?: string;
}

/**
 * Command palette (Ctrl+K, 3.4): documents (from two letters), go to, actions, and the commands for Claude, predefined
 * and the user's own. Without text: the recent entries and the go-to and action groups. Search ignores case and accents.
 * Choosing a prompt command puts its text in the chat prompt and opens the panel; it never sends anything.
 */
export function Palette({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { fillPrompt, setChatOpen, openExport, selection, goTo, openGuide, setActivityOpen } = useAiUi();
  const app = useApp();
  const history = useHistory();
  const inbox = useInbox();
  const { openReader } = useReader();
  const { reportError } = useNotify();
  const keys = useEffectiveShortcuts();
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [custom, setCustom] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Item[]>([]);
  // "Resume reading" is offered only when there is something to resume.
  const [resume, setResume] = useState<{ docId: string; page: number | null } | null>(null);
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
      (r) => live && setCustom(r.items.map((c) => ({ id: `user-${c.id}`, label: c.label, prompt: c.prompt, custom: true, group: 'claude' as const }))),
      () => {}, // the user's commands are optional: the predefined ones still work
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    if (app.activeProfile)
      rl.invoke('resume:get', {}).then(
        (r) => live && setResume(r.last ? { docId: r.last.docId, page: r.last.page } : null),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [app.activeProfile]);

  // Documents: from two characters, 150 ms after the last key, at most 8 (local search only).
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2 || !app.activeProfile) return setDocs([]);
    let live = true;
    const timer = setTimeout(() => {
      rl.invoke('search:query', { text, limit: 8 }).then(
        (r) => live && setDocs(r.hits.map((h) => ({ id: `doc-${h.docId}`, label: h.title ?? h.path.split(/[\/]/).pop() ?? h.docId, group: 'docs' as const, prompt: '', custom: false, docId: h.docId, openable: canRead(h.path, false) }))),
        () => live && setDocs([]),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, app.activeProfile]);

  const hasLibrary = app.activeProfile !== null;
  const noLibrary = t('chat.paletteNoLibrary');
  const items = useMemo<Item[]>(() => {
    const other = app.settings?.uiLanguage === 'en' ? 'it' : 'en';
    const reason = (id: PaletteActionId): string | undefined => {
      if (id === 'undo') return !hasLibrary ? noLibrary : history.canUndo ? undefined : t('history.nothingToUndo');
      if (id === 'redo') return !hasLibrary ? noLibrary : history.canRedo ? undefined : t('history.nothingToRedo');
      if (['scanNow', 'backupNow', 'addPdf', 'addFromId', 'addResource', 'goReview', 'goProjects', 'goDiscover', 'goMap', 'manageTags', 'tidyTags', 'reviewTags', 'macroPropose'].includes(id) && !hasLibrary) return noLibrary;
      return undefined;
    };
    const actions: Item[] = PALETTE_ACTIONS.filter((a) => a.id !== 'resume' || resume !== null).map((a) => ({
      id: `app-${a.id}`,
      label: t(`chat.commands.${a.id}.label`, { language: t(`languages.${other}`) }),
      prompt: '',
      custom: false,
      group: a.group,
      appAction: a.id,
      ...('shortcut' in a ? { shortcut: a.shortcut } : {}),
      ...(reason(a.id) ? { disabledReason: reason(a.id)! } : {}),
    }));
    const prompts: Item[] = [
      ...PREDEFINED_COMMANDS.map((id) => ({ id, label: t(`chat.commands.${id}.label`), prompt: t(`chat.commands.${id}.prompt`), custom: false, group: 'claude' as const })),
      ...ACTION_COMMANDS.map((id) => ({ id, label: t(`chat.commands.${id}.label`), prompt: '', custom: false, action: id, group: 'claude' as const })),
      ...custom,
    ];
    // Settings (3.4): any entry of the index whose label, synonyms, section or group matches (at most 5).
    const settings: Item[] = searchSettings(query, (k) => t(k), 5).map((m) => ({ id: `set-${m.entry.id}`, label: `${m.label} · ${m.where}`, group: 'settings' as const, prompt: '', custom: false, settingId: m.entry.id }));
    return groupItems(filterItems(orderByRecent([...actions, ...prompts], recents), query), { query, recents, docs: [...docs, ...settings] });
  }, [t, custom, docs, query, recents, app.settings?.uiLanguage, hasLibrary, noLibrary, history.canUndo, history.canRedo, resume]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);

  const runApp = (id: PaletteActionId) => {
    switch (id) {
      case 'goLibrary':
        return goTo('library');
      case 'goReview':
        return goTo('review');
      case 'goProjects':
        return goTo('projects');
      case 'goDiscover':
        return goTo('discover');
      case 'goMap':
        return goTo('map');
      case 'goSettings':
        return goTo('settings');
      case 'manageTags':
        return openTagManager(() => goTo('library'), 'manage');
      case 'tidyTags':
        return openTagManager(() => goTo('library'), 'cleanup');
      case 'reviewTags':
        return openTagManager(() => goTo('library'), 'review');
      case 'macroPropose':
        setMapIntent({ macro: true });
        return goTo('network');
      case 'openActivity':
        return setActivityOpen(true);
      case 'scanNow':
        return void rl.invoke('scan:start', { full: false }).then(() => setActivityOpen(true), reportError);
      case 'backupNow':
        return goTo('settings', { focus: 'backup', run: 'backupNow' });
      case 'addPdf':
        return void inbox.choose();
      case 'addFromId':
        return requestAdd({ kind: 'id' });
      case 'addResource':
        return requestAdd({ kind: 'resource' });
      case 'resume':
        return resume ? openReader(resume.docId, resume.page ?? undefined) : undefined;
      case 'newLibrary':
        return goTo('newLibrary');
      case 'undo':
        return void history.undo();
      case 'redo':
        return void history.redo();
      case 'theme': {
        const next = isDarkTheme() ? 'light' : 'dark';
        applyTheme(next);
        return void rl.invoke('settings:set', { appearance: { theme: next } }).catch(reportError);
      }
      case 'openGuide':
        return openGuide('guide');
      case 'showShortcuts':
        return openGuide('shortcuts');
      case 'switchLanguage':
        return void app.setUiLanguage(app.settings?.uiLanguage === 'en' ? 'it' : 'en').catch(() => {});
    }
  };

  const choose = (item: Item | undefined) => {
    if (!item || item.disabledReason) return;
    if (item.settingId) {
      onClose();
      goTo('settings', { focus: item.settingId });
      return;
    }
    if (item.docId) {
      onClose();
      if (item.openable) openReader(item.docId);
      else goTo('library');
      return;
    }
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
        className="palette-field"
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
          <Fragment key={`${c.group}:${c.id}`}>
            {(i === 0 || items[i - 1]!.group !== c.group) && (
              <li role="presentation" className="palette-group" data-group={c.group}>
                {t(`chat.paletteGroups.${c.group}`)}
              </li>
            )}
            <li
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === at}
              aria-disabled={c.disabledReason ? true : undefined}
              title={c.disabledReason}
              className={i === at ? 'palette-item on' : 'palette-item'}
              data-testid="palette-item"
              data-command={c.id}
              onMouseEnter={() => setAt(i)}
              onClick={() => choose(c)}
            >
              <span>{safeText(c.label)}</span>
              {c.custom && <span className="badge">{t('chat.paletteCustom')}</span>}
              {c.disabledReason && <span className="palette-why">{c.disabledReason}</span>}
              {c.shortcut && keys[c.shortcut] && <Kbd>{keys[c.shortcut]}</Kbd>}
            </li>
          </Fragment>
        ))}
        {items.length === 0 && <li className="hint">{t('chat.paletteNone')}</li>}
      </ul>
      {/* The sentence about filling the message box is true only for the commands for Claude. */}
      {items[at]?.group === 'claude' && <p className="hint">{t('chat.paletteHint')}</p>}
    </Dialog>
  );
}
