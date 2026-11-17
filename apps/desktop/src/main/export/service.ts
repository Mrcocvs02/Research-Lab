import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, EXPORT_LIMITS, isReservedWindowsName, type ExportSelection } from '@rl/core';
import { MANIFEST_FILE, approxTokens, serializeManifest, type ExportManifest, type ManifestFile } from '@rl/export';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { collect, type Collected } from './collect.js';
import { generate, mergeSpec, type FileOutcome, type PipelineOutput, type Sink } from './pipeline.js';
import { ExportTarget, inspectTarget, isInsideLibrary, type TargetState } from './target.js';

type Phase = 'collect' | 'write' | 'copy' | 'done';
type JobState = 'running' | 'done' | 'cancelled' | 'failed';

export interface ExportResult {
  dir: string;
  written: number;
  updated: number;
  unchanged: number;
  keptEdited: string[];
  copyErrors: string[];
  orphaned: number;
  copiedBytes: number;
}

interface Job {
  jobId: string;
  libraryId: string;
  state: JobState;
  phase: Phase;
  done: number;
  total: number;
  result: ExportResult | null;
  error: { code: string; message: string } | null;
  controller: AbortController;
  dir: string;
  finished: Promise<void>;
}

const JOBS_KEPT = 20;
const PROGRESS_MIN_GAP_MS = 150;
const FLUSH_EVERY = 100;
/** The manifest is also saved when this long has passed since the last save, so an interrupted run loses little. */
const FLUSH_MAX_GAP_MS = 2000;
/** Exports of a services object that are being prepared (before their job exists): a second `run` is refused at once. */
const starting = new WeakSet<object>();
const registries = new WeakMap<object, Map<string, Job>>();
const jobsOf = (s: MainServices): Map<string, Job> => {
  let m = registries.get(s);
  if (!m) registries.set(s, (m = new Map()));
  return m;
};

const statusOf = (j: Job) => ({ jobId: j.jobId, state: j.state, phase: j.phase, done: j.done, total: j.total, result: j.result, error: j.error });

/**
 * Resolves the target from the approved destination (the renderer's spelling of the path is never used) and refuses one
 * inside the library root, links, junctions and case differences resolved (D-252).
 */
async function resolveTarget(s: MainServices, rt: LibraryRuntime, t: { destination: string; folderName: string }): Promise<ExportTarget> {
  const dest = s.approved.resolve(t.destination, 'export-destination');
  if (dest === null) throw new AppError('INVALID_REQUEST', 'The destination folder was not chosen with the folder dialog', { reason: 'destination-not-approved' });
  if (isReservedWindowsName(t.folderName)) throw new AppError('INVALID_REQUEST', 'Not a valid folder name', { reason: 'invalid-name' });
  const target = new ExportTarget(path.join(dest, t.folderName));
  if (await isInsideLibrary(rt.store.rootPath, target.dir)) {
    throw new AppError('CONFLICT', 'The export folder cannot be inside the library folder', { reason: 'inside-library' });
  }
  return target;
}

const activeRuntime = (s: MainServices) => s.runtime.require();

/** Dry run: what the export would hold and what the target has, without writing anything. */
export async function preview(s: MainServices, req: { selection: ExportSelection; target?: { destination: string; folderName: string } | undefined }) {
  const rt = await activeRuntime(s);
  const target = req.target ? await resolveTarget(s, rt, req.target) : null;
  const c = await collect(s, rt, req.selection);
  const info = target ? await inspectTarget(target.dir, rt.libraryId) : null;
  const manifest = info?.manifest ?? null;
  let written = 0;
  let edited = 0;
  let copyFiles = 0;
  let copyBytes = 0;
  const sink: Sink = {
    async put(spec) {
      const existing = manifest && target ? await target.read(spec.rel) : null;
      const m = mergeSpec(spec, existing, manifest?.files[spec.rel]);
      if (m.outcome === 'kept-edited') edited++;
      else if (m.outcome !== 'unchanged') written++;
      return m.outcome;
    },
    async copy(src) {
      copyFiles++;
      const bytes = (await stat(src).catch(() => null))?.size ?? 0;
      copyBytes += bytes;
      return { state: 'copied', bytes };
    },
  };
  const out = await generate({ s, rt, c, selection: req.selection, manifest, libraryName: c.config.name }, sink);
  void written;
  return {
    documents: c.direct,
    citedAdded: c.citedAdded,
    files: out.files + copyFiles,
    approxTokens: approxTokens(out.chars),
    indexTokens: out.indexTokens,
    copyBytes,
    aiDisabledDocuments: c.aiDisabled,
    missingFiles: c.missingFiles,
    target: info ? { state: info.state, previousExportAt: manifest?.exportedAt ?? null, editedFiles: edited } : null,
  };
}

