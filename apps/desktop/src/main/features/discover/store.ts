import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { discoverRunSchema, itemIdSchema, type DiscoverRun, type DiscoverRunSummary } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';

/**
 * `discover/runs/<id>.json` in the data folder (§17.4.17): the parameters, candidates, scores, reasons and state of each one.
 * A file that cannot be read is skipped (never an error for the list); the summaries of "✦ Sintesi" live in the same file.
 */
const dir = (dataDir: string) => path.join(dataDir, 'discover', 'runs');
const fileOf = (dataDir: string, id: string) => path.join(dir(dataDir), `${itemIdSchema.parse(id)}.json`);

export async function readRun(dataDir: string, id: string): Promise<DiscoverRun | null> {
  try {
    const r = discoverRunSchema.safeParse(JSON.parse(await readFile(fileOf(dataDir, id), 'utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function writeRun(dataDir: string, run: DiscoverRun): Promise<void> {
  await mkdir(dir(dataDir), { recursive: true });
  await atomicWriteJson(fileOf(dataDir, run.id), run);
}

export async function removeRun(dataDir: string, id: string): Promise<boolean> {
  const had = (await readRun(dataDir, id)) !== null;
  await rm(fileOf(dataDir, id), { force: true });
  return had;
}

/** The summaries, newest first. */
export async function listRuns(dataDir: string): Promise<DiscoverRunSummary[]> {
  const names = await readdir(dir(dataDir)).catch(() => [] as string[]);
  const out: DiscoverRunSummary[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const r = await readRun(dataDir, n.slice(0, -5)).catch(() => null);
    if (r) out.push({ id: r.id, kind: r.kind, title: r.title, createdAt: r.createdAt, outcome: r.outcome, candidates: r.items.length, fresh: r.items.filter((c) => c.fresh).length });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Runs older than `days`; removed unless `dryRun`. Returns how many. */
export async function pruneRuns(dataDir: string, days: number, dryRun: boolean, now = Date.now()): Promise<number> {
  const cut = now - days * 86_400_000;
  const old = (await listRuns(dataDir)).filter((r) => Date.parse(r.createdAt) < cut);
  if (!dryRun) for (const r of old) await rm(fileOf(dataDir, r.id), { force: true });
  return old.length;
}
