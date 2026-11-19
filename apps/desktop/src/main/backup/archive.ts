import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rmdir, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  AppError,
  BACKUP_FORMAT_VERSION,
  BACKUP_LIMITS,
  backupManifestSchema,
  endsWithSpaceOrDot,
  isReservedWindowsName,
  type BackupManifest,
} from '@rl/core';
import { isInside } from '@rl/core/node';
import { ZipReader, ZipWriter, type ZipEntry } from './zip.js';

/** Files up to this size are compressed from memory. */
const SMALL_FILE_BYTES = 256 * 1024;
import { LIBRARY_PREFIX, LOCAL_PREFIX } from './names.js';
export { LIBRARY_PREFIX, LOCAL_PREFIX, MANIFEST_NAME, SETTINGS_NAME } from './names.js';
import { MANIFEST_NAME, SETTINGS_NAME } from './names.js';
/** `settings.json` of an archive is small (portable settings only); anything larger is not ours. */
export const MAX_SETTINGS_ENTRY_BYTES = 1024 * 1024;

export interface SourceFile {
  /** Path inside its area, `/` separators. */
  rel: string;
  abs: string;
  size: number;
}

/** Atomic-write leftovers (`.name.<12 hex>.tmp`) are never part of a backup. */
const TMP_NAME = /^\..+\.[0-9a-f]{12}\.tmp$/;

/**
 * Every regular file under `dir` (links and special files are skipped, never followed), sorted per folder. Refuses
 * more than `limit` files (CONFLICT `too-large`). A missing `dir` is an empty list.
 */
export async function collectFiles(dir: string, limit: number): Promise<{ files: SourceFile[]; bytes: number }> {
  const files: SourceFile[] = [];
  let bytes = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return;
      throw e;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of entries) {
      const childAbs = path.join(abs, d.name);
      const childRel = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) await walk(childAbs, childRel);
      else if (d.isFile() && !TMP_NAME.test(d.name)) {
        const st = await lstat(childAbs).catch(() => null);
        if (!st?.isFile()) continue;
        if (files.length >= limit) throw new AppError('CONFLICT', 'The library has too many files for one backup', { reason: 'too-large', limit });
        files.push({ rel: childRel, abs: childAbs, size: st.size });
        bytes += st.size;
      }
    }
  };
  await walk(dir, '');
  return { files, bytes };
}

/** Whether `name` is a safe archive path of a file we write: no traversal, no absolute or drive paths, Windows-safe segments. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || name.length > 1024 || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return false;
  return name.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..' && !/[<>:"|?*\u0000-\u001f]/.test(seg) && !isReservedWindowsName(seg) && !endsWithSpaceOrDot(seg));
}

/** The names an archive may contain (besides the manifest). */
export const isAllowedEntryName = (name: string): boolean => isSafeEntryName(name) && (name === SETTINGS_NAME || name.startsWith(LIBRARY_PREFIX) || name.startsWith(`${LOCAL_PREFIX}chat/`));

/** Pauses (ms) between the attempts to open a file another program holds for a moment (antivirus, sync client). */
const OPEN_RETRY_MS = [50, 100, 200, 400];

/**
 * Opens a source file for reading, or null when it is gone or changed under us (`skip`). A file that is not the one
 * we listed (a different inode, a link, another size between the check and the open) is treated as changed. EPERM and
 * EBUSY are retried with a short backoff, then the backup fails with a clear reason (never a silently incomplete backup).
 */
