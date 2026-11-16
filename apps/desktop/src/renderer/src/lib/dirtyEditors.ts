/**
 * Editors with text the user typed (notes) register here, so that anything that is about to throw their state away
 * (a library switch, the reader closing, the window closing) can first wait until the text is saved (D-197).
 * Tiny on purpose: it lives in the first screen's chunk, the editors in the reader's.
 */
export interface FlushableEditor {
  /** Saves what is typed; resolves true when nothing unsaved is left, false when the text could not be saved. */
  flush(): Promise<boolean>;
  isDirty(): boolean;
}

/** `flushAll` could not save every editor; the typed text is still on screen. */
export class FlushError extends Error {
  constructor() {
    super('Unsaved text could not be saved');
    this.name = 'FlushError';
  }
}

const editors = new Set<FlushableEditor>();

/** Returns the function that unregisters the editor. */
export function registerEditor(editor: FlushableEditor): () => void {
  editors.add(editor);
  return () => void editors.delete(editor);
}

export const hasDirtyEditors = (): boolean => [...editors].some((e) => e.isDirty());

/** Saves every dirty editor (one after the other is not needed: they write different notes). Rejects with `FlushError` if any text is left unsaved. */
export async function flushAll(): Promise<void> {
  const results = await Promise.all([...editors].map((e) => e.flush().catch(() => false)));
  if (results.includes(false)) throw new FlushError();
}

let installed = false;
/**
 * Window close: while something is dirty the close is cancelled, everything is flushed, and the window is closed again;
 * a clean state never blocks (the handler returns at once). If a flush fails the window stays open with the error shown
 * by the editor. Safe to call more than once.
 */
export function installWindowGuard(win: Window = window): void {
  if (installed) return;
  installed = true;
  let closing = false;
  win.addEventListener('beforeunload', (event) => {
    if (closing || !hasDirtyEditors()) return;
    event.preventDefault();
    // Chromium needs a value on `returnValue` for the close to be cancelled.
    event.returnValue = '';
    void flushAll().then(
      () => {
        closing = true;
        win.close();
      },
      () => {},
    );
  });
}

/** Test hook: forget every registered editor and the window guard. */
export function resetEditorsForTests(): void {
  editors.clear();
  installed = false;
}
