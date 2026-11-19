import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { authorAliasesSchema } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import type { AuthorAliases } from '@rl/graph';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { KeyedQueue } from '../keyed-queue.js';

/**
 * The user's corrections to the authors (D-386, D-454): `<dataDir>/graph/author-aliases.json`, in the synced data folder,
 * written atomically. Read by the entity network and by Explore; the documents' own metadata is never touched.
 */
const MAX_MERGES = 20_000;
const MAX_SPLITS = 5_000;
const MAX_BYTES = 8 * 1024 * 1024;

export type AuthorEdit = { action: 'merge'; from: string; to: string } | { action: 'split'; key: string } | { action: 'import'; aliases: AuthorAliases };

/** The corrections as stored: plain, writable values (the contract's shape). */
type Stored = { merge: Record<string, string>; split: string[] };

interface Cached {
  /** mtime and size of the file the value was read from ('missing' when there is none). */
  sig: string;
  aliases: Stored;
}

const cache = new WeakMap<object, Cached>();
const queue = new KeyedQueue();

const fileOf = (rt: Pick<LibraryRuntime, 'store'>): string => path.join(rt.store.dataDir, 'graph', 'author-aliases.json');
const hasFolder = (rt: Pick<LibraryRuntime, 'store'>): boolean => typeof rt.store?.dataDir === 'string';

/** A null-prototype object: keys come from a file and `__proto__` must be just a key. */
function clean(raw: unknown): Stored {
  const parsed = authorAliasesSchema.safeParse(raw);
  const merge = Object.create(null) as Record<string, string>;
  if (!parsed.success) return { merge, split: [] };
  let n = 0;
  for (const [from, to] of Object.entries(parsed.data.merge)) if (from !== to && n++ < MAX_MERGES) merge[from] = to;
  return { merge, split: [...new Set(parsed.data.split)].slice(0, MAX_SPLITS) };
}

/** The corrections of the active library; `key` changes whenever they do (it keys the caches that depend on them). */
export async function readAuthorAliases(rt: LibraryRuntime): Promise<{ aliases: Stored; key: string }> {
  if (!hasFolder(rt)) return { aliases: clean(null), key: 'none' };
  const file = fileOf(rt);
  const info = await stat(file).catch(() => null);
  const sig = info ? `${Math.round(info.mtimeMs)}:${info.size}` : 'missing';
  const hit = cache.get(rt);
  if (hit && hit.sig === sig) return { aliases: hit.aliases, key: sig };
  let aliases = clean(null);
  if (info && info.size <= MAX_BYTES) {
    try {
      aliases = clean(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      /* damaged file: no corrections until the user makes new ones */
    }
  }
  cache.set(rt, { sig, aliases });
  return { aliases, key: sig };
}

/** Applies one edit (read, change, write; one at a time per file) and answers the new corrections. */
export function editAuthorAliases(rt: LibraryRuntime, edit: AuthorEdit): Promise<Stored> {
  const file = fileOf(rt);
  const run = async (): Promise<Stored> => {
    const { aliases: a } = await readAuthorAliases(rt);
    let merge: Record<string, string> = { ...a.merge };
    let split = [...a.split];
    if (edit.action === 'merge') {
      if (edit.from !== edit.to) {
        // No chains and no loops: what pointed at `from` now points at `to`, and `to` never points on.
        for (const [k, v] of Object.entries(merge)) if (v === edit.from) merge[k] = edit.to;
        merge[edit.from] = edit.to;
        delete merge[edit.to];
      }
    } else if (edit.action === 'split') {
      merge = Object.fromEntries(Object.entries(merge).filter(([k, v]) => k !== edit.key && v !== edit.key));
      if (!split.includes(edit.key)) split.push(edit.key);
    } else {
      const add = clean(edit.aliases);
      merge = { ...add.merge, ...merge };
      split = [...new Set([...split, ...add.split])];
    }
    const next = clean({ merge, split });
    await atomicWriteFile(file, JSON.stringify({ merge: next.merge, split: next.split }));
    cache.delete(rt);
    return (await readAuthorAliases(rt)).aliases;
  };
  return queue.run(file, run);
}
