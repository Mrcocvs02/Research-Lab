import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f<>"|?*:]/;

/**
 * Validates a library-relative path coming from an untrusted source and returns its
 * segments. Accepts `/` and `\` as separators. Rejects absolute paths (POSIX, drive,
 * UNC, `\\?\`), `..`, NUL/control chars, `:` (drive letters and NTFS streams) and
 * Windows reserved device names. `.` segments and empty segments are dropped.
 */
export function splitRelativePath(input: unknown): string[] {
  if (typeof input !== 'string') throw new AppError('INVALID_PATH', 'Path must be a string');
  if (input.length > 4096) throw new AppError('INVALID_PATH', 'Path too long');
  if (input.includes('\0')) throw new AppError('INVALID_PATH', 'Path contains NUL');
  if (/^[\\/]/.test(input) || /^[A-Za-z]:/.test(input)) {
    throw new AppError('PATH_OUTSIDE_ROOT', 'Absolute paths are not allowed');
  }
  const segments: string[] = [];
  for (const seg of input.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new AppError('PATH_OUTSIDE_ROOT', 'Parent traversal is not allowed');
    if (FORBIDDEN_CHARS.test(seg)) throw new AppError('INVALID_PATH', 'Path contains forbidden characters');
    if (WINDOWS_RESERVED.test(seg.split('.')[0] ?? '')) throw new AppError('INVALID_PATH', 'Reserved device name');
    segments.push(seg);
  }
  return segments;
}

/** Normalised library-relative path with `/` separators ('' for the root itself). */
export function normalizeRelativePath(input: unknown): string {
  return splitRelativePath(input).join('/');
}

/** True when `target` is `root` or lies under it. Case-insensitive on Windows. Pure string logic. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // different drive / UNC share
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

async function realpathOfDeepestExisting(abs: string): Promise<{ real: string; rest: string[] }> {
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      await lstat(current);
      return { real: await realpath(current), rest: rest.reverse() };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new AppError('IO_ERROR', 'Cannot inspect path', { code: code ?? 'unknown' });
      }
      const parent = path.dirname(current);
      if (parent === current) throw new AppError('IO_ERROR', 'Root does not exist');
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves a library-relative path to an absolute path guaranteed to stay inside `root`,
 * even through symlinks and junctions (realpath of the deepest existing ancestor is
 * checked against the real root). The target itself may not exist yet.
 *
 * Note: this is a check-then-use API; a hostile process racing the filesystem between
 * this call and the use is out of scope (the app only touches user-owned folders).
 */
export async function resolveInRoot(root: string, relative: unknown): Promise<string> {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new AppError('INVALID_PATH', 'Root must be absolute');
  const segments = splitRelativePath(relative);
  const realRoot = await realpath(root).catch(() => {
    throw new AppError('NOT_FOUND', 'Library root does not exist');
  });
  const candidate = path.join(realRoot, ...segments);
  if (!isInside(realRoot, candidate)) throw new AppError('PATH_OUTSIDE_ROOT', 'Path escapes the root');

  const { real, rest } = await realpathOfDeepestExisting(candidate);
  if (!isInside(realRoot, real)) throw new AppError('PATH_OUTSIDE_ROOT', 'Path escapes the root through a link');
  return rest.length ? path.join(real, ...rest) : real;
}

/** Converts an absolute path inside `root` to a `/`-separated relative path; throws if outside. */
export function toRelativePath(root: string, absolute: string): string {
  if (!isInside(root, absolute)) throw new AppError('PATH_OUTSIDE_ROOT', 'Path is outside the root');
  return path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join('/');
}
