import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { useAiUi } from '../../lib/aiUi';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { ACTION_COMMANDS, PREDEFINED_COMMANDS, type PaletteItem } from './commands';

/**
 * Command palette (Ctrl+K): predefined and user commands. Choosing one puts its text in the chat prompt and opens the
 * panel; it never sends anything, so the user can edit the prompt, see the preview and then send.
 */
export function Palette({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { fillPrompt, setChatOpen, openExport, selection } = useAiUi();
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
    const all = [
      ...PREDEFINED_COMMANDS.map((id) => ({ id, label: t(`chat.commands.${id}.label`), prompt: t(`chat.commands.${id}.prompt`), custom: false })),
      ...ACTION_COMMANDS.map((id) => ({ id, label: t(`chat.commands.${id}.label`), prompt: '', custom: false, action: id })),
      ...custom,
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((c) => c.label.toLowerCase().includes(q)) : all;
  }, [t, custom, query]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
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
          </li>
        ))}
        {items.length === 0 && <li className="hint">{t('chat.paletteNone')}</li>}
      </ul>
      <p className="hint">{t('chat.paletteHint')}</p>
    </Dialog>
  );
}
