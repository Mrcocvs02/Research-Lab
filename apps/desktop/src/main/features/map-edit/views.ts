import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, MAP_EDIT_LIMITS, type MapView, type MapViewInput } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import type { MainServices } from '../../ipc/handlers/services.js';
import { mapViewInputSchema, mapViewSchema } from './schema.js';

/**
 * Saved views of the Map (D-527), loaded on first use: `<dataDir>/map-views.json`, in the data folder so they follow the library (never the
 * originals). At most 100; a repeated name gets " (2)". They are working preferences, not changes: nothing goes to the history. Writes are one at a time.
 */
const FILE = 'map-views.json';

const fileOf = async (s: MainServices): Promise<string> => path.join((await s.runtime.require()).store.dataDir, FILE);

/** The views of the file; one that does not fit the schema is left out. A file that cannot be read or parsed is an error (the rest of the Map works). */
async function read(file: string): Promise<MapView[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new AppError('IO_ERROR', 'The saved views cannot be read', { reason: 'read' }, { cause: e });
  }
  let list: unknown;
  try {
    list = (JSON.parse(raw) as { views?: unknown }).views;
  } catch (e) {
    throw new AppError('SCHEMA_INVALID', 'The file of saved views is damaged', { reason: 'damaged' }, { cause: e });
  }
  if (!Array.isArray(list)) throw new AppError('SCHEMA_INVALID', 'The file of saved views is damaged', { reason: 'damaged' });
  return list.flatMap((v) => {
    const p = mapViewSchema.safeParse(v);
    return p.success ? [p.data] : [];
  });
}

const queues = new Map<string, Promise<unknown>>();
/** Runs `fn` after the earlier writes of the same file. */
function serial<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).then(fn, fn);
  queues.set(file, next.catch(() => undefined));
  return next;
}

const write = (file: string, views: MapView[]): Promise<void> => atomicWriteFile(file, `${JSON.stringify({ version: 1, views }, null, 1)}\n`);

/** `name`, or `name (2)`, `name (3)`... when another view has it (case aside). */
function freeName(name: string, others: readonly MapView[]): string {
  const taken = new Set(others.map((v) => v.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const suffix = ` (${k})`;
    const candidate = `${name.slice(0, MAP_EDIT_LIMITS.name - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export async function list(s: MainServices): Promise<{ views: MapView[] }> {
  return { views: await read(await fileOf(s)) };
}

export async function save(s: MainServices, input: MapViewInput): Promise<{ view: MapView }> {
  const parsed = mapViewInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Not a valid view', { reason: 'view' });
  const view = parsed.data;
  const file = await fileOf(s);
  return serial(file, async () => {
    const views = await read(file);
    const at = view.id === undefined ? -1 : views.findIndex((v) => v.id === view.id);
    const now = new Date().toISOString();
    if (at < 0 && views.length >= MAP_EDIT_LIMITS.views) throw new AppError('INVALID_REQUEST', 'Too many saved views', { reason: 'limit' });
    const others = views.filter((_, i) => i !== at);
    const old = at >= 0 ? (views[at] as MapView) : undefined;
    const saved: MapView = {
      id: view.id ?? `view-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      name: freeName(view.name, others),
      ...(view.projectId ? { projectId: view.projectId } : {}),
      state: view.state,
      createdAt: old?.createdAt ?? view.createdAt ?? now,
      updatedAt: now,
    };
    await write(file, at >= 0 ? views.map((v, i) => (i === at ? saved : v)) : [...views, saved]);
    return { view: saved };
  });
}

export async function remove(s: MainServices, id: string): Promise<{ ok: true }> {
  const file = await fileOf(s);
  return serial(file, async () => {
    const views = await read(file);
    if (views.some((v) => v.id === id)) await write(file, views.filter((v) => v.id !== id));
    return { ok: true as const };
  });
}
