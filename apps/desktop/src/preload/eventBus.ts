/**
 * One `ipcRenderer` listener for every subscriber of the window (W8): each `rl.on` used to add its own listener on the same
 * channel, so a screen with more than ten subscribers made Node warn (MaxListenersExceededWarning). The bus attaches once, when
 * the first listener arrives, and detaches when the last one leaves.
 */
export function createEventBus(attach: (dispatch: (name: string, payload: unknown) => void) => void, detach: (dispatch: (name: string, payload: unknown) => void) => void) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const dispatch = (name: string, payload: unknown) => {
    for (const l of [...(listeners.get(name) ?? [])]) l(payload);
  };
  let attached = false;
  return {
    subscribe(event: string, listener: (payload: unknown) => void): () => void {
      // A wrapper per call so the same function can be subscribed twice and removed independently.
      const own = (p: unknown) => listener(p);
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(own);
      if (!attached) {
        attached = true;
        attach(dispatch);
      }
      return () => {
        const cur = listeners.get(event);
        if (!cur?.delete(own)) return;
        if (cur.size === 0) listeners.delete(event);
        if (listeners.size === 0 && attached) {
          attached = false;
          detach(dispatch);
        }
      };
    },
    /** Number of live listeners (for tests). */
    size: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}
