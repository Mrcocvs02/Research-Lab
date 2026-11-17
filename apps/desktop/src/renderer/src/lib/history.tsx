import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Lazy, lazyView } from '../components/Lazy';
import { RlError } from './rl-error';
import { useApp } from '../state/app-context';
import { useLibraryEvents } from './events';
import { useNotify } from './notify';
import { rl } from './rl';

export type HistoryItem = ResponseOf<Channels, 'history:list'>['items'][number];

interface HistoryValue {
  items: HistoryItem[];
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  undo(changeId?: string): Promise<void>;
  redo(changeId?: string): Promise<void>;
  refresh(): Promise<void>;
}

const EMPTY: HistoryValue = { items: [], canUndo: false, canRedo: false, busy: false, undo: async () => {}, redo: async () => {}, refresh: async () => {} };
const Ctx = createContext<HistoryValue>(EMPTY);
export const useHistory = () => useContext(Ctx);

/** Text fields keep their own native undo: the global shortcuts leave them alone. */
export function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return false;
}

/** Which key press means undo or redo (Ctrl or Cmd +Z, +Y, +Shift+Z). */
export function historyShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

export function HistoryProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { activeLibraryId } = useApp();
  const { versions, invalidateAll } = useLibraryEvents();
  const { info, reportError } = useNotify();
  const [items, setItems] = useState<HistoryItem[]>([]);
  // `canUndo` / `canRedo` as the main process computes them; absent (older main) the list is used to estimate them.
  const [flags, setFlags] = useState<{ canUndo?: boolean; canRedo?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!activeLibraryId) {
      setItems([]);
      setFlags({});
      return;
    }
    try {
      const r = await rl.invoke('history:list', { limit: 100 });
      setItems(r.items);
      setFlags({ ...(r.canUndo === undefined ? {} : { canUndo: r.canUndo }), ...(r.canRedo === undefined ? {} : { canRedo: r.canRedo }) });
    } catch {
      setItems([]);
      setFlags({});
    }
  }, [activeLibraryId]);

  const changeKey = versions.documents + versions.taxonomy + versions.projects;
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 60);
    return () => clearTimeout(timer);
  }, [refresh, changeKey]);

  const run = useCallback(
    async (kind: 'undo' | 'redo', changeId?: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const r = await rl.invoke(kind === 'undo' ? 'history:undo' : 'history:redo', changeId ? { changeId } : {});
        info(t(kind === 'undo' ? 'history.undone' : 'history.redone', { summary: r.summary }));
        invalidateAll();
      } catch (e) {
        // Nothing to undo is an ordinary answer, not a failure.
        if (RlError.from(e).code === 'NOT_FOUND') info(t(kind === 'undo' ? 'history.nothingToUndo' : 'history.nothingToRedo'));
        else reportError(e);
      } finally {
        busyRef.current = false;
        setBusy(false);
        void refresh();
      }
    },
    [info, reportError, t, invalidateAll, refresh],
  );

  const undo = useCallback((id?: string) => run('undo', id), [run]);
  const redo = useCallback((id?: string) => run('redo', id), [run]);

  useEffect(() => {
    if (!activeLibraryId) return;
    const onKey = (e: KeyboardEvent) => {
      const action = historyShortcut(e);
      if (!action || isTextTarget(e.target)) return;
      e.preventDefault();
      void (action === 'undo' ? undo() : redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeLibraryId, undo, redo]);

  const value = useMemo<HistoryValue>(() => {
    const mine = items.filter((i) => i.mine);
    return {
      items,
      canUndo: flags.canUndo ?? mine.some((i) => i.undoable && !i.undone && i.kind !== 'undo'),
      canRedo: flags.canRedo ?? mine.some((i) => i.undone),
      busy,
      undo,
      redo,
      refresh,
    };
  }, [items, flags, busy, undo, redo, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The panel with the list of changes is only needed when it is opened.
const HistoryPanel = lazyView(() => import('./HistoryPanel').then((m) => ({ default: m.HistoryPanel })), ['history']);

/** Undo and redo buttons plus the "History" panel with the recent changes. */
export function HistoryControls() {
  const { t } = useTranslation();
  const h = useHistory();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="history-controls" role="group" aria-label={t('history.title')}>
      <button type="button" onClick={() => void h.undo()} disabled={!h.canUndo || h.busy} title={t('history.undoHint')} data-testid="undo-button">
        {t('history.undo')}
      </button>
      <button type="button" onClick={() => void h.redo()} disabled={!h.canRedo || h.busy} title={t('history.redoHint')} data-testid="redo-button">
        {t('history.redo')}
      </button>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} data-testid="history-toggle">
        {t('history.title')}
      </button>
      {open && (
        <Lazy>
          <HistoryPanel id={panelId} onClose={() => setOpen(false)} />
        </Lazy>
      )}
    </div>
  );
}
