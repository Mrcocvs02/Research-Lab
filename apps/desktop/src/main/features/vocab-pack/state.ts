import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '@rl/core/node';
import { vocabPackStateSchema, type VocabPackState } from '@rl/core/vocab';

/** `<dataDir>/vocab-pack.json`, also named in `hook.ts` (D-516): synced with the library. An empty `packId` means "no pack in use" (the file then only remembers that the suggestion was shown). */
export const STATE_FILE = 'vocab-pack.json';

export const emptyState = (): VocabPackState => ({ schemaVersion: 1, packId: '', packVersion: 0, enabledAt: '', families: {}, rejected: [], changeIds: [] });

export async function readState(dataDir: string): Promise<VocabPackState> {
  try {
    const parsed = vocabPackStateSchema.safeParse(JSON.parse(await readFile(path.join(dataDir, STATE_FILE), 'utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    /* no file, or a file that is not ours: nothing is in use */
  }
  return emptyState();
}

export const writeState = (dataDir: string, st: VocabPackState): Promise<void> => atomicWriteJson(path.join(dataDir, STATE_FILE), st);

/** The state when a pack is in use, else null. */
export async function activeState(dataDir: string): Promise<VocabPackState | null> {
  const st = await readState(dataDir);
  return st.packId === '' ? null : st;
}
