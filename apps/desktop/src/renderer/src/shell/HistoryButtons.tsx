import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { IconButton } from '../components/IconButton';
import { useHistory } from '../lib/history';
import { useEffectiveShortcuts } from '../lib/keymap';
import { Icon } from './shellIcons';

// The panel with the list of changes is only needed when it is opened.
const HistoryPanel = lazyView(() => import('../lib/HistoryPanel').then((m) => ({ default: m.HistoryPanel })), ['history']);

/** Undo, Redo and History, once for the whole window, in the top bar (3.3). The tooltip says what Undo would undo. */
export function HistoryButtons() {
  const { t } = useTranslation();
  const h = useHistory();
  const keys = useEffectiveShortcuts();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const last = h.items.find((i) => i.mine && i.undoable && !i.undone && i.kind !== 'undo');
  const next = h.items.find((i) => i.mine && i.undone);
  const named = (i: typeof last) => (i ? t(`history.actions.${i.action.replaceAll('.', '_')}`, { defaultValue: i.summary, documents: i.counts.documents, tags: i.counts.taxonomy, projects: i.counts.projects }) : '');
  const undoLabel = last ? `${t('history.undo')}: ${named(last)}` : t('history.undo');
  const redoLabel = next ? `${t('history.redo')}: ${named(next)}` : t('history.redo');
  return (
    <div className="history-controls" role="group" aria-label={t('history.title')}>
      <IconButton label={undoLabel} keys={keys['history.undo'] ?? undefined} disabled={!h.canUndo || h.busy} disabledReason={t('history.nothingToUndo')} onClick={() => void h.undo()} data-testid="undo-button">
        <Icon name="undo" />
      </IconButton>
      <IconButton label={redoLabel} keys={keys['history.redo'] ?? undefined} disabled={!h.canRedo || h.busy} disabledReason={t('history.nothingToRedo')} onClick={() => void h.redo()} data-testid="redo-button">
        <Icon name="redo" />
      </IconButton>
      {/* A plain button with the classes of IconButton: the popover needs a ref to anchor to. */}
      <button
        ref={anchor}
        type="button"
        className={open ? 'rl-iconbtn rl-iconbtn--ghost rl-iconbtn--md is-pressed' : 'rl-iconbtn rl-iconbtn--ghost rl-iconbtn--md'}
        aria-label={t('history.title')}
        title={t('history.title')}
        aria-pressed={open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        data-testid="history-toggle"
      >
        <Icon name="history" />
      </button>
      {open && (
        <Lazy>
          <HistoryPanel id={panelId} anchor={anchor} onClose={() => setOpen(false)} />
        </Lazy>
      )}
    </div>
  );
}
