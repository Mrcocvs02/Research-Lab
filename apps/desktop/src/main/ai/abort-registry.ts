/**
 * Calls to the model that are not jobs or chat turns (the inbox's tag proposal) register here, so that what ends every
 * job (app quit, another library opened: `abortAllJobs`) ends them too and the Claude Code process does not outlive the library.
 */
const live = new Set<AbortController>();

/** A controller that `abortTracked` aborts; call `release` when the call is over. */
export function trackAbort(): { controller: AbortController; release(): void } {
  const controller = new AbortController();
  live.add(controller);
  return { controller, release: () => void live.delete(controller) };
}

export function abortTracked(): void {
  for (const c of live) c.abort();
  live.clear();
}
