import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
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
/**
 * Puts the finished file `from` at `to` only if `to` does not exist: a hard link (atomic, fails with EEXIST), or an exclusive
 * copy where links are not supported (some synced or FAT volumes). `from` is removed afterwards. Returns false when `to` exists.
 */
export async function moveNew(from: string, to: string): Promise<boolean> {
  try {
    await link(from, to);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    if (!['EPERM', 'ENOSYS', 'EXDEV', 'EMLINK', 'ENOTSUP', 'EOPNOTSUPP', 'EACCES'].includes(code ?? '')) throw e;
    try {
      await copyFile(from, to, constants.COPYFILE_EXCL);
    } catch (x) {
      if ((x as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw x;
    }
  }
  await unlink(from).catch(() => {});
  return true;
}

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

  /**
   * Writes `text` as a NEW file: it never replaces one that exists, even one created a moment ago by someone else (the
   * complete file is made under a temporary name and linked into place). Returns false when the name is taken.
   */
  async writeNew(rel: string, text: string | Uint8Array): Promise<boolean> {
    const abs = this.resolve(rel);
    await this.checkWalk(path.dirname(abs));
    await mkdir(path.dirname(abs), { recursive: true });
    if (await this.checkWalk(abs)) return false;
    const tmp = `${abs}.${randomBytes(4).toString('hex')}.part`;
    await writeFile(tmp, text, typeof text === 'string' ? { encoding: 'utf8', flag: 'wx' } : { flag: 'wx' });
    try {
      return await moveNew(tmp, abs);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  /**
   * Copies a source file into the folder (the source is only read). The copy is made under `<name>.part` and renamed once
   * its size is right, so a copy that stops half way never looks complete. An existing file of the same size is the copy
   * already (`unchanged`). A file of another size is replaced only when it is the one the previous export wrote
   * (`knownSize`: the original has changed since); otherwise it is the user's and stays (`kept`).
   */
  async copySource(source: string, rel: string, knownSize: number | undefined): Promise<{ state: 'copied' | 'unchanged' | 'kept'; size: number }> {
    const abs = this.resolve(rel);
    await this.checkWalk(path.dirname(abs));
    await mkdir(path.dirname(abs), { recursive: true });
    const size = (await stat(source)).size;
    if (await this.checkWalk(abs)) {
      const have = await lstat(abs);
      if (!have.isFile()) throw new AppError('CONFLICT', 'Something that is not a file is in the way', { reason: 'not-a-file' });
      if (have.size === size) return { state: 'unchanged', size };
      if (knownSize === undefined || have.size !== knownSize) return { state: 'kept', size: have.size };
    }
    const part = `${abs}.part`;
    await this.checkWalk(part);
    await copyFile(source, part);
    const got = (await stat(part)).size;
    if (got !== (await stat(source)).size) throw new AppError('IO_ERROR', 'The copy is incomplete');
    await rename(part, abs);
    return { state: 'copied', size: got };
  }

  /** Creates the folder (and its parents) when missing. */
  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.checkWalk(this.dir);
  }
}

const nodeCase = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** The real location of `p`: links resolved on the existing part of the path, the rest (not yet created) appended. */
async function realLocation(p: string): Promise<string> {
  const abs = path.resolve(p);
  try {
    return await realpath(abs);
  } catch (e) {
    const parent = path.dirname(abs);
    if (!notFound(e) || parent === abs) throw e;
    return path.join(await realLocation(parent), path.basename(abs));
  }
}

/**
 * Whether `dir` is the library root or inside it, after resolving links and junctions (on the part that exists) and
 * ignoring case on Windows. An export there would write into the library, and its copies and cards would be scanned
 * back in as documents (D-252).
 */
export async function isInsideLibrary(rootPath: string, dir: string): Promise<boolean> {
  const [root, target] = await Promise.all([realLocation(rootPath), realLocation(dir)]);
  return isInside(nodeCase(root), nodeCase(target));
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
