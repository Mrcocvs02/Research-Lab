import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { type LibraryConfig } from '@rl/core';
import { isInside, normalizeRelativePath, toRelativePath } from '@rl/core/node';
import { pathKey, toFsPath } from './fs-util.js';

export interface WatchBatch {
  /** Changed paths (files or folders), relative to the root, `/` separators, sorted. Pass them to `scan({ paths })`. */
  paths: string[];
  /** True when so many paths changed that the list was cut: run a full scan instead. */
  overflow: boolean;
}

export interface WatcherOptions {
  rootPath: string;
  /** Absolute data dir of the library: changes inside it are ignored (the app writes there itself). */
  dataDir?: string;
  /** Scan settings; a function is called at each event so settings changes apply without restarting. */
  config: Pick<LibraryConfig, 'excludedFolders' | 'scan'> | (() => Pick<LibraryConfig, 'excludedFolders' | 'scan'>);
  /** Quiet time after the last event before a batch is emitted (default 600 ms). */
  debounceMs?: number;
  /** A batch is emitted at the latest after this long even if events keep coming (default 5 s). */
  maxWaitMs?: number;
  /** More paths than this in one batch set `overflow` (default 2000). */
  maxBatch?: number;
  includeHiddenFolders?: boolean;
  onBatch: (batch: WatchBatch) => void;
  onError?: (error: Error) => void;
}

export interface LibraryWatcher {
  /** Stops watching; pending paths are dropped. Safe to call twice. */
  close(): Promise<void>;
}

const TEMP_FILE = /^(~\$|\.~lock\.|\.#)|(\.tmp|\.temp|\.part|\.partial|\.crdownload|\.download|\.swp|\.swx|~)$|^(thumbs\.db|desktop\.ini|\.ds_store)$/i;
const normExt = (x: string) => x.trim().replace(/^\./, '').toLowerCase();

/**
 * Recursive, debounced watcher of the library root (native `fs.watch`, no dependencies). It only reports WHAT changed;
 * the caller runs a targeted scan. Ignores the data dir, excluded folders, hidden folders and editor temp files.
 * Folders are reported too (a renamed folder moves every file in it).
 */
export function createWatcher(options: WatcherOptions): LibraryWatcher {
  const root = path.resolve(options.rootPath);
  const debounceMs = options.debounceMs ?? 600;
  const maxWaitMs = options.maxWaitMs ?? 5000;
  const maxBatch = options.maxBatch ?? 2000;
  const getConfig = typeof options.config === 'function' ? options.config : () => options.config as Pick<LibraryConfig, 'excludedFolders' | 'scan'>;
  let dataRel: string | null = null;
  if (options.dataDir && isInside(root, options.dataDir) && path.resolve(options.dataDir) !== root) dataRel = pathKey(toRelativePath(root, options.dataDir));

  let pending = new Set<string>();
  let overflow = false;
  let timer: NodeJS.Timeout | undefined;
  let firstAt = 0;
  let closed = false;

  const wanted = (rel: string): boolean => {
    const k = pathKey(rel);
    if (dataRel !== null && (k === dataRel || k.startsWith(`${dataRel}/`))) return false;
    const parts = rel.split('/');
    const name = parts[parts.length - 1] as string;
    if (TEMP_FILE.test(name)) return false;
    if (!options.includeHiddenFolders && parts.slice(0, -1).some((p) => p.startsWith('.'))) return false;
    if (!options.includeHiddenFolders && name.startsWith('.') && name.lastIndexOf('.') === 0) return false; // a hidden folder itself
    const cfg = getConfig();
    for (const e of cfg.excludedFolders) {
      let n: string;
      try {
        n = pathKey(normalizeRelativePath(e));
      } catch {
        continue;
      }
      if (n && (k === n || k.startsWith(`${n}/`))) return false;
    }
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return true; // no extension: may be a folder (renamed or deleted), the scan decides
    const exts = new Set([...cfg.scan.extensions, ...cfg.scan.nameOnlyExtensions].map(normExt));
    return exts.has(name.slice(dot + 1).toLowerCase());
  };

  const flush = () => {
    timer = undefined;
    firstAt = 0;
    if (closed || (pending.size === 0 && !overflow)) return;
    // A folder event next to events of files inside it only says "something in here changed": the files say more.
    const all = [...pending];
    const paths = all.filter((p) => !(p.lastIndexOf('.') <= p.lastIndexOf('/') + 1 && all.some((q) => q.startsWith(`${p}/`)))).sort();
    const over = overflow;
    pending = new Set();
    overflow = false;
    try {
      options.onBatch({ paths, overflow: over });
    } catch (e) {
      options.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const schedule = () => {
    const now = Date.now();
    if (firstAt === 0) firstAt = now;
    if (timer) clearTimeout(timer);
    const wait = Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now));
    timer = setTimeout(flush, wait);
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(toFsPath(root), { recursive: true, persistent: false }, (_event, filename) => {
      if (closed || filename === null || filename === undefined) return;
      let rel: string;
      try {
        rel = normalizeRelativePath(String(filename));
      } catch {
        return;
      }
      if (!rel || !wanted(rel)) return;
      if (pending.size >= maxBatch) overflow = true;
      else pending.add(rel);
      schedule();
    });
    watcher.on('error', (e) => options.onError?.(e));
  } catch (e) {
    queueMicrotask(() => options.onError?.(e instanceof Error ? e : new Error(String(e))));
  }

  return {
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      watcher?.close();
      watcher = undefined;
    },
  };
}
