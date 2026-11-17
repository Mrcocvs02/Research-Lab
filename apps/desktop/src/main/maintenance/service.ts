import { lstat, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError, type MAINTENANCE_TARGETS } from '@rl/core';

type MaintenanceTarget = (typeof MAINTENANCE_TARGETS)[number];
import type { MainServices } from '../ipc/handlers/services.js';
import { backupRunning } from '../backup/service.js';
import { forgetGraphModel, graphBuilding } from '../graph/service.js';
import { graphPaths } from '../graph/paths.js';
import { localPaths } from '../library/library-runtime.js';
import { thumbDir } from '../thumbs.js';

const MB = 1024 * 1024;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Bytes of every regular file under `dir` (links are not followed); a missing folder is 0. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await lstat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

const fileSize = async (file: string): Promise<number> => (await lstat(file).catch(() => null))?.size ?? 0;
const removed = (file: string) => rm(file, { force: true }).then(() => true, () => false);

/**
 * Deletes the files under `dir` one by one (the folder itself stays); a file that cannot be removed (the open log, a
 * file another process holds) is skipped. Returns the bytes freed.
 */
export async function clearDir(dir: string): Promise<number> {
  let freed = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      freed += await clearDir(p);
      await rmdir(p).catch(() => {});
    } else {
      const size = await fileSize(p);
      if (await removed(p)) freed += size;
    }
  }
  return freed;
}

/** Every location below is built from the local data folder and fixed names; the id is a validated item id. */
const areas = (s: MainServices, id: string) => {
  const { indexFile } = localPaths(s.localDataDir, id);
  const g = graphPaths(s.localDataDir, id);
  return {
    indexFiles: [indexFile, `${indexFile}-wal`, `${indexFile}-shm`],
    cache: path.join(s.localDataDir, 'cache'),
    thumbs: thumbDir(s.localDataDir, id),
    graphFiles: [g.modelFile, g.metaFile],
    chats: path.join(s.localDataDir, 'chat', id),
    backups: path.join(s.localDataDir, 'backups', id),
    logs: path.join(s.localDataDir, 'logs'),
  };
};

export async function report(s: MainServices, req: { libraryId?: string | undefined }) {
  const profile = await s.libraries.profile(req.libraryId);
  const dataDir = await s.libraries.dataDir(profile.id);
  const a = areas(s, profile.id);
  const docs = (await readdir(path.join(dataDir, 'documents')).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).length;
  const sum = async (files: string[]) => (await Promise.all(files.map(fileSize))).reduce((n, v) => n + v, 0);
  const mem = process.memoryUsage();
  return {
    documents: docs,
    dataBytes: await dirSize(dataDir),
    local: {
      index: await sum(a.indexFiles),
      cache: await dirSize(a.cache),
      thumbs: await dirSize(a.thumbs),
      graph: await sum(a.graphFiles),
      chats: await dirSize(a.chats),
      backups: await dirSize(a.backups),
    },
    logsBytes: await dirSize(a.logs),
    process: { rssMb: round1(mem.rss / MB), heapMb: round1(mem.heapUsed / MB), uptimeSec: Math.round(process.uptime()), startupMs: s.startupMs?.() ?? null },
    workers: s.workers?.() ?? 0,
  };
}

/** True while a scan, a graph build or a backup is running: cleaning then would pull files from under them. */
async function busy(s: MainServices): Promise<boolean> {
  if (s.runtime.status().state === 'running' || backupRunning(s)) return true;
  const rt = await s.runtime.require().catch(() => null);
  return rt !== null && graphBuilding(rt);
}

/**
 * Deletes rebuildable data only: the text cache (shared by all libraries), the thumbnails of the library, the graph
 * model (the AI labels of the clusters are kept: they cost a call to make again) and the logs. Never the library data
 * folder, the search index, the chats, the settings, the secrets or the app's safety copies.
 */
export async function clean(s: MainServices, req: { libraryId?: string | undefined; targets: readonly MaintenanceTarget[] }): Promise<{ freedBytes: number }> {
  const profile = await s.libraries.profile(req.libraryId);
  if (await busy(s)) throw new AppError('CONFLICT', 'A scan, a graph build or a backup is running', { reason: 'busy' });
  const a = areas(s, profile.id);
  let freed = 0;
  for (const target of new Set(req.targets)) {
    if (target === 'cache') freed += await clearDir(a.cache);
    else if (target === 'thumbs') freed += await clearDir(a.thumbs);
    else if (target === 'logs') freed += await clearDir(a.logs);
    else {
      for (const f of a.graphFiles) {
        const size = await fileSize(f);
        if (await removed(f)) freed += size;
      }
      const rt = await s.runtime.require().catch(() => null);
      if (rt && rt.libraryId === profile.id) forgetGraphModel(rt);
    }
  }
  return { freedBytes: freed };
}

export async function openLogs(s: MainServices): Promise<{ ok: true }> {
  const dir = path.join(s.localDataDir, 'logs');
  await mkdir(dir, { recursive: true });
  const err = await s.shell.openPath(dir);
  if (err) throw new AppError('IO_ERROR', 'The log folder could not be opened');
  return { ok: true };
}

const mb = (bytes: number) => `${round1(bytes / MB)} MB`;

/** Text for a bug report: versions, counts, sizes and switches. Never a path, a name, a title, a key or a token. */
export async function diagnostics(s: MainServices): Promise<{ text: string }> {
  const info = s.appInfo();
  const app = await s.settings.get();
  const lines = [
    'Research Lab diagnostics',
    `App: ${info.name} ${info.version}`,
    `Electron: ${info.electron} / Node: ${process.versions.node}`,
    `System: ${os.platform()} ${os.release()} ${os.arch()}`,
    `Interface language: ${app.uiLanguage}`,
    `Libraries: ${app.libraries.length}`,
    `Appearance: ${app.appearance.theme}`,
    `Automatic backup: ${app.backup.auto}, folder ${app.backup.destination ? 'set' : 'not set'}`,
  ];
  if (app.activeLibraryId) {
    try {
      const r = await report(s, {});
      const config = await s.libraries.getConfig(app.activeLibraryId);
      lines.push(
        `Active library: ${r.documents} documents, language ${config.language}`,
        `AI provider: ${config.ai.provider}; MCP server: ${config.mcp.enabled ? 'on' : 'off'}${config.mcp.writeEnabled ? ' (write)' : ''}; AI folders: ${config.aiEnabledFolders.length}`,
        `Data folder: ${mb(r.dataBytes)}; index ${mb(r.local.index)}; cache ${mb(r.local.cache)}; thumbnails ${mb(r.local.thumbs)}; graph ${mb(r.local.graph)}; chats ${mb(r.local.chats)}; logs ${mb(r.logsBytes)}`,
        `Process: ${r.process.rssMb} MB resident, up ${r.process.uptimeSec} s, start ${r.process.startupMs ?? 'n/a'} ms, ${r.workers} worker(s)`,
      );
    } catch {
      lines.push('Active library: could not be read');
    }
  } else lines.push('Active library: none');
  const text = lines.join('\n');
  s.clipboard?.writeText(text);
  return { text };
}
