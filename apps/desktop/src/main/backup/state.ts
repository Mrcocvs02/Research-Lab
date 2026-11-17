import path from 'node:path';
import { atomicWriteJson, readTextFileLimited } from '@rl/core/node';

/**
 * What the backups remember about this computer, in the local app data (never synced, never in a backup): the
 * newest backup seen per library for the destination below, and why the last automatic backup failed.
 */
export interface BackupState {
  destination: string | null;
  lastBackup: Record<string, string>;
  lastAutoError: string | null;
}

const file = (localDataDir: string) => path.join(localDataDir, 'backup-state.json');
const queues = new Map<string, Promise<unknown>>();

export async function readState(localDataDir: string): Promise<BackupState> {
  const empty: BackupState = { destination: null, lastBackup: {}, lastAutoError: null };
  try {
    const v: unknown = JSON.parse(await readTextFileLimited(file(localDataDir), 1024 * 1024));
    if (typeof v !== 'object' || v === null) return empty;
    const o = v as Record<string, unknown>;
    const last: Record<string, string> = {};
    if (typeof o.lastBackup === 'object' && o.lastBackup !== null) {
      for (const [k, val] of Object.entries(o.lastBackup)) if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) last[k] = val;
    }
    return { destination: typeof o.destination === 'string' ? o.destination : null, lastBackup: last, lastAutoError: typeof o.lastAutoError === 'string' ? o.lastAutoError.slice(0, 60) : null };
  } catch {
    return empty;
  }
}

/** Serialised read-modify-write. */
export function updateState(localDataDir: string, mutate: (s: BackupState) => void): Promise<void> {
  const run = async () => {
    const st = await readState(localDataDir);
    mutate(st);
    await atomicWriteJson(file(localDataDir), st);
  };
  const prev = queues.get(localDataDir) ?? Promise.resolve();
  const next = prev.then(run, run);
  queues.set(localDataDir, next.catch(() => {}));
  return next;
}
