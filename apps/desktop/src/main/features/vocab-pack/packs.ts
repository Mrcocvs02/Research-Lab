import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type PackInfo } from '@rl/core';
import { packIndexSchema, vocabPackSchema, validatePackIntegrity, type VocabPack } from '@rl/core/vocab';
import type { PackConceptIn, PackFamilyIn } from '@rl/data/pack-match';

/**
 * The field vocabulary packs (D-516, section 20.1.5). They are JSON resources the build writes next to the main bundle (`packs/<id>.json`
 * and a small `packs/index.json`): never JS, so they cost no code. A pack is read on first use and released five minutes after the last
 * use, so the memory at rest does not grow.
 */

/** How long a pack stays in memory after its last use. */
export const PACK_KEEP_MS = 5 * 60_000;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `out/main/packs`, next to the `chunks` folder this code lives in; the end-to-end tests point `RL_E2E_PACKS_DIR` at a folder of their own. */
export function packsDir(): string {
  const e2e = process.env['RL_E2E'] === '1' ? process.env['RL_E2E_PACKS_DIR'] : undefined;
  return e2e && e2e.length > 0 ? e2e : path.join(import.meta.dirname, '..', 'packs');
}

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8')) as unknown;

/** What the list shows: from `index.json`, or (when it is missing) from the pack files themselves. */
export async function readIndex(dir = packsDir()): Promise<PackInfo[]> {
  try {
    const idx = packIndexSchema.safeParse(await readJson(path.join(dir, 'index.json')));
    if (idx.success) return idx.data.packs.map((p) => ({ id: p.id, version: p.version, label: p.label, ...(p.labelIt ? { labelIt: p.labelIt } : {}), families: p.families }));
  } catch {
    /* no index: the files are read */
  }
  const out: PackInfo[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  } catch {
    return out;
  }
  for (const f of names) {
    const pack = await readPack(dir, f.slice(0, -5)).catch(() => null);
    if (pack) out.push({ id: pack.id, version: pack.version, label: pack.label, ...(pack.labelIt ? { labelIt: pack.labelIt } : {}), families: pack.families.map((x) => ({ id: x.id, label: x.label, singleValue: x.singleValue, concepts: x.concepts.length })) });
  }
  return out;
}

async function readPack(dir: string, id: string): Promise<VocabPack> {
  if (!ID.test(id)) throw new AppError('NOT_FOUND', 'Unknown field vocabulary');
  let raw: unknown;
  try {
    raw = await readJson(path.join(dir, `${id}.json`));
  } catch {
    throw new AppError('NOT_FOUND', 'Unknown field vocabulary', { packId: id });
  }
  const parsed = vocabPackSchema.safeParse(raw);
  if (!parsed.success || validatePackIntegrity(parsed.data).length > 0 || parsed.data.id !== id) throw new AppError('INTERNAL', 'The field vocabulary file is not valid', { packId: id });
  return parsed.data;
}

/** A pack with the lookups the features need. */
export interface LoadedPack {
  pack: VocabPack;
  families: PackFamilyIn[];
  concepts: PackConceptIn[];
  byId: Map<string, PackConceptIn>;
  /** Short ids of the prompt (`f0`, `f1`...) in the order of the file, and back. */
  shortOf: Map<string, string>;
  conceptOfShort: Map<string, string>;
}

function build(pack: VocabPack): LoadedPack {
  const concepts: PackConceptIn[] = pack.families.flatMap((f) => f.concepts.map((c) => ({ id: c.id, family: f.id, label: c.label, labelIt: c.labelIt, aliases: c.aliases, parent: c.parent, distinctFrom: c.distinctFrom })));
  const shortOf = new Map(concepts.map((c, i) => [c.id, `f${i}`]));
  return {
    pack,
    families: pack.families.map((f) => ({ id: f.id, label: f.label, singleValue: f.singleValue })),
    concepts,
    byId: new Map(concepts.map((c) => [c.id, c])),
    shortOf,
    conceptOfShort: new Map([...shortOf].map(([c, s]) => [s, c])),
  };
}

let held: { dir: string; id: string; loaded: LoadedPack; timer: NodeJS.Timeout } | null = null;

/** Drops the pack held in memory (the timer does it five minutes after the last use; tests call it). */
export function releasePack(): void {
  if (held) clearTimeout(held.timer);
  held = null;
}

/** Reads a pack (or takes it from memory) and keeps it for five more minutes. `NOT_FOUND` for an unknown id. */
export async function loadPack(id: string, dir = packsDir()): Promise<LoadedPack> {
  if (held && held.id === id && held.dir === dir) {
    clearTimeout(held.timer);
  } else {
    const loaded = build(await readPack(dir, id));
    releasePack();
    held = { dir, id, loaded, timer: undefined as unknown as NodeJS.Timeout };
  }
  const h = held as NonNullable<typeof held>;
  h.timer = setTimeout(() => {
    if (held === h) held = null;
  }, PACK_KEEP_MS);
  h.timer.unref();
  return h.loaded;
}
