import { useCallback, useEffect, useRef, useState } from 'react';

/** How long "✓ Saved" stays next to a control (D-336). */
export const SAVED_MS = 2000;
/** A text field saves this long after the last key press, when its content is valid (or on blur, at once). */
export const TEXT_DELAY_MS = 600;

export interface Save {
  state: 'idle' | 'saved' | 'error';
  /** The value thrown by the last failed save (shown under the field). */
  error: unknown;
  /** Runs one save: "saved" for 2 s on success, "error" until the next try on failure. Resolves to whether it worked. */
  run(fn: () => Promise<unknown>): Promise<boolean>;
  clear(): void;
}

/** The state of one automatically saved control (no Save button anywhere in the settings, D-336). */
export function useAutoSave(): Save {
  const [st, setSt] = useState<{ state: Save['state']; error: unknown }>({ state: 'idle', error: null });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setSt({ state: 'idle', error: null });
  }, []);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    clearTimeout(timer.current);
    try {
      await fn();
      if (live.current) {
        setSt({ state: 'saved', error: null });
        timer.current = setTimeout(() => setSt({ state: 'idle', error: null }), SAVED_MS);
      }
      return true;
    } catch (e) {
      if (live.current) setSt({ state: 'error', error: e });
      return false;
    }
  }, []);
  return { state: st.state, error: st.error, run, clear };
}

/**
 * Draft of a text field: saves on blur or `TEXT_DELAY_MS` after the last key press, only when `validate` finds nothing
 * (it returns the message to show, or undefined); an invalid draft stays on screen with its notice and nothing is
 * saved; leaving the page with a valid draft saves it. A saved value that changes elsewhere replaces a draft that was not edited.
 */
export function useAutoText(value: string, commit: (v: string) => Promise<unknown>, validate?: (v: string) => string | undefined) {
  const save = useAutoSave();
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ draft, commit, validate, save });
  latest.current = { draft, commit, validate, save };

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const l = latest.current;
    if (!dirty.current || l.validate?.(l.draft) !== undefined) return;
    dirty.current = false;
    void l.save.run(() => l.commit(l.draft));
  }, []);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const l = latest.current;
      if (dirty.current && l.validate?.(l.draft) === undefined) void l.commit(l.draft).catch(() => {});
    },
    [],
  );

  const change = (v: string) => {
    dirty.current = v !== value;
    latest.current.draft = v;
    setDraft(v);
    clearTimeout(timer.current);
    save.clear();
    if (dirty.current) timer.current = setTimeout(flush, TEXT_DELAY_MS);
  };
  return { draft, change, flush, problem: dirty.current ? validate?.(draft) : undefined, save };
}
