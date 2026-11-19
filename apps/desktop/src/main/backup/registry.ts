/**
 * The running backup jobs, kept apart from `service.ts` so the quit hook and the maintenance clean can ask about them
 * without loading the backup code (it is loaded on the first backup call).
 */
interface JobHandle {
  state: string;
  controller: AbortController;
  finished: Promise<void>;
}

/** Set while a job is being started (before it is registered). */
export const starting = new WeakSet<object>();
const registries = new WeakMap<object, Map<string, JobHandle>>();

export function jobRegistry<J extends JobHandle>(s: object): Map<string, J> {
  let m = registries.get(s);
  if (!m) registries.set(s, (m = new Map()));
  return m as Map<string, J>;
}

/** True while a backup job runs (the maintenance clean waits for it). */
export const backupRunning = (s: object): boolean => starting.has(s) || [...jobRegistry(s).values()].some((j) => j.state === 'running');

/** Cancels every running job (app quit); `whenBackupDone` then waits for their clean-up. */
export function cancelAllBackups(s: object): void {
  for (const j of jobRegistry(s).values()) if (j.state === 'running') j.controller.abort();
}

/** Resolves when the running job (if any) has finished (tests, the start-up check, the quit). */
export async function whenBackupDone(s: object): Promise<void> {
  await Promise.all([...jobRegistry(s).values()].map((j) => j.finished));
}
