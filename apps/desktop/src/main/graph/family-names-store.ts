import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '@rl/core/node';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { graphPaths } from './paths.js';

/**
 * Names the user accepted for the clusters of the automatic family (D-489): kept in the local app data, keyed by the model build and
 * by `<scope>|<cluster id>` (the communities mean something only inside one build and one scope). A null-prototype object: the keys
 * come from a file.
 */
interface NamesFile {
  version: 1;
  modelKey: string;
  names: Record<string, string>;
}
export const MAX_NAME = 60;
const fileOf = (s: MainServices, rt: LibraryRuntime): string => path.join(graphPaths(s.localDataDir, rt.libraryId).dir, 'family-names.json');

export async function readNames(s: MainServices, rt: LibraryRuntime, modelKey: string): Promise<Record<string, string>> {
  const out = Object.create(null) as Record<string, string>;
  try {
    const raw = JSON.parse(await readFile(fileOf(s, rt), 'utf8')) as Partial<NamesFile>;
    if (raw.version !== 1 || raw.modelKey !== modelKey || typeof raw.names !== 'object' || raw.names === null) return out;
    for (const [k, v] of Object.entries(raw.names)) if (typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME && k.length <= 300) out[k] = v;
  } catch {
    /* no file yet, or damaged: no names */
  }
  return out;
}

const writes = new Map<string, Promise<unknown>>();

/** Sets (or, with `null`, removes) one name; writes are one at a time per library. */
export function writeName(s: MainServices, rt: LibraryRuntime, modelKey: string, key: string, name: string | null): Promise<void> {
  const file = fileOf(s, rt);
  const run = async () => {
    const cur = await readNames(s, rt, modelKey);
    if (name === null) delete cur[key];
    else cur[key] = name.slice(0, MAX_NAME);
    const body: NamesFile = { version: 1, modelKey, names: { ...cur } };
    await atomicWriteFile(file, JSON.stringify(body));
  };
  const next = (writes.get(file) ?? Promise.resolve()).then(run, run);
  writes.set(file, next.catch(() => {}));
  return next;
}
