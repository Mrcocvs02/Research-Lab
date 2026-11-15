import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { AppError } from '../errors.js';

const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);

export interface AtomicWriteOptions {
  /** Rename attempts before giving up (cloud sync or antivirus can briefly lock the target). Default 8. */
  attempts?: number;
  /** Base delay in ms, doubled each retry, capped at 1 s. Default 25. */
  baseDelayMs?: number;
  /** Create parent directories. Default true. */
  mkdir?: boolean;
  /** Test hook. */
  renameImpl?: (from: string, to: string) => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes `data` to a temp file in the same folder, fsyncs, then renames over `target`. */
export async function atomicWriteFile(target: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  const { attempts = 8, baseDelayMs = 25, mkdir: doMkdir = true, renameImpl = rename } = options;
  const dir = path.dirname(target);
  if (doMkdir) await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await renameImpl(tmp, target);
        return;
      } catch (e) {
        lastError = e;
        const code = (e as NodeJS.ErrnoException).code;
        if (!code || !TRANSIENT.has(code) || i === attempts - 1) break;
        await sleep(Math.min(baseDelayMs * 2 ** i, 1000));
      }
    }
    throw new AppError('IO_ERROR', 'Atomic write failed', { code: (lastError as NodeJS.ErrnoException)?.code ?? 'unknown' }, { cause: lastError });
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e instanceof AppError ? e : new AppError('IO_ERROR', 'Atomic write failed', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' }, { cause: e });
  }
}

/** Atomically writes pretty-printed JSON with a trailing newline (stable, diff- and sync-friendly). */
export async function atomicWriteJson(target: string, value: unknown, options: AtomicWriteOptions & { space?: number } = {}): Promise<void> {
  const { space = 2, ...rest } = options;
  await atomicWriteFile(target, `${JSON.stringify(value, null, space)}\n`, rest);
}

/** Reads and validates a JSON file. NOT_FOUND if missing, SCHEMA_INVALID if unparsable or invalid. */
export async function readJsonFile<S extends z.ZodType>(file: string, schema: S): Promise<z.output<S>> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new AppError('NOT_FOUND', 'File not found');
    throw new AppError('IO_ERROR', 'Cannot read file', { code: code ?? 'unknown' }, { cause: e });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new AppError('SCHEMA_INVALID', 'File is not valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('SCHEMA_INVALID', 'File does not match its schema', {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}
