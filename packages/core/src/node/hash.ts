import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { AppError } from '../errors.js';

/** SHA-256 (lowercase hex) of a file, streamed (constant memory). Read-only. */
/** SHA-256 of a file, or of its first `prefix` bytes when given. */
export async function sha256File(file: string, signal?: AbortSignal, prefix?: number): Promise<string> {
  const hash = createHash('sha256');
  try {
    const stream = createReadStream(file, { signal, ...(prefix !== undefined ? { start: 0, end: prefix - 1 } : {}) });
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AppError('CANCELLED', 'Hashing cancelled');
    const code = (e as NodeJS.ErrnoException).code;
    throw new AppError(code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR', 'Cannot hash file', { code: code ?? 'unknown' }, { cause: e });
  }
  return hash.digest('hex');
}

export function sha256Of(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
