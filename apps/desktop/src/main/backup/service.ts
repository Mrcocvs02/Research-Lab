import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  appSettingsSchema,
  BACKUP_FORMAT_VERSION,
  BACKUP_LIMITS,
  dataDirNameSchema,
  DATA_SUBDIRS,
  dataPath,
  effectiveShortcuts,
  findShortcutConflicts,
  languageSchema,
  libraryConfigSchema,
  shortcutOverridesSchema,
  userProfileSchema,
  type AppSettings,
  type BackupInfo,
  type BackupJobStatus,
  type BackupManifest,
  type BackupSettings,
} from '@rl/core';
import { atomicWriteJson, readJsonFile, resolveInRoot } from '@rl/core/node';
import type { MainServices } from '../ipc/handlers/services.js';
import { isInsideLibrary } from '../export/target.js';
import { reconcileMcp } from '../mcp/service.js';
import { collectFiles, extractArchive, LOCAL_PREFIX, openArchive, renameIntoPlace, verifyArchive, writeArchive, type SourceFile } from './archive.js';
import { readState, updateState } from './state.js';

type JobKind = 'create' | 'verify' | 'restore';
type Result = NonNullable<BackupJobStatus['result']>;

interface Job {
  jobId: string;
  kind: JobKind;
  state: BackupJobStatus['state'];
  phase: BackupJobStatus['phase'];
  done: number;
  total: number;
  result: BackupJobStatus['result'];
  error: BackupJobStatus['error'];
  controller: AbortController;
  /** The backup file of this job (written by `create`, read by `verify` and `restore`), for `reveal`. */
  file: string | null;
  finished: Promise<void>;
}

const JOBS_KEPT = 10;
const PROGRESS_MIN_GAP_MS = 150;
/** Compressed size estimate for the free-space check: the data folder is JSON and Markdown, which deflate far below half. */
const SPACE_FACTOR = 0.5;
/** A `.part` file older than this is the residue of a crash (a running backup rewrites its file all the time). */
const STALE_PART_MS = 60 * 60 * 1000;
const PART_PREFIX = '.rlbackup-';
const CADENCE_MS = { daily: 24 * 3600_000, weekly: 7 * 24 * 3600_000, monthly: 30 * 24 * 3600_000 } as const;

const starting = new WeakSet<object>();
const registries = new WeakMap<object, Map<string, Job>>();
const jobsOf = (s: MainServices): Map<string, Job> => {
  let m = registries.get(s);
  if (!m) registries.set(s, (m = new Map()));
  return m;
};
const statusOf = (j: Job): BackupJobStatus => ({ jobId: j.jobId, kind: j.kind, state: j.state, phase: j.phase, done: j.done, total: j.total, result: j.result, error: j.error });
const emptyResult = (over: Partial<Result> = {}): Result => ({ file: null, bytes: 0, files: 0, problemCount: 0, problems: [], restoredLibraryId: null, settingsRestored: false, secretsToEnter: [], ...over });

/** True while a backup job runs (the maintenance clean waits for it). */
export const backupRunning = (s: MainServices): boolean => starting.has(s) || [...jobsOf(s).values()].some((j) => j.state === 'running');

const sameFile = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const isBackupName = (n: string) => n.toLowerCase().endsWith(BACKUP_LIMITS.extension);

/* ------------------------------------------------------------------ jobs */

async function exclusive<T>(s: MainServices, prep: () => Promise<T>): Promise<T> {
  if (backupRunning(s)) throw new AppError('CONFLICT', 'A backup job is already running', { reason: 'busy' });
  starting.add(s);
  try {
    return await prep();
  } finally {
    starting.delete(s);
  }
}