async function openSource(abs: string, delays: readonly number[]): Promise<FileHandle | null> {
  for (let i = 0; ; i++) {
    try {
      const before = await lstat(abs);
      if (!before.isFile()) return null;
      const fh = await open(abs, 'r');
      const now = await fh.stat().catch(() => null);
      if (!now?.isFile() || now.size !== before.size || (now.ino !== 0 && before.ino !== 0 && now.ino !== before.ino) || (now.dev !== 0 && before.dev !== 0 && now.dev !== before.dev)) {
        await fh.close().catch(() => {});
        return null;
      }
      return fh;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return null;
      if (!['EPERM', 'EBUSY'].includes(code)) throw e;
      if (i >= delays.length) throw new AppError('IO_ERROR', 'A file could not be read because another program is using it', { reason: 'file-locked', code });
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

export interface WriteArchiveInput {
  /** Temporary file to create (the caller renames it once this resolves). */
  tmpFile: string;
  library: SourceFile[];
  local: SourceFile[];
  /** Portable settings (`settings.json` entry), or null. */
  settings: Buffer | null;
  base: Omit<BackupManifest, 'entries' | 'includesLocal' | 'includesSettings' | 'documents'>;
  documents: number;
  signal?: AbortSignal | undefined;
  onBytes?: (n: number) => void;
  /** Test hook: pauses between the attempts to open a locked file. */
  retryDelaysMs?: readonly number[];
}

/** Writes the archive (entries in order, manifest last). Returns the archive size, the number of data entries and the files that vanished meanwhile. */
export async function writeArchive(input: WriteArchiveInput): Promise<{ bytes: number; files: number; skipped: number; manifest: BackupManifest }> {
  const zip = await ZipWriter.create(input.tmpFile);
  try {
    const entries: BackupManifest['entries'] = [];
    let skipped = 0;
    const add = async (src: SourceFile, name: string): Promise<void> => {
      if (input.signal?.aborted) throw new AppError('CANCELLED', 'The backup was cancelled');
      // A file that vanished or changed meanwhile (a sync tool's temporary file) is skipped and counted, not an error.
      const fh = await openSource(src.abs, input.retryDelaysMs ?? OPEN_RETRY_MS);
      if (!fh) {
        skipped++;
        return;
      }
      let r;
      if (src.size <= SMALL_FILE_BYTES) {
        // Most files of a data folder are small JSON or Markdown: read whole, no stream per file (200 000 files stay fast).
        const data = await fh.readFile().finally(() => fh.close().catch(() => {}));
        r = await zip.addBuffer(name, data);
        input.onBytes?.(data.length);
      } else {
        r = await zip.addStream(name, fh.createReadStream(), { signal: input.signal, ...(input.onBytes ? { onChunk: input.onBytes } : {}) });
      }
      entries.push({ path: name, size: r.size, sha256: r.sha256 });
    };
    for (const f of input.library) await add(f, `${LIBRARY_PREFIX}${f.rel}`);
    for (const f of input.local) await add(f, `${LOCAL_PREFIX}chat/${input.base.sourceLibraryId}/${f.rel}`);
    if (input.settings) {
      const r = await zip.addBuffer(SETTINGS_NAME, input.settings);
      entries.push({ path: SETTINGS_NAME, size: r.size, sha256: r.sha256 });
    }
    const manifest: BackupManifest = {
      ...input.base,
      documents: input.documents,
      includesLocal: input.local.length > 0,
      includesSettings: input.settings !== null,
      entries,
    };
    await zip.addBuffer(MANIFEST_NAME, Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'));
    const bytes = await zip.finish();
    return { bytes, files: entries.length, skipped, manifest };
  } catch (e) {
    await zip.abort();
    throw e;
  }
}

/** Reads the manifest (the last entry, at most `BACKUP_LIMITS.manifestBytes`). INVALID_REQUEST `not-a-backup` for anything else. */
export async function openArchive(file: string): Promise<{ reader: ZipReader; manifest: BackupManifest | null; formatVersion: number; header: Record<string, unknown> }> {
  const reader = await ZipReader.open(file, BACKUP_LIMITS.entries + 3);
  const last = reader.entries[reader.entries.length - 1];
  if (!last || last.name !== MANIFEST_NAME) throw new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why: 'manifest' });
  let json: unknown;
  try {
    json = JSON.parse((await reader.read(last, BACKUP_LIMITS.manifestBytes)).toString('utf8'));
  } catch (e) {
    if (e instanceof AppError && e.code === 'CONFLICT') throw new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why: 'manifest-size' });
    throw new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why: 'manifest-json' });
  }
  const header = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  if (header.format !== 'rl-backup' || typeof header.formatVersion !== 'number') throw new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why: 'format' });
  if (header.formatVersion > BACKUP_FORMAT_VERSION) return { reader, manifest: null, formatVersion: header.formatVersion, header };
  const parsed = backupManifestSchema.safeParse(json);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why: 'manifest-schema' });
  return { reader, manifest: parsed.data, formatVersion: header.formatVersion, header };
}

export interface Problem {
  path: string;
  reason: 'missing' | 'size' | 'hash' | 'unreadable' | 'unexpected';
}

export interface VerifyOutcome {
  files: number;
  problemCount: number;
  problems: Problem[];
}

/**
 * Re-reads every entry and compares with the manifest: sizes and SHA-256, entries missing from the archive, entries
 * the manifest does not list, names that are not safe paths (zip-slip) and duplicates. The problem count is exact,
 * the list is cut.
 */
