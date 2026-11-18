/**
 * The file-system side of writing annotations into a PDF (ARCHITETTURA-UI §8.3.3 steps 4, 5, 7 and §8.3.8): safety copy, temporary
 * file next to the original, re-check, replacement with retries, the journal of temporaries, truncation. No PDF is parsed here
 * (that is the worker's job); everything that is written is either a copy of the original or the bytes the worker built.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError, PDF_WRITE_LIMITS } from '@rl/core';
import { atomicWriteJson, isInside as insideRoot, sha256File } from '@rl/core/node';

const TMP = /^\..+\.rl-[0-9a-f]{8}\.tmp$/;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isInside = insideRoot;

/** Size, time and a hash of the first and last 64 KiB: what the re-check before the replacement compares (D-200). */
export interface Fingerprint { size: number; mtimeMs: number; head: string; tail: string }
export async function fingerprint(abs: string): Promise<Fingerprint> {
  const fh = await open(abs, 'r');
  try {
    const st = await fh.stat();
    const n = PDF_WRITE_LIMITS.tailSearchBytes;
    const read = async (pos: number) => {
      const len = Math.max(0, Math.min(n, st.size - pos));
      const b = Buffer.alloc(len);
      await fh.read(b, 0, len, pos);
      return createHash('sha1').update(b).digest('hex');
    };
    return { size: st.size, mtimeMs: st.mtimeMs, head: await read(0), tail: await read(Math.max(0, st.size - n)) };
  } finally {
    await fh.close();
  }
}
export const sameFingerprint = (a: Fingerprint, b: Fingerprint) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.head === b.head && a.tail === b.tail;

/** Name of the temporary: hidden, next to the original, random (never a name that exists: `COPYFILE_EXCL`). */
export const tempNameFor = (abs: string) => path.join(path.dirname(abs), `.${path.basename(abs)}.rl-${randomBytes(4).toString('hex')}.tmp`);

/** Temporaries that exist right now (journal of §8.3.3 step 5): written atomically so that a stop leaves a trace of every one. */
export interface JournalEntry { tmp: string; docId: string; libraryId: string; at: string }
export class Journal {
  private entries: JournalEntry[] | null = null;
  constructor(private readonly file: string) {}
  private async load(): Promise<JournalEntry[]> {
    if (this.entries) return this.entries;
    try {
      const v = JSON.parse(await readFile(this.file, 'utf8')) as { entries?: JournalEntry[] };
      this.entries = Array.isArray(v.entries) ? v.entries.filter((e) => typeof e?.tmp === 'string') : [];
    } catch {
      this.entries = [];
    }
    return this.entries;
  }
  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await atomicWriteJson(this.file, { v: 1, entries: this.entries ?? [] });
  }
  async add(e: JournalEntry): Promise<void> {
    (await this.load()).push(e);
    await this.save();
  }
  async remove(tmp: string): Promise<void> {
    const list = await this.load();
    const next = list.filter((e) => e.tmp !== tmp);
    if (next.length !== list.length) {
      this.entries = next;
      await this.save();
    }
  }
  /**
   * After a stop in the middle of a write: deletes ONLY the listed temporaries that still exist, have the expected name and sit
   * inside one of `roots` (the library root or our own local folder). Anything else in the journal is dropped untouched.
   */
  async cleanup(roots: readonly string[]): Promise<number> {
    const list = await this.load();
    let n = 0;
    for (const e of list) {
      if (TMP.test(path.basename(e.tmp)) && roots.some((r) => isInside(r, e.tmp))) {
        if (await unlink(e.tmp).then(() => true, () => false)) n++;
      }
    }
    if (list.length > 0) {
      this.entries = [];
      await this.save();
    }
    return n;
  }
}

/** A wait the file cannot satisfy now: another program holds it open (Windows: EPERM/EBUSY/EACCES at the replacement). */
export class LockedError extends Error {
  constructor() {
    super('locked');
  }
}

/** `rename(tmp, dest)` replacing the destination; a file held by another program is retried at 200, 600 and 1500 ms (D-432). */
export async function replaceWithRetry(tmp: string, dest: string, delays: readonly number[] = PDF_WRITE_LIMITS.renameRetryMs): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw new AppError('IO_ERROR', 'Cannot replace the file', { code: code ?? 'unknown' });
      if (i >= delays.length) throw new LockedError();
      await sleep(delays[i]!);
    }
  }
}

/** Copies the original next to itself, appends `bytes` at `at` (the old size) and flushes: the file the verification reads. */
export async function writeTempWithAppend(abs: string, tmp: string, bytes: Buffer, at: number): Promise<void> {
  await copyFile(abs, tmp, constants.COPYFILE_EXCL);
  const fh = await open(tmp, 'r+');
  try {
    await fh.write(bytes, 0, bytes.length, at);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** A temporary holding exactly the first `n` bytes of the file (restore by truncation, §8.3.8). */
export async function writeTempTruncated(abs: string, tmp: string, n: number): Promise<void> {
  await copyFile(abs, tmp, constants.COPYFILE_EXCL);
  const fh = await open(tmp, 'r+');
  try {
    await fh.truncate(n);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * The safety copy of the original (§8.3.3 step 4): atomic (temporary, flush, hash check, rename), confined to `dir`, and made once per
 * content (an existing copy with the same hash is kept). Returns the file name inside `dir`.
 */
export async function copyOriginal(abs: string, dir: string, docId: string, hash: string, journal: Journal, libraryId: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const name = `${docId}-${hash.slice(0, 8)}.pdf`;
  const dest = path.join(dir, name);
  if (!isInside(dir, dest)) throw new AppError('PATH_OUTSIDE_ROOT', 'The copy would leave its folder');
  if ((await stat(dest).catch(() => null))?.isFile() && (await sha256File(dest)) === hash) return name;
  const tmp = path.join(dir, `.${name}.rl-${randomBytes(4).toString('hex')}.tmp`);
  await journal.add({ tmp, docId, libraryId, at: new Date().toISOString() });
  try {
    await copyFile(abs, tmp, constants.COPYFILE_EXCL);
    const fh = await open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    if ((await sha256File(tmp)) !== hash) throw new AppError('IO_ERROR', 'The safety copy does not match the original');
    await rename(tmp, dest);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  } finally {
    await journal.remove(tmp);
  }
  return name;
}
