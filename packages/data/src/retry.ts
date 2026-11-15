import { AppError } from '@rl/core';

const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

function errnoOf(e: unknown): string | undefined {
  if (e instanceof AppError) {
    const code = e.details?.['code'];
    return e.code === 'IO_ERROR' && typeof code === 'string' ? code : undefined;
  }
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

export function isTransientIoError(e: unknown): boolean {
  const code = errnoOf(e);
  return code !== undefined && TRANSIENT.has(code);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn`, retrying with exponential backoff when the file is briefly locked
 * (EBUSY/EPERM/EACCES: cloud sync, antivirus, indexers). Other errors pass through at once.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 6, baseDelayMs = 20 } = options;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !isTransientIoError(e)) throw e;
      await sleep(Math.min(baseDelayMs * 2 ** i, 1000));
    }
  }
}