/** Registers and starts a job; `run` reports progress through `set`. The job's own errors never escape: they become its state. */
function launch(s: MainServices, kind: JobKind, total: number, file: string | null, run: (job: Job, set: (phase: Job['phase'], addBytes?: number) => void) => Promise<Result>): { jobId: string } {
  const jobs = jobsOf(s);
  const job: Job = { jobId: randomUUID(), kind, state: 'running', phase: 'collect', done: 0, total, result: null, error: null, controller: new AbortController(), file, finished: Promise.resolve() };
  jobs.set(job.jobId, job);
  for (const [id, j] of jobs) if (jobs.size > JOBS_KEPT && j.state !== 'running') jobs.delete(id);
  let last = 0;
  const emit = (force: boolean) => {
    const now = Date.now();
    if (!force && now - last < PROGRESS_MIN_GAP_MS) return;
    last = now;
    s.emit('backup:progress', statusOf(job));
  };
  const set = (phase: Job['phase'], add = 0) => {
    const phaseChanged = job.phase !== phase;
    job.phase = phase;
    job.done += add;
    emit(phaseChanged);
  };
  job.finished = (async () => {
    try {
      // A run that returned normally is done, even when a cancel arrived at the last moment (the file or library exists).
      job.result = await run(job, set);
      job.state = 'done';
    } catch (e) {
      if (job.controller.signal.aborted || AppError.from(e).code === 'CANCELLED') {
        job.state = 'cancelled';
        job.result = null;
      } else {
        const err = AppError.from(e);
        job.state = 'failed';
        // The reason (integrity, too-large, ...) is a structured field and also the first token of the message.
        const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
        job.error = { code: err.code, message: reason ? `${reason}: ${err.message}` : err.message, ...(reason ? { reason } : {}) };
        s.log.warn(`the ${kind} of a backup failed`, { error: e });
      }
    } finally {
      job.phase = 'done';
      emit(true);
    }
  })();
  return { jobId: job.jobId };
}

const reasonOf = (e: AppError): string => (typeof e.details?.reason === 'string' ? e.details.reason : e.code);

const jobOf = (s: MainServices, jobId: string): Job => {
  const j = jobsOf(s).get(jobId);
  if (!j) throw new AppError('NOT_FOUND', 'Unknown backup job');
  return j;
};

export const status = (s: MainServices, jobId: string): BackupJobStatus => statusOf(jobOf(s, jobId));

export function cancel(s: MainServices, jobId: string): { cancelled: boolean } {
  const j = jobsOf(s).get(jobId);
  if (!j || j.state !== 'running') return { cancelled: false };
  j.controller.abort();
  return { cancelled: true };
}

/** Cancels every running job (app quit); `whenBackupDone` then waits for their clean-up. */
export function cancelAllBackups(s: MainServices): void {
  for (const j of jobsOf(s).values()) if (j.state === 'running') j.controller.abort();
}

/** Resolves when the running job (if any) has finished (tests, the start-up check, the quit). */
export async function whenBackupDone(s: MainServices): Promise<void> {
  await Promise.all([...jobsOf(s).values()].map((j) => j.finished));
}

/* -------------------------------------------------------------- settings */

export async function getSettings(s: MainServices): Promise<BackupSettings> {
  const app = await s.settings.get();
  const st = await readState(s.localDataDir);
  const dest = app.backup.destination;
  const active = app.activeLibraryId;
  const last = dest && active && st.destination !== null && sameFile(st.destination, dest) ? (st.lastBackup[active] ?? null) : null;
  return { destination: dest, auto: app.backup.auto, keep: app.backup.keep, lastBackupAt: last, lastAutoError: st.lastAutoError };
}

/** CONFLICT `inside-library` when `dir` is inside the root (or data folder) of any library profile, links and case resolved (D-252). */
async function assertOutsideLibraries(settings: AppSettings, dir: string): Promise<void> {
  for (const lib of settings.libraries) {
    const inside = await isInsideLibrary(lib.rootPath, dir).catch(() => false);
    if (inside) throw new AppError('CONFLICT', 'The backup folder cannot be inside a library folder', { reason: 'inside-library' });
  }
}

export async function chooseDestination(s: MainServices): Promise<BackupSettings | null> {
  const picked = await s.pickFolder('backup-destination');
  if (!picked) return null;
  s.approved.add(picked, 'backup-destination');
  const dest = s.approved.resolve(picked, 'backup-destination');
  if (dest === null) throw new AppError('INVALID_REQUEST', 'Not a usable folder', { reason: 'invalid-path' });
  const st = await stat(dest).catch(() => null);
  if (!st?.isDirectory()) throw new AppError('NOT_FOUND', 'The chosen folder does not exist');
  await assertOutsideLibraries(await s.settings.get(), dest);
  await s.settings.update((a) => {
    a.backup.destination = dest;
  });
  return getSettings(s);
}