type RunRequest = { selection: ExportSelection; target: { destination: string; folderName: string }; confirmed: boolean };

/** Every check before an export starts; throws the CONFLICT / INVALID_REQUEST the dialog explains. */
async function prepare(s: MainServices, req: RunRequest) {
  const rt = await activeRuntime(s);
  const target = await resolveTarget(s, rt, req.target);
  const c = await collect(s, rt, req.selection);
  // Copies of the originals can be large: above the limit the user confirms the size first (D-253). One confirmation covers both asks.
  const copyBytes = req.selection.sources === 'copies' ? c.docs.reduce((n, d) => (d.missing ? n : n + d.size), 0) : 0;
  const large = copyBytes > EXPORT_LIMITS.copyConfirmBytes;
  if (!req.confirmed && (c.aiDisabled > 0 || large)) {
    throw new AppError('CONFLICT', 'Confirm to export the documents not enabled for the AI and the large copy', {
      reason: c.aiDisabled > 0 ? 'needs-confirmation' : 'large-copy',
      documents: c.aiDisabled,
      copyBytes: large ? copyBytes : 0,
    });
  }
  const info = await inspectTarget(target.dir, rt.libraryId);
  if (info.state === 'not-empty') throw new AppError('CONFLICT', 'The folder is not empty and is not an export of this library', { reason: 'not-empty' });
  if (info.state === 'other-library') throw new AppError('CONFLICT', 'The folder is an export of another library', { reason: 'other-library' });
  return { rt, target, c, info };
}

export async function run(s: MainServices, req: RunRequest): Promise<{ jobId: string }> {
  const jobs = jobsOf(s);
  const busy = () => new AppError('CONFLICT', 'An export is already running', { reason: 'busy' });
  for (const j of jobs.values()) if (j.state === 'running') throw busy();
  // Claimed before the first await: two calls in a row cannot both get past the check while the first one is preparing.
  if (starting.has(s)) throw busy();
  starting.add(s);
  let job: Job;
  let ctx: Awaited<ReturnType<typeof prepare>>;
  try {
    ctx = await prepare(s, req);
    job = newJob(ctx.rt, ctx.target);
    jobs.set(job.jobId, job);
  } finally {
    starting.delete(s);
  }
  const { rt, target, c, info } = ctx;
  for (const [id, j] of jobs) if (jobs.size > JOBS_KEPT && j.state !== 'running') jobs.delete(id);
  let lastEmit = 0;
  const emit = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_MIN_GAP_MS) return;
    lastEmit = now;
    s.emit('export:progress', statusOf(job));
  };
  job.finished = execute(s, rt, c, req.selection, target, info, job, emit).catch((e: unknown) => {
    job.state = 'failed';
    job.error = { code: AppError.from(e).code, message: AppError.from(e).message };
    s.log.warn('the export failed', { error: e });
  }).finally(() => {
    job.phase = 'done';
    emit(true);
  });
  return { jobId: job.jobId };
}

function newJob(rt: LibraryRuntime, target: ExportTarget): Job {
  return {
    jobId: randomUUID(),
    libraryId: rt.libraryId,
    state: 'running',
    phase: 'collect',
    done: 0,
    total: 0,
    result: null,
    error: null,
    controller: new AbortController(),
    dir: target.dir,
    finished: Promise.resolve(),
  };
}