export async function verifyArchive(reader: ZipReader, manifest: BackupManifest, o: { signal?: AbortSignal | undefined; onBytes?: (n: number) => void } = {}): Promise<VerifyOutcome> {
  const problems: Problem[] = [];
  let problemCount = 0;
  const flag = (p: string, reason: Problem['reason']) => {
    problemCount++;
    if (problems.length < BACKUP_LIMITS.problems) problems.push({ path: p.slice(0, 1024), reason });
  };
  const listed = new Map<string, BackupManifest['entries'][number]>();
  for (const e of manifest.entries) {
    if (listed.has(e.path)) flag(e.path, 'unexpected');
    else listed.set(e.path, e);
  }
  const seen = new Set<string>();
  // A name that differs only by case or Unicode form from an earlier one would collide on a case-insensitive disk.
  const folded = new Set<string>();
  for (const z of reader.entries.slice(0, -1)) {
    if (o.signal?.aborted) throw new AppError('CANCELLED', 'Cancelled');
    const m = listed.get(z.name);
    // A name that is not a safe path (zip-slip, absolute, drive, backslash), a name outside the layout, a repeated
    // entry and an entry the manifest does not list are all "unexpected": counted once per entry.
    const key = z.name.normalize('NFC').toLowerCase();
    const duplicate = seen.has(z.name) || folded.has(key);
    folded.add(key);
    if (duplicate || !m || !isAllowedEntryName(z.name)) {
      seen.add(z.name);
      flag(z.name, 'unexpected');
      continue;
    }
    seen.add(z.name);
    if (z.usize !== m.size) {
      flag(z.name, 'size');
      continue;
    }
    const digest = await hashEntry(reader, z, o);
    if (digest === null) flag(z.name, 'unreadable');
    else if (digest !== m.sha256) flag(z.name, 'hash');
  }
  for (const p of listed.keys()) if (!seen.has(p)) flag(p, 'missing');
  return { files: manifest.entries.length, problemCount, problems };
}

async function hashEntry(reader: ZipReader, z: ZipEntry, o: { signal?: AbortSignal | undefined; onBytes?: (n: number) => void }): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    for await (const c of reader.stream(z, o.signal)) {
      hash.update(c as Buffer);
      o.onBytes?.((c as Buffer).length);
    }
  } catch (e) {
    if (o.signal?.aborted) throw new AppError('CANCELLED', 'Cancelled');
    return null;
  }
  return hash.digest('hex');
}

export interface ExtractTargets {
  /** Folder that receives `library/*` (created, must not exist). */
  library: string;
  /** Folder that receives `local/*` (created); null: the local part is not restored. */
  local: string | null;
}

/**
 * Extracts a VERIFIED archive into fresh folders (`wx` files, no overwrite), hashing again while writing: an archive
 * that changed since the check fails with CONFLICT `integrity`. Every target path is confined to its folder.
 * Returns the bytes of `settings.json` when present.
 */
export async function extractArchive(reader: ZipReader, manifest: BackupManifest, targets: ExtractTargets, o: { signal?: AbortSignal | undefined; onBytes?: (n: number) => void } = {}): Promise<{ settings: Buffer | null }> {
  const byName = new Map(reader.entries.map((e) => [e.name, e]));
  let settings: Buffer | null = null;
  await mkdir(targets.library, { recursive: true });
  if (targets.local) await mkdir(targets.local, { recursive: true });
  for (const m of manifest.entries) {
    if (o.signal?.aborted) throw new AppError('CANCELLED', 'Cancelled');
    const z = byName.get(m.path);
    if (!z || !isAllowedEntryName(m.path)) throw new AppError('CONFLICT', 'The backup does not match its manifest', { reason: 'integrity' });
    if (m.path === SETTINGS_NAME) {
      settings = await reader.read(z, MAX_SETTINGS_ENTRY_BYTES, o.signal);
      if (createHash('sha256').update(settings).digest('hex') !== m.sha256) throw new AppError('CONFLICT', 'The backup changed while it was read', { reason: 'integrity' });
      o.onBytes?.(settings.length);
      continue;
    }
    let base: string;
    let rel: string;
    if (m.path.startsWith(LIBRARY_PREFIX)) {
      base = targets.library;
      rel = m.path.slice(LIBRARY_PREFIX.length);
    } else {
      if (!targets.local) continue;
      base = targets.local;
      // `local/chat/<id>/<file>` goes to `<local folder>/<file>` (the caller renames the folder to `chat/<new id>`):
      // the id of the source library is dropped, the new profile has its own.
      rel = m.path.slice(`${LOCAL_PREFIX}chat/`.length).split('/').slice(1).join('/');
      if (rel === '') continue;
    }
    const abs = path.resolve(base, ...rel.split('/'));
    if (!isInside(base, abs) || abs === path.resolve(base)) throw new AppError('CONFLICT', 'An entry leaves the restore folder', { reason: 'integrity' });
    await mkdir(path.dirname(abs), { recursive: true });
    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        o.onBytes?.(chunk.length);
        cb(null, chunk);
      },
    });
    await pipeline(reader.stream(z, o.signal), tap, createWriteStream(abs, { flags: 'wx' }), o.signal ? { signal: o.signal } : {});
    if (hash.digest('hex') !== m.sha256) throw new AppError('CONFLICT', 'The backup changed while it was read', { reason: 'integrity' });
  }
  return { settings };
}

/** Moves a folder into place; an existing EMPTY folder at the target is replaced (rmdir fails on a non-empty one). */
export async function renameIntoPlace(from: string, to: string): Promise<void> {
  await rmdir(to).catch(() => {});
  await rename(from, to);
}
