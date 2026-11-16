import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export interface BackupPolicyOptions {
  /** Copies the data folder into `backupRoot` (`backupDataDir` of `@rl/data`); null when there is nothing to copy. */
  backup(dataDir: string, backupRoot: string): Promise<{ backupDir: string; files: number } | null>;
  /** `<localData>/backups`: one sub-folder per library, one folder per backup. */
  backupsDir: string;
  /** At most one backup per library in this time (default 24 h). */
  minIntervalMs?: number;
  /** Backups kept per library (default 5, the newest). */
  keep?: number;
  now?(): number;
}

export const BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const BACKUP_KEEP = 5;

/** Backup folders of a library, newest first. */
async function listBackups(dir: string): Promise<Array<{ name: string; mtimeMs: number }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of names) {
    try {
      const st = await stat(path.join(dir, name));
      if (st.isDirectory()) out.push({ name, mtimeMs: st.mtimeMs });
    } catch {
      // vanished meanwhile
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Backup of a library's data folder before the scanner writes (rule 1), without piling them up: starting the app
 * again within `minIntervalMs` of the last backup of that library does not copy again (`force` does, e.g. before an
 * import), and only the newest `keep` copies stay. Only folders inside the library's own backup folder are removed.
 */
export function createBackupPolicy(options: BackupPolicyOptions) {
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? BACKUP_MIN_INTERVAL_MS;
  const keep = Math.max(1, options.keep ?? BACKUP_KEEP);
  return async function backupLibrary(libraryId: string, dataDir: string, opts: { force?: boolean } = {}): Promise<{ backupDir: string; files: number } | null> {
    // The library id is a generated id, but never let it leave the backups folder.
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(libraryId)) return null;
    const root = path.join(options.backupsDir, libraryId);
    if (!opts.force) {
      const newest = (await listBackups(root))[0];
      if (newest && now() - newest.mtimeMs < minInterval) return null;
    }
    const made = await options.backup(dataDir, root);
    const all = await listBackups(root);
    for (const old of all.slice(keep)) await rm(path.join(root, old.name), { recursive: true, force: true }).catch(() => {});
    return made;
  };
}
