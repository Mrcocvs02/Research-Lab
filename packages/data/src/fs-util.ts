import path from 'node:path';

/**
 * Windows: absolute paths of 240+ characters get the `\\?\` prefix so the 260 character limit
 * does not apply. Other platforms: the path as is. Only for paths handed to `fs` calls, never stored.
 */
export function toFsPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const abs = path.resolve(p);
  if (abs.length < 240 || abs.startsWith('\\\\?\\')) return abs;
  return abs.startsWith('\\\\') ? `\\\\?\\UNC\\${abs.slice(2)}` : `\\\\?\\${abs}`;
}

/** Runs `fn` over `items` with at most `limit` calls in flight; stops starting new ones once `stop()` is true. */
export async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>, stop: () => boolean = () => false): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (stop()) return;
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/** Case-insensitive file systems (Windows, macOS): keys used to compare relative paths. */
export const pathKey: (rel: string) => string = process.platform === 'win32' || process.platform === 'darwin' ? (rel) => rel.toLowerCase() : (rel) => rel;
