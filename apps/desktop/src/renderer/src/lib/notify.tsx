import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import '../components/controls.css';
import '../components/overlays.css';
import { RlError } from './rl-error';
import { errorMessage } from './errors';
import { useLibraryEvents } from './events';
import { Icon } from '../shell/shellIcons';

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
  action?: { label: string; run(): void };
  /** The view that was open when the toast was made: leaving it removes the toast (errors stay, D-358). */
  view: string;
}

interface NotifyValue {
  info(text: string, action?: { label: string; run(): void }): void;
  /** An error message that is not a thrown value (a refused action). */
  fail(text: string): void;
  /** Shows a localised message for any thrown value; a CONFLICT also offers to reload the data. */
  reportError(error: unknown): void;
  /** The shell tells which view is open: toasts of another view go away (an Undo stays in the History). */
  setView(view: string): void;
}

const NOOP: NotifyValue = { info() {}, fail() {}, reportError() {}, setView() {} };
const Ctx = createContext<NotifyValue>(NOOP);
export const useNotify = () => useContext(Ctx);

const LIFETIME_MS = 6000;
/** At most this many at once (the oldest goes first). */
const MAX_TOASTS = 3;

/** Short messages at the bottom right of the window (D-366 rule 4), tied to the view that caused them (D-358). */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { invalidateAll } = useLibraryEvents();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const view = useRef('');
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const stop = (id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  };
  const dismiss = useCallback((id: number) => {
    stop(id);
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);
  const arm = useCallback(
    (id: number) => {
      stop(id);
      timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS));
    },
    [dismiss],
  );
  const push = useCallback(
    (toast: Omit<Toast, 'id' | 'view'>, sticky = false) => {
      const id = next.current++;
      setToasts((cur) => [...cur.slice(1 - MAX_TOASTS), { ...toast, id, view: view.current }]);
      if (!sticky && toast.kind !== 'error') arm(id);
    },
    [arm],
  );
  const setView = useCallback((v: string) => {
    if (view.current === v) return;
    view.current = v;
    setToasts((cur) => {
      const keep = cur.filter((x) => x.kind === 'error' || x.view === v);
      for (const x of cur) if (!keep.includes(x)) stop(x.id);
      return keep.length === cur.length ? cur : keep;
    });
  }, []);

  const value = useMemo<NotifyValue>(
    () => ({
      info: (text, action) => push(action ? { kind: 'info', text, action } : { kind: 'info', text }),
      fail: (text) => push({ kind: 'error', text }),
      reportError: (error) => {
        const conflict = RlError.from(error).code === 'CONFLICT';
        push(conflict ? { kind: 'error', text: errorMessage(error, t), action: { label: t('notify.reload'), run: invalidateAll } } : { kind: 'error', text: errorMessage(error, t) }, conflict);
      },
      setView,
    }),
    [push, t, invalidateAll, setView],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="rl-toasts" role="status" aria-live="polite" data-testid="toasts">
        {toasts.map((x) => {
          return (
            <div
              key={x.id}
              className={x.kind === 'error' ? 'rl-toast rl-toast--error' : 'rl-toast'}
              data-testid="toast"
              data-kind={x.kind}
              onMouseEnter={() => stop(x.id)}
              onMouseLeave={() => x.kind !== 'error' && arm(x.id)}
              onFocus={() => stop(x.id)}
              onBlur={() => x.kind !== 'error' && arm(x.id)}
            >
              <div className="rl-toast__text">{x.text}</div>
              {x.action && (
                <button
                  type="button"
                  className="rl-toast__action"
                  onClick={() => {
                    x.action?.run();
                    dismiss(x.id);
                  }}
                  data-testid="toast-action"
                >
                  {x.action.label}
                </button>
              )}
              <button type="button" className="rl-iconbtn rl-iconbtn--ghost rl-iconbtn--sm" aria-label={t('notify.dismiss')} title={t('notify.dismiss')} onClick={() => dismiss(x.id)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
