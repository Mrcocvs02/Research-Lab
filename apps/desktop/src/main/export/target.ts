import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@rl/core';
import { atomicWriteFile, isInside } from '@rl/core/node';
import { MANIFEST_FILE, parseManifest, type ExportManifest } from '@rl/export';

export type TargetState = 'new' | 'empty' | 'previous-export' | 'not-empty' | 'other-library';

/** Largest generated or manifest file read back (a hostile folder must not fill the memory). */
const MAX_READ = 16 * 1024 * 1024;

const notFound = (e: unknown) => ['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '');

/**
 * The export folder, and the only place an export writes. Every path is a `/`-separated relative path that is resolved,
 * checked to stay under the folder, and walked component by component: an existing symlink or junction anywhere on the way
 * (the folder itself included) refuses the operation. Nothing is ever deleted; a file is replaced only by an atomic rename
 * of a complete new file, and callers decide which files they may replace.
 */
export class ExportTarget {
  constructor(readonly dir: string) {}

  /** Absolute path of `rel` inside the folder, or INVALID_PATH. Synchronous part of the confinement. */
  private resolve(rel: string): string {
    if (rel === '' || rel.includes('\0') || rel.includes(String.fromCharCode(92)) || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').some((s) => s === '..' || s === '.' || s === '')) {
      throw new AppError('INVALID_PATH', 'Not a path inside the export folder');
    }
    const abs = path.resolve(this.dir, ...rel.split('/'));
    if (!isInside(this.dir, abs) || abs === path.resolve(this.dir)) throw new AppError('INVALID_PATH', 'Path escapes the export folder');
    return abs;
  }

  /** Walks the existing components from the folder down; refuses a link. Returns whether the final path exists. */
  private async checkWalk(abs: string): Promise<boolean> {
    const rel = path.relative(this.dir, abs).split(path.sep);
    let cur = this.dir;
    const root = await lstat(cur).catch((e: unknown) => (notFound(e) ? null : Promise.reject(e)));
    if (root?.isSymbolicLink()) throw new AppError('INVALID_PATH', 'The export folder is a link');
    for (const seg of rel) {
      cur = path.join(cur, seg);
      const st = await lstat(cur).catch((e: unknown) => (notFound(e) ? null : Promise.reject(e)));
      if (!st) return false;
      if (st.isSymbolicLink()) throw new AppError('INVALID_PATH', 'A link inside the export folder is not followed');
    }
    return true;
  }

  /** Text of a file of the folder, or null when it does not exist. */
  async read(rel: string): Promise<string | null> {
    const abs = this.resolve(rel);
    if (!(await this.checkWalk(abs))) return null;
    const st = await stat(abs);
    if (!st.isFile()) throw new AppError('CONFLICT', 'Something that is not a file is in the way', { reason: 'not-a-file' });
    if (st.size > MAX_READ) throw new AppError('CONFLICT', 'A file in the export folder is too large to merge', { reason: 'too-large' });
    return readFile(abs, 'utf8');
  }

  /** Atomically writes `text` (parent folders are created). Callers have already decided the file may be written. */
  async write(rel: string, text: string): Promise<void> {
    const abs = this.resolve(rel);
    await this.checkWalk(abs);
    await atomicWriteFile(abs, text);
  }

  /** Copies a file into the folder without overwriting; false when the target already exists. The source is only read. */
  async copyNew(source: string, rel: string): Promise<boolean> {
    const abs = this.resolve(rel);
    await this.checkWalk(path.dirname(abs));
    await mkdir(path.dirname(abs), { recursive: true });
    if (await this.checkWalk(abs)) return false;
    try {
      await copyFile(source, abs, constants.COPYFILE_EXCL);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }

  /** Creates the folder (and its parents) when missing. */
  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.checkWalk(this.dir);
  }
}

/** What `dir` holds now, and its manifest when it is an export. A link or a file in place of the folder counts as not empty. */
export async function inspectTarget(dir: string, libraryId: string): Promise<{ state: TargetState; manifest: ExportManifest | null }> {
  const st = await lstat(dir).catch((e: unknown) => (notFound(e) ? null : Promise.reject(e)));
  if (!st) return { state: 'new', manifest: null };
  if (st.isSymbolicLink() || !st.isDirectory()) return { state: 'not-empty', manifest: null };
  const names = await readdir(dir);
  if (names.length === 0) return { state: 'empty', manifest: null };
  if (!names.includes(MANIFEST_FILE)) return { state: 'not-empty', manifest: null };
  const info = await lstat(path.join(dir, MANIFEST_FILE));
  if (!info.isFile() || info.size > MAX_READ) return { state: 'not-empty', manifest: null };
  const manifest = parseManifest(await readFile(path.join(dir, MANIFEST_FILE), 'utf8'));
  if (!manifest) return { state: 'not-empty', manifest: null };
  return manifest.libraryId === libraryId ? { state: 'previous-export', manifest } : { state: 'other-library', manifest: null };
}
