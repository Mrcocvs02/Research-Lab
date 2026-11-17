import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '@rl/core/node';
import { MAX_GRAPH_DOCS } from './inputs.js';

/**
 * A small file next to `model.json` with what `graph:status` needs (which documents the model has and their signatures),
 * so that the status of a big library does not parse the whole model. It names the byte size of the model it describes:
 * a model that does not match (replaced, or the build stopped between the two writes) is not trusted.
 */
export interface ModelMeta {
  version: 1;
  modelBytes: number;
  builtAt: string;
  seed: number;
  ids: string[];
  sigs: string[];
}

export const metaFileOf = (modelFile: string): string => path.join(path.dirname(modelFile), 'meta.json');

export async function writeMeta(modelFile: string, meta: ModelMeta): Promise<void> {
  await atomicWriteFile(metaFileOf(modelFile), JSON.stringify(meta));
}

const strings = (v: unknown, n: number): v is string[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'string' && x.length <= 100);

/** The meta file when it is well formed and describes a model of `modelBytes` bytes; null otherwise. */
export async function readMeta(metaFile: string, modelBytes: number): Promise<ModelMeta | null> {
  try {
    const info = await stat(metaFile);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) return null;
    const raw = JSON.parse(await readFile(metaFile, 'utf8')) as Partial<ModelMeta>;
    if (raw.version !== 1 || raw.modelBytes !== modelBytes || typeof raw.builtAt !== 'string' || typeof raw.seed !== 'number' || !Array.isArray(raw.ids) || raw.ids.length > MAX_GRAPH_DOCS * 2) return null;
    if (!strings(raw.ids, raw.ids.length) || !strings(raw.sigs, raw.ids.length)) return null;
    return raw as ModelMeta;
  } catch {
    return null;
  }
}

const TMP = /^\.(model|labels|meta)\.json\.[0-9a-f]+\.tmp$/;

/** Removes temporary files that a crash left in the graph folder (older than ten minutes: a write in progress is left alone). */
export async function cleanLeftovers(dir: string, now = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (!TMP.test(name)) continue;
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs > 10 * 60_000) await unlink(file).catch(() => {});
  }
}