export async function configure(s: MainServices, req: { auto?: AppSettings['backup']['auto'] | undefined; keep?: number | undefined; clearDestination?: boolean | undefined }): Promise<BackupSettings> {
  await s.settings.update((a) => {
    if (req.auto !== undefined) a.backup.auto = req.auto;
    if (req.keep !== undefined) a.backup.keep = req.keep;
    if (req.clearDestination) a.backup.destination = null;
  });
  return getSettings(s);
}

/* ---------------------------------------------------------------- create */

const slugOf = (name: string) => name.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'library';
const stampOf = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function freeBytes(dir: string | null): Promise<number | null> {
  if (!dir) return null;
  try {
    const f = await statfs(dir);
    return Number(f.bavail) * Number(f.bsize);
  } catch {
    return null;
  }
}

async function gather(s: MainServices, libraryId: string, dataDir: string, includeLocal: boolean) {
  const data = await collectFiles(dataDir, BACKUP_LIMITS.entries);
  const local = includeLocal ? await collectFiles(path.join(s.localDataDir, 'chat', libraryId), BACKUP_LIMITS.entries) : { files: [] as SourceFile[], bytes: 0 };
  // settings.json and manifest.json are two more entries.
  if (data.files.length + local.files.length + 2 > BACKUP_LIMITS.entries) throw new AppError('CONFLICT', 'The library has too many files for one backup', { reason: 'too-large', limit: BACKUP_LIMITS.entries });
  return { data, local };
}

export async function preview(s: MainServices, req: { libraryId?: string | undefined; includeLocal: boolean }) {
  const profile = await s.libraries.profile(req.libraryId);
  const dataDir = await s.libraries.dataDir(profile.id);
  const { data, local } = await gather(s, profile.id, dataDir, req.includeLocal);
  const app = await s.settings.get();
  return { dataFiles: data.files.length, dataBytes: data.bytes, localFiles: local.files.length, localBytes: local.bytes, freeBytes: await freeBytes(app.backup.destination) };
}

const portableSettings = (a: AppSettings): Buffer =>
  Buffer.from(`${JSON.stringify({ formatVersion: BACKUP_FORMAT_VERSION, uiLanguage: a.uiLanguage, user: a.user, appearance: a.appearance, shortcuts: a.shortcuts, guide: a.guide })}\n`, 'utf8');

async function removeStaleParts(dest: string): Promise<void> {
  for (const name of await readdir(dest).catch(() => [] as string[])) {
    if (!name.startsWith(PART_PREFIX) || !name.endsWith('.part')) continue;
    const st = await lstat(path.join(dest, name)).catch(() => null);
    if (st?.isFile() && Date.now() - st.mtimeMs > STALE_PART_MS) await rm(path.join(dest, name), { force: true }).catch(() => {});
  }
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Residue of a restore that was cut short by a crash or a kill: `<dataDirName>.restore-<12 hex>` in the target root and
 * `restore-<12 hex>` in the local data folder. Only folders of exactly that shape, that are real folders (never links)
 * and that no profile uses, are removed. Runs inside the exclusive section, so no job of ours is writing them.
 */
export async function sweepRestoreResidue(s: MainServices, root: string | null, dataDirName: string | null): Promise<number> {
  const profiles = (await s.settings.get()).libraries;
  const used = new Set<string>();
  for (const l of profiles) {
    used.add(path.resolve(l.rootPath, l.dataDirName).toLowerCase());
    used.add(path.resolve(s.localDataDir, 'chat', l.id).toLowerCase());
  }
  let removed = 0;
  const sweep = async (dir: string, pattern: RegExp): Promise<void> => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!pattern.test(name)) continue;
      const abs = path.join(dir, name);
      if (used.has(path.resolve(abs).toLowerCase())) continue;
      const st = await lstat(abs).catch(() => null);
      if (!st?.isDirectory()) continue;
      await rm(abs, { recursive: true, force: true }).then(() => removed++, () => {});
    }
  };
  if (root && dataDirName) await sweep(root, new RegExp(`^${escapeRe(dataDirName)}\\.restore-[0-9a-f]{12}$`));
  await sweep(s.localDataDir, /^restore-[0-9a-f]{12}$/);
  return removed;
}