async function execute(s: MainServices, rt: LibraryRuntime, c: Collected, selection: ExportSelection, target: ExportTarget, info: { state: TargetState; manifest: ExportManifest | null }, job: Job, emit: (force: boolean) => void): Promise<void> {
  const manifest: ExportManifest = info.manifest ?? { format: 1, libraryId: rt.libraryId, exportedAt: new Date().toISOString(), citekeys: {}, titles: {}, files: {} };
  const files: Record<string, ManifestFile> = { ...manifest.files };
  const tally = { written: 0, updated: 0, unchanged: 0, keptEdited: [] as string[], copiedBytes: 0 };
  await target.ensure();
  // The citekeys and titles of this run, as soon as the pipeline has them: every save of the manifest holds them.
  let keys: Pick<PipelineOutput, 'citekeys' | 'titles'> | undefined;
  const flush = () => target.write(MANIFEST_FILE, serializeManifest({ ...manifest, exportedAt: new Date().toISOString(), citekeys: keys?.citekeys ?? manifest.citekeys, titles: keys?.titles ?? manifest.titles, files }));
  // A first run that stops half way must leave a folder that is recognisably this library's.
  if (info.state !== 'previous-export') await flush();
  let sinceFlush = 0;
  let lastFlush = Date.now();
  // Saved every FLUSH_EVERY files or FLUSH_MAX_GAP_MS: what a crash leaves is recognised again by the next run anyway.
  const tick = async () => {
    if (++sinceFlush < FLUSH_EVERY && Date.now() - lastFlush < FLUSH_MAX_GAP_MS) return;
    sinceFlush = 0;
    lastFlush = Date.now();
    await flush();
  };
  const sink: Sink = {
    async put(spec): Promise<FileOutcome> {
      const existing = await target.read(spec.rel);
      const m = mergeSpec(spec, existing, files[spec.rel]);
      if (m.text !== null) await target.write(spec.rel, m.text);
      if (m.entry) files[spec.rel] = m.entry;
      if (m.outcome === 'new') tally.written++;
      else if (m.outcome === 'updated') tally.updated++;
      else if (m.outcome === 'unchanged') tally.unchanged++;
      else tally.keptEdited.push(spec.rel);
      await tick();
      return m.outcome;
    },
    async copy(src, rel) {
      const r = await target.copySource(src, rel, files[rel]?.size);
      if (r.state === 'kept') return { state: 'kept', bytes: 0 };
      files[rel] = { size: r.size };
      await tick();
      return { state: r.state, bytes: r.state === 'copied' ? r.size : 0 };
    },
  };
  let out: PipelineOutput | undefined;
  try {
    out = await generate(
      {
        s,
        rt,
        c,
        selection,
        manifest: info.manifest,
        libraryName: c.config.name,
        signal: job.controller.signal,
        onKeys: (k) => {
          keys = k;
        },
        onProgress: (phase, done, total) => {
          job.phase = phase;
          job.done = done;
          job.total = total;
          emit(false);
        },
      },
      sink,
    );
    tally.copiedBytes = out.copyBytes;
  } finally {
    // What was written is recorded even when the run was cancelled or failed.
    await flush().catch((e: unknown) => s.log.warn('the export manifest could not be written', { error: e }));
  }
  job.result = { dir: target.dir, written: tally.written, updated: tally.updated, unchanged: tally.unchanged, keptEdited: [...tally.keptEdited, ...out.copyKept].slice(0, 1000), copyErrors: out.copyErrors.slice(0, 200), orphaned: out.orphaned, copiedBytes: tally.copiedBytes };
  job.state = out.cancelled ? 'cancelled' : 'done';
}

const jobOf = (s: MainServices, jobId: string): Job => {
  const j = jobsOf(s).get(jobId);
  if (!j) throw new AppError('NOT_FOUND', 'Unknown export job');
  return j;
};

export const status = (s: MainServices, jobId: string) => statusOf(jobOf(s, jobId));

export function cancel(s: MainServices, jobId: string): { cancelled: boolean } {
  const j = jobsOf(s).get(jobId);
  if (!j || j.state !== 'running') return { cancelled: false };
  j.controller.abort();
  return { cancelled: true };
}

/** Opens the folder of a finished export of this session; never a path from the renderer. */
export async function reveal(s: MainServices, jobId: string): Promise<{ ok: true }> {
  const j = jobOf(s, jobId);
  if (j.state === 'running' || j.result === null) throw new AppError('CONFLICT', 'The export has not finished', { reason: 'running' });
  const err = await s.shell.openPath(j.dir);
  if (err) throw new AppError('IO_ERROR', 'The folder could not be opened');
  return { ok: true };
}

/** Resolves when the running export (if any) has finished (tests). */
export async function whenExported(s: MainServices): Promise<void> {
  await Promise.all([...jobsOf(s).values()].map((j) => j.finished));
}

export { EXPORT_LIMITS };
