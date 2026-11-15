import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@rl/core';
import { isInside } from '@rl/core/node';

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

/** Copies the whole content of `dataDir` into `targetDir` (created if needed). Returns the file count. */
export async function copyDataDir(dataDir: string, targetDir: string): Promise<{ files: number }> {
  if (isInside(dataDir, targetDir)) throw new AppError('INVALID_PATH', 'The backup folder must be outside the data folder');
  await mkdir(targetDir, { recursive: true });
  await cp(dataDir, targetDir, { recursive: true, force: false, errorOnExist: false });
  return { files: await countFiles(targetDir) };
}

function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
}

/**
 * Full copy of a library data folder into `<backupRoot>/<name>-<yyyymmdd-hhmmssZ>`.
 * To be called before the first real write on an existing data folder.
 * Returns null (and does nothing) when `dataDir` does not exist.
 */
export async function backupDataDir(
  dataDir: string,
  backupRoot: string,
  now: Date = new Date(),
): Promise<{ backupDir: string; files: number } | null> {
  if (!path.isAbsolute(dataDir) || !path.isAbsolute(backupRoot)) throw new AppError('INVALID_PATH', 'Paths must be absolute');
  try {
    if (!(await stat(dataDir)).isDirectory()) return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AppError('IO_ERROR', 'Cannot inspect the data folder', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' });
  }
  const base = `${path.basename(dataDir).replace(/^\.+/, '') || 'data'}-${stamp(now)}`;
  let backupDir = path.join(backupRoot, base);
  for (let i = 2; await stat(backupDir).then(() => true, () => false); i++) backupDir = path.join(backupRoot, `${base}-${i}`);
  const { files } = await copyDataDir(dataDir, backupDir);
  return { backupDir, files };
}