/** Renames with the retries of `renameRetry` (a scanner or sync client can hold a fresh file for a moment). */
async function renameFileRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw new AppError('IO_ERROR', 'The backup file could not be put in place', { code });
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}

async function uniqueFinal(dest: string, base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}${BACKUP_LIMITS.extension}` : `${base}-${i}${BACKUP_LIMITS.extension}`;
    if (!(await stat(path.join(dest, name)).then(() => true, () => false))) return path.join(dest, name);
  }
}

export interface CreateRequest {
  libraryId?: string | undefined;
  includeLocal: boolean;
  origin?: 'manual' | 'auto';
}

export function create(s: MainServices, req: CreateRequest): Promise<{ jobId: string }> {
  return exclusive(s, async () => {
    // The chats are the one part that is not rebuildable and may hold sensitive text: an automatic backup never takes
    // them; only a manual backup, with the user's explicit choice, does (D-295).
    const includeLocal = (req.origin ?? 'manual') === 'manual' && req.includeLocal;
    const profile = await s.libraries.profile(req.libraryId);
    const app = await s.settings.get();
    const dest = app.backup.destination;
    if (!dest) throw new AppError('CONFLICT', 'Choose a folder for the backups first', { reason: 'no-destination' });
    const destStat = await stat(dest).catch(() => null);
    if (!destStat?.isDirectory()) throw new AppError('CONFLICT', 'The backup folder does not exist', { reason: 'no-destination' });
    await assertOutsideLibraries(app, dest);
    const dataDir = await s.libraries.dataDir(profile.id);
    if (!(await stat(dataDir).then((st) => st.isDirectory(), () => false))) throw new AppError('NOT_FOUND', 'The library data folder is missing');
    const config = await s.libraries.getConfig(profile.id);
    const { data, local } = await gather(s, profile.id, dataDir, includeLocal);
    const total = data.bytes + local.bytes;
    const free = await freeBytes(dest);
    const needed = Math.ceil(total * SPACE_FACTOR);
    if (free !== null && free < needed) throw new AppError('CONFLICT', 'Not enough free space in the backup folder', { reason: 'not-enough-space', needed, free });
    const origin = req.origin ?? 'manual';
    const documents = data.files.filter((f) => f.rel.startsWith('documents/')).length;
    const createdAt = new Date();
    return launch(s, 'create', total, null, async (job, set) => {
      set('write');
      await removeStaleParts(dest);
      await sweepRestoreResidue(s, null, null).catch(() => 0);
      const tmp = path.join(dest, `${PART_PREFIX}${randomBytes(6).toString('hex')}.part`);
      try {
        const written = await writeArchive({
          tmpFile: tmp,
          library: data.files,
          local: local.files,
          settings: portableSettings(app),
          base: { format: 'rl-backup', formatVersion: BACKUP_FORMAT_VERSION, createdAt: createdAt.toISOString(), appVersion: s.appInfo().version.slice(0, 40), sourceLibraryId: profile.id, libraryName: profile.name, language: config.language, dataDirName: profile.dataDirName, origin },
          documents,
          signal: job.controller.signal,
          onBytes: (n) => set('write', n),
        });
        if (job.controller.signal.aborted) throw new AppError('CANCELLED', 'The backup was cancelled');
        set('finish');
        const finalPath = await uniqueFinal(dest, `${slugOf(profile.name)}-${stampOf(createdAt)}`);
        await renameFileRetry(tmp, finalPath);
        job.file = finalPath;
        await updateState(s.localDataDir, (st) => {
          st.destination = dest;
          st.lastBackup[profile.id] = createdAt.toISOString();
          if (origin === 'auto') st.lastAutoError = null;
        });
        await applyRetention(dest, profile.id, app.backup.keep).catch((e: unknown) => s.log.warn('old automatic backups could not be removed', { error: e }));
        return emptyResult({ file: finalPath, bytes: written.bytes, files: written.files, skipped: written.skipped });
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
    });
  });
}

/* ------------------------------------------------------- list and files */

function infoOf(file: string, bytes: number, m: BackupManifest | null, header: Record<string, unknown>): BackupInfo {
  const str = (k: string, max: number) => (typeof header[k] === 'string' ? (header[k] as string).slice(0, max) : '');
  const lang = languageSchema.safeParse(header.language);
  const createdAt = typeof header.createdAt === 'string' && !Number.isNaN(Date.parse(header.createdAt)) ? new Date(header.createdAt).toISOString() : new Date(0).toISOString();
  if (m) {
    return { file, name: path.basename(file), bytes, createdAt: m.createdAt, appVersion: m.appVersion, libraryName: m.libraryName, language: m.language, documents: m.documents, files: m.entries.length, includesLocal: m.includesLocal, includesSettings: m.includesSettings, origin: m.origin, newerFormat: false };
  }
  return { file, name: path.basename(file), bytes, createdAt, appVersion: str('appVersion', 40), libraryName: str('libraryName', 120), language: lang.success ? lang.data : 'it', documents: 0, files: 0, includesLocal: false, includesSettings: false, origin: header.origin === 'auto' ? 'auto' : 'manual', newerFormat: true };
}

interface Listed {
  info: BackupInfo;
  libraryId: string | null;
}

async function listIn(dest: string, max: number): Promise<Listed[]> {
  const names = (await readdir(dest).catch(() => [] as string[])).filter(isBackupName);
  const files: Array<{ file: string; mtime: number; size: number }> = [];
  for (const n of names) {
    const file = path.join(dest, n);
    const st = await lstat(file).catch(() => null);
    if (st?.isFile()) files.push({ file, mtime: st.mtimeMs, size: st.size });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out: Listed[] = [];
  for (const f of files.slice(0, max)) {
    try {
      const { reader, manifest, header } = await openArchive(f.file);
      out.push({ info: infoOf(f.file, reader.size, manifest, header), libraryId: manifest?.sourceLibraryId ?? (typeof header.sourceLibraryId === 'string' ? header.sourceLibraryId : null) });
    } catch {
      // not one of ours (or damaged): left out of the list
    }
  }
  return out.sort((a, b) => b.info.createdAt.localeCompare(a.info.createdAt));
}

export async function list(s: MainServices): Promise<{ items: BackupInfo[] }> {
  const app = await s.settings.get();
  const dest = app.backup.destination;
  if (!dest) return { items: [] };
  const all = await listIn(dest, BACKUP_LIMITS.listed);
  for (const l of all) s.approved.add(l.info.file, 'backup-file');
  const active = app.activeLibraryId;
  if (active) {
    const newest = all.find((l) => l.libraryId === active)?.info.createdAt ?? null;
    await updateState(s.localDataDir, (st) => {
      st.destination = dest;
      if (newest) st.lastBackup[active] = newest;
      else delete st.lastBackup[active];
    }).catch(() => {});
  }
  return { items: all.map((l) => l.info) };
}

async function applyRetention(dest: string, libraryId: string, keep: number): Promise<void> {
  const autos = (await listIn(dest, 1000)).filter((l) => l.libraryId === libraryId && l.info.origin === 'auto');
  for (const old of autos.slice(keep)) await rm(old.info.file, { force: true });
}

/** The canonical path of a backup file the user picked or that `list` approved; never the renderer's spelling. */
function approvedFile(s: MainServices, file: string): string {
  const f = s.approved.resolve(file, 'backup-file');
  if (f === null) throw new AppError('INVALID_REQUEST', 'The backup file was not chosen with the file dialog or listed by the app', { reason: 'file-not-approved' });
  return f;
}

export async function inspect(s: MainServices, req: { file: string }): Promise<BackupInfo> {
  const f = approvedFile(s, req.file);
  const { reader, manifest, header } = await openArchive(f);
  return infoOf(f, reader.size, manifest, header);
}

export async function remove(s: MainServices, req: { file: string }): Promise<{ ok: true }> {
  const f = approvedFile(s, req.file);
  const dest = (await s.settings.get()).backup.destination;
  if (!dest || !sameFile(path.dirname(f), path.resolve(dest)) || !isBackupName(f)) throw new AppError('INVALID_REQUEST', 'Only backups listed in the backup folder can be removed', { reason: 'file-not-listed' });
  // A verify or restore reading this file, or a job about to start, would lose it under its feet.
  if (starting.has(s) || [...jobsOf(s).values()].some((j) => j.state === 'running' && j.file !== null && sameFile(j.file, f))) {
    throw new AppError('CONFLICT', 'A backup job is using this file', { reason: 'busy' });
  }
  const st = await lstat(f).catch(() => null);
  if (!st?.isFile()) throw new AppError('NOT_FOUND', 'The backup file does not exist');
  await openArchive(f); // a file that is not a backup is never deleted from here
  await rm(f, { force: true });
  return { ok: true };
}

export async function reveal(s: MainServices, req: { jobId?: string | undefined; file?: string | undefined }): Promise<{ ok: true }> {
  let file: string | null = null;
  if (req.jobId !== undefined) {
    const j = jobOf(s, req.jobId);
    if (j.state === 'running') throw new AppError('CONFLICT', 'The backup job has not finished', { reason: 'running' });
    file = j.file;
  } else if (req.file !== undefined) file = approvedFile(s, req.file);
  if (!file) throw new AppError('NOT_FOUND', 'There is no backup file to show');
  s.shell.showItemInFolder(file);
  return { ok: true };
}

/* ---------------------------------------------------------------- verify */

const sumSizes = (m: BackupManifest) => m.entries.reduce((n, e) => n + e.size, 0);

export function verify(s: MainServices, req: { file: string }): Promise<{ jobId: string }> {
  return exclusive(s, async () => {
    const f = approvedFile(s, req.file);
    const { reader, manifest } = await openArchive(f);
    if (!manifest) throw new AppError('CONFLICT', 'The backup was made by a newer version of the app', { reason: 'newer-format' });
    return launch(s, 'verify', sumSizes(manifest), f, async (job, set) => {
      set('verify');
      const out = await verifyArchive(reader, manifest, { signal: job.controller.signal, onBytes: (n) => set('verify', n) });
      return emptyResult({ file: f, bytes: reader.size, files: out.files, problemCount: out.problemCount, problems: out.problems });
    });
  });
}

/* --------------------------------------------------------------- restore */

const portableOf = (raw: Buffer | null) => {
  if (!raw) return null;
  let json: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    json = v as Record<string, unknown>;
  } catch {
    return null;
  }
  // Each part is checked on its own: one invalid part never drops the others.
  const out: Partial<Pick<AppSettings, 'uiLanguage' | 'user' | 'appearance' | 'shortcuts' | 'guide'>> = {};
  const lang = languageSchema.safeParse(json.uiLanguage);
  if (lang.success) out.uiLanguage = lang.data;
  const user = userProfileSchema.safeParse(json.user);
  if (user.success) out.user = user.data;
  const look = appSettingsSchema.shape.appearance.safeParse(json.appearance);
  if (look.success) out.appearance = look.data;
  const keys = shortcutOverridesSchema.safeParse(json.shortcuts);
  if (keys.success && findShortcutConflicts(effectiveShortcuts(keys.data)).length === 0) out.shortcuts = keys.data;
  const guide = appSettingsSchema.shape.guide.safeParse(json.guide);
  if (guide.success) out.guide = guide.data;
  return Object.keys(out).length > 0 ? out : null;
};

async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await renameIntoPlace(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      // A virus scanner or a sync client can hold a fresh folder for a moment.
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw new AppError('IO_ERROR', 'The restored folder could not be put in place', { code });
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}

export interface RestoreRequest {
  file: string;
  rootPath: string;
  name?: string | undefined;
  restoreLocal: boolean;
  restoreSettings: boolean;
}

export function restore(s: MainServices, req: RestoreRequest): Promise<{ jobId: string }> {
  return exclusive(s, async () => {
    const f = approvedFile(s, req.file);
    const root = s.approved.resolve(req.rootPath, 'library-root');
    if (root === null) throw new AppError('PERMISSION_DENIED', 'The folder must be chosen with the folder dialog');
    if (!(await stat(root).then((st) => st.isDirectory(), () => false))) throw new AppError('NOT_FOUND', 'The chosen folder does not exist');
    const { reader, manifest } = await openArchive(f);
    if (!manifest) throw new AppError('CONFLICT', 'The backup was made by a newer version of the app', { reason: 'newer-format' });
    const dirName = dataDirNameSchema.safeParse(manifest.dataDirName);
    if (!dirName.success) throw new AppError('INVALID_REQUEST', 'The file is not a Research Lab backup', { reason: 'not-a-backup', why: 'data-dir-name' });
    const dataDirName = dirName.data;
    const app = await s.settings.get();
    if (app.libraries.some((l) => sameFile(path.resolve(l.rootPath), path.resolve(root)))) {
      throw new AppError('CONFLICT', 'A library already uses this folder', { reason: 'already-registered' });
    }
    await sweepRestoreResidue(s, root, dataDirName).catch((e: unknown) => s.log.warn('old restore folders could not be removed', { error: e }));
    const dataDir = await resolveInRoot(root, dataDirName);
    const existing = await stat(dataDir).then((st) => st, () => null);
    if (existing && (!existing.isDirectory() || (await readdir(dataDir)).length > 0)) throw new AppError('CONFLICT', 'The data folder already exists and is not empty', { reason: 'not-empty' });
    const withLocal = req.restoreLocal && manifest.includesLocal;
    const bytes = sumSizes(manifest);
    // Free space on both volumes (uncompressed sizes are exact): the data folder goes to the root, the chats to the local folder.
    const localBytes = withLocal ? manifest.entries.filter((e) => e.path.startsWith(LOCAL_PREFIX)).reduce((n, e) => n + e.size, 0) : 0;
    const dataBytes = manifest.entries.filter((e) => !e.path.startsWith(LOCAL_PREFIX)).reduce((n, e) => n + e.size, 0);
    for (const [dir, needed] of [[root, dataBytes], [s.localDataDir, localBytes]] as const) {
      const free = await freeBytes(dir);
      if (needed > 0 && free !== null && free < needed) throw new AppError('CONFLICT', 'Not enough free space to restore the backup', { reason: 'not-enough-space', needed, free });
    }
    return launch(s, 'restore', bytes * 2, f, async (job, set) => {
      const signal = job.controller.signal;
      set('verify');
      const check = await verifyArchive(reader, manifest, { signal, onBytes: (n) => set('verify', n) });
      if (check.problemCount > 0) {
        job.result = emptyResult({ file: f, bytes: reader.size, files: check.files, problemCount: check.problemCount, problems: check.problems });
        throw new AppError('CONFLICT', 'The backup is damaged or has been changed', { reason: 'integrity', problemCount: check.problemCount });
      }
      const extractAndRegister = async (): Promise<Result> => {
        const id = `lib-${randomBytes(4).toString('hex')}`;
        const salt = randomBytes(6).toString('hex');
        const tmpData = path.join(root, `${dataDirName}.restore-${salt}`);
        const tmpLocal = withLocal ? path.join(s.localDataDir, `restore-${salt}`) : null;
        const chatDir = path.join(s.localDataDir, 'chat', id);
        let dataPlaced = false;
        let localPlaced = false;
        try {
          set('extract');
          const { settings: rawSettings } = await extractArchive(reader, manifest, { library: tmpData, local: tmpLocal }, { signal, onBytes: (n) => set('extract', n) });
          for (const sub of DATA_SUBDIRS) await mkdir(path.join(tmpData, sub), { recursive: true });
          const name = req.name ?? manifest.libraryName;
          const configFile = path.join(tmpData, dataPath.config);
          const parsed = await readJsonFile(configFile, libraryConfigSchema).catch(() => null);
          // A library configuration that does not parse is a damaged (or hostile) backup, never silently replaced.
          if (!parsed) throw new AppError('CONFLICT', 'The library configuration in the backup is not valid', { reason: 'integrity' });
          // A restored library never starts with the MCP server on, with writes allowed or without the confirmation
          // before an AI send: those are the user's choice again on this machine (D-295). Folders and usage cap stay.
          const resetOnRestore: NonNullable<Result['resetOnRestore']> = [];
          const config = structuredClone(parsed);
          if (config.mcp.enabled) resetOnRestore.push('mcp');
          if (config.mcp.writeEnabled) resetOnRestore.push('mcp-write');
          if (!config.ai.confirmBeforeSend) resetOnRestore.push('confirm-before-send');
          config.mcp.enabled = false;
          config.mcp.writeEnabled = false;
          config.ai.confirmBeforeSend = true;
          config.name = name;
          if (resetOnRestore.length > 0 || parsed.name !== name) await atomicWriteJson(configFile, config);
          if (signal.aborted) throw new AppError('CANCELLED', 'The restore was cancelled');
          set('finish');
          await renameRetry(tmpData, dataDir);
          dataPlaced = true;
          if (tmpLocal) {
            await mkdir(path.dirname(chatDir), { recursive: true });
            await rename(tmpLocal, chatDir);
            localPlaced = true;
          }
          const portable = req.restoreSettings ? portableOf(rawSettings) : null;
          await s.settings.update((a) => {
            a.libraries.push({ id, name, rootPath: root, dataDirName, createdAt: new Date().toISOString() });
            if (a.activeLibraryId === null) a.activeLibraryId = id;
            if (portable) Object.assign(a, portable);
          });
          // From here the library is registered and nothing may undo it half way: the steps below are best effort
          // (logged, never fatal), so the job never ends `failed` with a profile or data folder behind (D-295).
          let secretsToEnter: Result['secretsToEnter'] = [];
          try {
            secretsToEnter = await missingSecrets(s, id, config);
            if ((await s.settings.get()).activeLibraryId === id) {
              await s.runtime.sync({ autoScan: true });
              await reconcileMcp(s);
            }
          } catch (e) {
            s.log.warn('the restored library was registered but a follow-up step failed', { error: e });
          }
          return emptyResult({ file: f, bytes: reader.size, files: check.files, restoredLibraryId: id, settingsRestored: portable !== null, secretsToEnter, resetOnRestore });
        } catch (e) {
          // Nothing is left behind: no data folder, no local copy, no profile.
          await rm(tmpData, { recursive: true, force: true }).catch(() => {});
          if (tmpLocal) await rm(tmpLocal, { recursive: true, force: true }).catch(() => {});
          if (dataPlaced) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
          if (localPlaced) await rm(chatDir, { recursive: true, force: true }).catch(() => {});
          throw e;
        }
      };
      return extractAndRegister();
    });
  });
}

/** Secrets the restored library will need again: they are never in a backup (rule 3). */
async function missingSecrets(s: MainServices, libraryId: string, config: { ai: { provider: string }; mcp: { enabled: boolean } } | null): Promise<Result['secretsToEnter']> {
  const out: Result['secretsToEnter'] = [];
  if (config?.ai.provider === 'anthropic-api' && !(await s.secrets.has({ kind: 'app' }, 'anthropic-api-key'))) out.push('anthropic-api-key');
  if (config?.mcp.enabled && !(await s.secrets.has({ kind: 'library', libraryId }, 'mcp-token'))) out.push('mcp-token');
  return out;
}

/* ------------------------------------------------------------ auto start */

/**
 * The automatic backup (D-256): checked ONCE at app start, never by a timer. Runs `create` with origin `auto` when the
 * last backup of the active library in the destination is older than the cadence. A failure is recorded (code only)
 * and shown as a notice; it never blocks anything.
 */
export async function autoBackupOnStart(s: MainServices, now: () => number = Date.now): Promise<void> {
  const app = await s.settings.get();
  if (app.backup.auto === 'off' || app.activeLibraryId === null) return;
  const fail = async (code: string) => {
    await updateState(s.localDataDir, (st) => {
      st.lastAutoError = code;
    }).catch(() => {});
    const notice = { id: `backup-failed-${now()}`, kind: 'backup-failed' as const, code: code.slice(0, 60) };
    s.settings.raiseNotice(notice);
    s.emit('app:notice', notice);
  };
  const dest = app.backup.destination;
  if (!dest) return fail('no-destination');
  try {
    const mine = (await listIn(dest, BACKUP_LIMITS.listed)).filter((l) => l.libraryId === app.activeLibraryId);
    const newest = mine[0]?.info.createdAt;
    if (newest && now() - Date.parse(newest) < CADENCE_MS[app.backup.auto]) return;
    const { jobId } = await create(s, { includeLocal: false, origin: 'auto' });
    const job = jobOf(s, jobId);
    await job.finished;
    if (job.state === 'failed') await fail(job.error?.reason ?? job.error?.code ?? 'UNKNOWN');
  } catch (e) {
    await fail(reasonOf(AppError.from(e)));
  }
}

