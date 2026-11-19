import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { docLinksFileSchema, type DocLinksFile } from './schema.js';
import { atomicWriteJson } from '@rl/core/node';

/**
 * `links/doc-links.json` in the data folder (§18.2): the links between documents and the pairs the user removed. The pair is
 * unordered (`a` < `b`), one link per pair. Writes are atomic and run one after the other per folder.
 */
export const EMPTY: DocLinksFile = { schemaVersion: 1, links: [], dismissed: [] };

const fileOf = (dataDir: string) => path.join(dataDir, 'links', 'doc-links.json');

/** The unordered pair as one key. */
export const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);
export const ordered = (x: string, y: string): { a: string; b: string } => (x < y ? { a: x, b: y } : { a: y, b: x });

/** The file, or an empty one when it does not exist or is not valid. Any other failure (a file held by another program) is thrown: it must never look like "no file". */
export async function readLinks(dataDir: string): Promise<DocLinksFile> {
  let text: string;
  try {
    text = await readFile(fileOf(dataDir), 'utf8');
  } catch (e) {
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return { ...EMPTY, links: [], dismissed: [] };
    throw e;
  }
  try {
    const r = docLinksFileSchema.safeParse(JSON.parse(text));
    if (r.success) return r.data;
  } catch {
    /* damaged: treated as empty, the next write replaces it */
  }
  return { ...EMPTY, links: [], dismissed: [] };
}

const chains = new Map<string, Promise<unknown>>();

/** Reads the file, lets `fn` change it, writes it when `fn` returns true; after every earlier change of the same folder. Resolves with what `fn` returned. */
export function mutateLinks<T>(dataDir: string, fn: (file: DocLinksFile) => { changed: boolean; value: T }): Promise<T> {
  const run = async (): Promise<T> => {
    const file = await readLinks(dataDir);
    const out = fn(file);
    if (out.changed) {
      await mkdir(path.dirname(fileOf(dataDir)), { recursive: true });
      await atomicWriteJson(fileOf(dataDir), file);
    }
    return out.value;
  };
  const next = (chains.get(dataDir) ?? Promise.resolve()).then(run, run);
  const tail = next.then(() => undefined, () => undefined);
  chains.set(dataDir, tail);
  void tail.then(() => {
    if (chains.get(dataDir) === tail) chains.delete(dataDir);
  });
  return next;
}
