import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, itemIdSchema, type DiscoverRun, type PrismaCounts, type PrismaState } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * PRISMA 2020 flow counts of a project (D-439), kept in `discover/prisma/<projectId>.json`: what each "Estendi la bibliografia"
 * search found (per source), what the user decided on its candidates (rejected with a reason, imported), and the numbers added
 * for the steps done outside the app (`extra`, a difference from the app's own figures, so a new search still adds up).
 */
export interface ExtendStats {
  cited: number;
  citing: number;
  /** Works found both as cited and as citing, and candidates already in the library: counted once, the rest are duplicates. */
  duplicates: number;
}
export const newStats = (): ExtendStats => ({ cited: 0, citing: 0, duplicates: 0 });

interface Decision {
  state: 'excluded' | 'imported';
  reason?: string;
}
interface PrismaFile {
  runs: Record<string, { identified: Record<string, number>; duplicates: number; screened: number }>;
  decisions: Record<string, Record<string, Decision>>;
  extra: PrismaCounts;
}
const emptyCounts = (): PrismaCounts => ({ identified: [], duplicates: 0, screened: 0, excludedScreening: 0, assessed: 0, excludedFull: [], included: 0 });
const SOURCE_CITED = 'openalex-cited';
const SOURCE_CITING = 'openalex-citing';

const fileOf = (dataDir: string, projectId: string) => path.join(dataDir, 'discover', 'prisma', `${itemIdSchema.parse(projectId)}.json`);

async function read(file: string): Promise<PrismaFile> {
  const empty = (): PrismaFile => ({ runs: {}, decisions: {}, extra: emptyCounts() });
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    // Only "there is no file" is an empty state; a file that cannot be read now (EBUSY, EPERM...) is an error, not a blank to write over.
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return empty();
    throw e;
  }
  try {
    const f = JSON.parse(text) as Partial<PrismaFile>;
    return { runs: f.runs ?? {}, decisions: f.decisions ?? {}, extra: { ...emptyCounts(), ...(f.extra ?? {}) } };
  } catch {
    return empty();
  }
}

let chain: Promise<unknown> = Promise.resolve();
/** Read-modify-write one after the other (candidates may be marked quickly). */
function update(file: string, fn: (f: PrismaFile) => void): Promise<void> {
  const next = chain.then(async () => {
    const f = await read(file);
    fn(f);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteJson(file, f);
  });
  chain = next.catch(() => undefined);
  return next;
}

/** The app's own figures, from the searches and the decisions. */
function auto(f: PrismaFile): { counts: PrismaCounts; reasons: Map<string, number> } {
  const identified = new Map<string, number>();
  let duplicates = 0;
  let screened = 0;
  for (const r of Object.values(f.runs)) {
    for (const [k, n] of Object.entries(r.identified)) identified.set(k, (identified.get(k) ?? 0) + n);
    duplicates += r.duplicates;
    screened += r.screened;
  }
  const reasons = new Map<string, number>();
  let excluded = 0;
  let included = 0;
  for (const run of Object.values(f.decisions)) {
    for (const d of Object.values(run)) {
      if (d.state === 'imported') included++;
      else {
        excluded++;
        const r = d.reason?.trim() || 'other';
        reasons.set(r, (reasons.get(r) ?? 0) + 1);
      }
    }
  }
  return { counts: { identified: [...identified].map(([source, count]) => ({ source, count })), duplicates, screened, excludedScreening: excluded, assessed: 0, excludedFull: [], included }, reasons };
}

const clamp = (n: number) => Math.max(0, Math.round(n));

function state(f: PrismaFile): PrismaState {
  const { counts: a, reasons } = auto(f);
  const e = f.extra;
  const sources = new Map(a.identified.map((x) => [x.source, x.count]));
  for (const x of e.identified) sources.set(x.source, (sources.get(x.source) ?? 0) + x.count);
  const counts: PrismaCounts = {
    identified: [...sources].map(([source, count]) => ({ source, count: clamp(count) })),
    duplicates: clamp(a.duplicates + e.duplicates),
    screened: clamp(a.screened + e.screened),
    excludedScreening: clamp(a.excludedScreening + e.excludedScreening),
    assessed: clamp(a.assessed + e.assessed),
    excludedFull: e.excludedFull,
    included: clamp(a.included + e.included),
  };
  const edited = e.identified.length > 0 || e.excludedFull.length > 0 || [e.duplicates, e.screened, e.excludedScreening, e.assessed, e.included].some((n) => n !== 0);
  return { counts, screeningReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count), edited };
}

async function located(s: MainServices, projectId: string): Promise<string> {
  const rt = await s.runtime.require();
  if (!(await rt.store.projects.get(projectId))) throw new AppError('NOT_FOUND', 'Unknown project', { id: projectId });
  return fileOf(rt.store.dataDir, projectId);
}

export async function getPrisma(s: MainServices, projectId: string): Promise<PrismaState> {
  return state(await read(await located(s, projectId)));
}

/** The user edited the figures: what is kept is the difference from the app's own. */
export async function setPrisma(s: MainServices, projectId: string, c: PrismaCounts): Promise<PrismaState> {
  const file = await located(s, projectId);
  await update(file, (f) => {
    const { counts: a } = auto(f);
    const have = new Map(a.identified.map((x) => [x.source, x.count]));
    const sources = new Set([...have.keys(), ...c.identified.map((x) => x.source)]);
    f.extra = {
      identified: [...sources].map((source) => ({ source, count: (c.identified.find((x) => x.source === source)?.count ?? 0) - (have.get(source) ?? 0) })).filter((x) => x.count !== 0),
      duplicates: c.duplicates - a.duplicates,
      screened: c.screened - a.screened,
      excludedScreening: c.excludedScreening - a.excludedScreening,
      assessed: c.assessed - a.assessed,
      excludedFull: c.excludedFull.filter((x) => x.count > 0),
      included: c.included - a.included,
    };
  });
  return state(await read(file));
}

/** A finished "extend" search of a project: its figures replace those of the same search run before. */
export async function recordRun(s: MainServices, run: DiscoverRun, stats: ExtendStats): Promise<void> {
  if (run.kind !== 'extend' || !run.projectId) return;
  try {
    await update(await located(s, run.projectId), (f) => {
      f.runs[run.id] = { identified: { [SOURCE_CITED]: stats.cited, [SOURCE_CITING]: stats.citing }, duplicates: stats.duplicates, screened: run.items.length };
    });
  } catch (e) {
    s.log.warn('recording the PRISMA counts failed', { error: e });
  }
}

/** The user rejected (with a reason) or imported a candidate of a project's search; `new` and `later` take the decision back. */
export async function recordDecision(s: MainServices, run: DiscoverRun, key: string, st: 'new' | 'later' | 'dismissed' | 'imported', reason?: string): Promise<void> {
  if (run.kind !== 'extend' || !run.projectId) return;
  try {
    await update(await located(s, run.projectId), (f) => {
      const d = (f.decisions[run.id] ??= {});
      if (st === 'dismissed') d[key] = { state: 'excluded', ...(reason ? { reason } : {}) };
      else if (st === 'imported') d[key] = { state: 'imported' };
      else delete d[key];
    });
  } catch (e) {
    s.log.warn('recording the PRISMA decision failed', { error: e });
  }
}
