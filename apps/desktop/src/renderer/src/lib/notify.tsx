import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppError } from '@rl/core';
import { errorMessage } from './errors';
import { useLibraryEvents } from './events';

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
  action?: { label: string; run(): void };
}

interface NotifyValue {
  info(text: string): void;
  /** An error message that is not a thrown value (a refused action). */
  fail(text: string): void;
  /** Shows a localised message for any thrown value; a CONFLICT also offers to reload the data. */
  reportError(error: unknown): void;
}

const NOOP: NotifyValue = { info() {}, fail() {}, reportError() {} };
const Ctx = createContext<NotifyValue>(NOOP);
export const useNotify = () => useContext(Ctx);

const LIFETIME_MS = 6000;

/** Short messages in a live region at the bottom of the window. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { invalidateAll } = useLibraryEvents();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((cur) => cur.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, 'id'>, sticky = false) => {
      const id = next.current++;
      setToasts((cur) => [...cur.slice(-3), { ...toast, id }]);
      if (!sticky) setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  const value = useMemo<NotifyValue>(
    () => ({
      info: (text) => push({ kind: 'info', text }),
      fail: (text) => push({ kind: 'error', text }),
      reportError: (error) => {
        const conflict = AppError.from(error).code === 'CONFLICT';
        push(
          conflict
            ? { kind: 'error', text: errorMessage(error, t), action: { label: t('notify.reload'), run: invalidateAll } }
            : { kind: 'error', text: errorMessage(error, t) },
          conflict,
        );
      },
    }),
    [push, t, invalidateAll],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite" data-testid="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={x.kind === 'error' ? 'toast toast-error' : 'toast'} data-testid="toast" data-kind={x.kind}>
            <span>{x.text}</span>
            {x.action && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  x.action?.run();
                  dismiss(x.id);
                }}
                data-testid="toast-action"
              >
                {x.action.label}
              </button>
            )}
            <button type="button" className="icon-button" aria-label={t('notify.dismiss')} onClick={() => dismiss(x.id)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
