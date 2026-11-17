import { readFile } from 'node:fs/promises';
import { aiMetaSchema, type AiMeta } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { graphPaths } from './paths.js';

export interface StoredLabel {
  text: string;
  meta: AiMeta;
}

interface LabelsFile {
  version: 1;
  /** The model the labels belong to: cluster ids mean something only inside one build. */
  modelKey: string;
  labels: Record<string, StoredLabel>;
}

/** Cluster labels written by Claude, kept in the local app data (AI output, never mixed into the user's data). */
/** A null-prototype object: cluster ids come from a file, and `__proto__` or `constructor` must be just ids. */
export async function readLabels(s: MainServices, rt: LibraryRuntime, modelKey: string): Promise<Record<string, StoredLabel>> {
  try {
    const raw = JSON.parse(await readFile(graphPaths(s.localDataDir, rt.libraryId).labelsFile, 'utf8')) as Partial<LabelsFile>;
    if (raw.version !== 1 || raw.modelKey !== modelKey || typeof raw.labels !== 'object' || raw.labels === null) return Object.create(null) as Record<string, StoredLabel>;
    const out = Object.create(null) as Record<string, StoredLabel>;
    for (const [id, l] of Object.entries(raw.labels)) {
      const meta = aiMetaSchema.safeParse(l?.meta);
      if (meta.success && typeof l.text === 'string' && l.text.length > 0 && l.text.length <= 200 && id.length <= 100) out[id] = { text: l.text, meta: meta.data };
    }
    return out;
  } catch {
    return Object.create(null) as Record<string, StoredLabel>;
  }
}

/** Writes are one at a time per library (read, merge, write): two labelling calls cannot lose each other's labels. */
const writes = new Map<string, Promise<unknown>>();

export function writeLabels(s: MainServices, rt: LibraryRuntime, modelKey: string, add: ReadonlyMap<string, StoredLabel>): Promise<void> {
  const file = graphPaths(s.localDataDir, rt.libraryId).labelsFile;
  const run = async () => {
    const merged = new Map([...Object.entries(await readLabels(s, rt, modelKey)), ...add]);
    const body: LabelsFile = { version: 1, modelKey, labels: Object.fromEntries(merged) };
    await atomicWriteFile(file, JSON.stringify(body));
  };
  const next = (writes.get(file) ?? Promise.resolve()).then(run, run);
  writes.set(file, next.catch(() => {}));
  return next;
}
