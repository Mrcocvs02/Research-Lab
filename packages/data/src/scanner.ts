import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  DOCUMENT_LIMITS,
  SCHEMA_VERSION,
  documentIdFromHash,
  documentRecordSchema,
  type DocumentId,
  type DocumentRecord,
  type Scanner,
  type ScanError,
  type ScanOptions,
  type ScanResult,
  type ScannedFile,
} from '@rl/core';
import { isInside, normalizeRelativePath, resolveInRoot, sha256File, sha256Of, toRelativePath } from '@rl/core/node';
import { mapLimit, pathKey, toFsPath } from './fs-util.js';
import { withRetry, type RetryOptions } from './retry.js';

export interface ScannerOptions {
  /** Clock, for tests. */
  now?: () => Date;
  /** Hash function, for tests (default: streamed SHA-256). Receives the absolute path. */
  hashFile?: (file: string, signal?: AbortSignal) => Promise<string>;
  /** Retry policy for locked files (cloud sync, antivirus). */
  retry?: RetryOptions;
  /** Files hashed at the same time (default 4). */
  hashConcurrency?: number;
  /** Reports a warning-level event (never contains absolute paths). */
  onWarning?: (message: string) => void;
}

const MAX_ERRORS = 1000;
const STAT_BATCH = 32;
const L = DOCUMENT_LIMITS;

interface Found {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

const normExt = (x: string) => x.trim().replace(/^\./, '').toLowerCase();
const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
};
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) : s);
const sameStat = (d: { size: number; mtimeMs: number }, f: { size: number; mtimeMs: number }) => d.size === f.size && Math.abs(d.mtimeMs - f.mtimeMs) < 1;

/**
 * Incremental, read-only scanner of a library root (see D-040 for the matching rules).
 * It reads file contents only when path, size and mtime do not match a known record, and writes only
 * through `store.documents.update`.
 */
export function createScannerImpl(opts: ScannerOptions = {}): Scanner {
  const clock = opts.now ?? (() => new Date());
  const hashFile = opts.hashFile ?? ((file: string, signal?: AbortSignal) => sha256File(toFsPath(file), signal));
  const hashConcurrency = opts.hashConcurrency ?? 4;

  return {
    async scan(rootPath: string, options: ScanOptions): Promise<ScanResult> {
      const { store, signal } = options;
      const root = path.resolve(rootPath);
      const nowIso = clock().toISOString();
      const markInbox = options.markInbox ?? true;
      const includeHidden = options.includeHiddenFolders ?? false;
      const result: ScanResult = { added: [], changed: [], moved: [], missing: [], duplicates: [], restored: [], unchanged: 0, errors: [], cancelled: false };
      let errorTotal = 0;
      const addError = (rel: string, reason: string) => {
        errorTotal++;
        if (result.errors.length < MAX_ERRORS) result.errors.push({ path: clip(rel), reason: clip(reason, 200) } satisfies ScanError);
      };
      const aborted = () => signal?.aborted === true;
      const progress = (phase: 'walking' | 'hashing' | 'writing' | 'done', seen: number, total?: number) =>
        options.onProgress?.({ phase, seen, ...(total !== undefined ? { total } : {}) });

      /* ------------------------------ config ------------------------------ */
      const exts = new Set([...options.config.scan.extensions, ...options.config.scan.nameOnlyExtensions].map(normExt).filter(Boolean));
      const excluded: string[] = [];
      for (const e of options.config.excludedFolders) {
        try {
          const n = normalizeRelativePath(e);
          if (n) excluded.push(pathKey(n));
        } catch {
          /* an unusable exclusion matches nothing */
        }
      }
      let dataRel: string | null = null;
      try {
        if (isInside(root, store.dataDir) && path.resolve(store.dataDir) !== root) dataRel = pathKey(toRelativePath(root, store.dataDir));
      } catch {
        dataRel = null;
      }
      const isExcludedDir = (rel: string): boolean => {
        const k = pathKey(rel);
        if (dataRel !== null && (k === dataRel || k.startsWith(`${dataRel}/`))) return true;
        return excluded.some((e) => k === e || k.startsWith(`${e}/`));
      };
      const hasHiddenDir = (rel: string, includingLast: boolean): boolean => {
        if (includeHidden) return false;
        const parts = rel.split('/');
        const n = includingLast ? parts.length : parts.length - 1;
        for (let i = 0; i < n; i++) if ((parts[i] as string).startsWith('.')) return true;
        return false;
      };
      const isTempName = (name: string) => name.startsWith('~$');
      const scannable = (rel: string): boolean => {
        const name = rel.slice(rel.lastIndexOf('/') + 1);
        if (!exts.has(extOf(name)) || isTempName(name)) return false;
        if (hasHiddenDir(rel, false)) return false;
        // Excluded folder: any ancestor directory.
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++) if (isExcludedDir(parts.slice(0, i).join('/'))) return false;
        return true;
      };
      const absOf = (rel: string) => path.join(root, ...rel.split('/'));

      /* ------------------------------ known state ------------------------------ */
      const known = options.known ?? (await store.documents.list());
      const docs = new Map<DocumentId, DocumentRecord>();
      const byPath = new Map<string, DocumentId>();
      const aliasOf = new Map<string, DocumentId>();
      const byHash = new Map<string, DocumentId>();
      const index = (d: DocumentRecord) => {
        docs.set(d.id, d);
        byPath.set(pathKey(d.path), d.id);
        for (const a of d.aliasPaths) aliasOf.set(pathKey(a), d.id);
        byHash.set(d.hash, d.id);
      };
      const unindex = (d: DocumentRecord) => {
        if (byPath.get(pathKey(d.path)) === d.id) byPath.delete(pathKey(d.path));
        for (const a of d.aliasPaths) if (aliasOf.get(pathKey(a)) === d.id) aliasOf.delete(pathKey(a));
        if (byHash.get(d.hash) === d.id) byHash.delete(d.hash);
      };
      for (const d of known) index(d);

      /** Serialised read-modify-write through the store; `fn` sees the fresh record. */
      const write = async (id: DocumentId, fn: (cur: DocumentRecord) => DocumentRecord): Promise<DocumentRecord> => {
        const before = docs.get(id);
        const written = await store.documents.update(id, (cur) => {
          if (cur === null) throw new AppError('NOT_FOUND', 'Document record disappeared during the scan');
          return fn(cur);
        });
        if (before) unindex(before);
        index(written);
        return written;
      };

      /* ------------------------------ walking ------------------------------ */
      const found = new Map<string, Found>();
      const failedDirs: string[] = [];
      const targeted = options.paths !== undefined;
      const scopes: string[] = [];

      const statFiles = async (rels: string[]) => {
        await mapLimit(
          rels,
          STAT_BATCH,
          async (rel) => {
            const abs = absOf(rel);
            try {
              const st = await withRetry(() => stat(toFsPath(abs)), opts.retry);
              if (st.isFile()) found.set(pathKey(rel), { rel, abs, size: st.size, mtimeMs: st.mtimeMs });
            } catch (e) {
              const code = (e as NodeJS.ErrnoException).code;
              if (code === 'ENOENT' || code === 'ENOTDIR') return;
              // Cannot stat now (locked?): the file exists, so it must not be reported missing.
              found.set(pathKey(rel), { rel, abs, size: -1, mtimeMs: -1 });
              addError(rel, `cannot read file info (${code ?? 'unknown'})`);
            }
          },
          aborted,
        );
      };

      const walk = async (startRel: string) => {
        const stack: string[] = [startRel];
        while (stack.length > 0 && !aborted()) {
          const relDir = stack.pop() as string;
          let entries;
          try {
            entries = await withRetry(() => readdir(toFsPath(relDir ? absOf(relDir) : root), { withFileTypes: true }), opts.retry);
          } catch (e) {
            failedDirs.push(pathKey(relDir));
            addError(relDir || '.', `cannot list folder (${(e as NodeJS.ErrnoException).code ?? 'unknown'})`);
            continue;
          }
          const files: string[] = [];
          for (const ent of entries) {
            const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
            if (ent.isSymbolicLink()) continue; // links could loop or leave the root
            if (ent.isDirectory()) {
              if (!includeHidden && ent.name.startsWith('.')) continue;
              if (isExcludedDir(rel)) continue;
              stack.push(rel);
            } else if (ent.isFile()) {
              if (!exts.has(extOf(ent.name)) || isTempName(ent.name)) continue;
              let ok = rel.length <= 1024;
              if (ok) {
                try {
                  ok = normalizeRelativePath(rel) === rel;
                } catch {
                  ok = false;
                }
              }
              if (!ok) {
                addError(rel, 'unusable file name or path too long');
                continue;
              }
              files.push(rel);
            }
          }
          await statFiles(files);
          progress('walking', found.size);
        }
      };

      if (!targeted) {
        await walk('');
      } else {
        for (const raw of options.paths ?? []) {
          if (aborted()) break;
          let rel: string;
          try {
            rel = normalizeRelativePath(raw);
          } catch {
            addError(String(raw), 'path not allowed');
            continue;
          }
          if (!rel) {
            // The root itself: a full walk of the scope.
            scopes.push('');
            await walk('');
            continue;
          }
          scopes.push(pathKey(rel));
          if (hasHiddenDir(rel, false) || isExcludedDir(rel)) continue;
          let abs: string;
          try {
            abs = await resolveInRoot(root, rel);
          } catch (e) {
            if ((e as AppError).code === 'NOT_FOUND') {
              addError(rel, 'library root not found');
            } else addError(rel, 'path outside the library root');
            continue;
          }
          let st;
          try {
            st = await lstat(toFsPath(abs));
          } catch {
            continue; // gone: the missing pass looks at the known documents under it
          }
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) {
            if (!includeHidden && path.basename(rel).startsWith('.')) continue;
            await walk(rel);
          } else if (st.isFile() && scannable(rel)) {
            await statFiles([rel]);
          }
        }
      }

      const finish = (): ScanResult => {
        if (errorTotal > result.errors.length) opts.onWarning?.(`${errorTotal - result.errors.length} more scan errors not listed`);
        progress('done', found.size);
        return result;
      };
      if (aborted()) {
        result.cancelled = true;
        return finish();
      }

      const files = [...found.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
      const presentKeys = found; // keyed by pathKey(rel)
      const inFailedDir = (rel: string) => {
        const k = pathKey(rel);
        return failedDirs.some((d) => d === '' || k === d || k.startsWith(`${d}/`));
      };
      const inScope = (rel: string) => {
        if (!targeted) return true;
        const k = pathKey(rel);
        return scopes.some((s) => s === '' || k === s || k.startsWith(`${s}/`));
      };
      const statExists = async (rel: string): Promise<boolean> => {
        try {
          await withRetry(() => stat(toFsPath(absOf(rel))), opts.retry);
          return true;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          return !(code === 'ENOENT' || code === 'ENOTDIR');
        }
      };
      /** Does a file exist at `rel`? Walked files are authoritative; elsewhere (targeted scan) ask the file system. */
      const existsRel = async (rel: string): Promise<boolean> => {
        if (presentKeys.has(pathKey(rel))) return true;
        if (inFailedDir(rel)) return true;
        return statExists(rel);
      };

      /* ------------------------------ decide what must be read ------------------------------ */
      const toHash: Found[] = [];
      const restoredNow: Array<{ f: Found; id: DocumentId }> = [];
      for (const f of files) {
        if (f.size < 0) {
          result.unchanged++; // unreadable right now (already reported); keep the record as it is
          continue;
        }
        const pid = byPath.get(pathKey(f.rel));
        const pd = pid ? docs.get(pid) : undefined;
        if (pd && sameStat(pd, f) && pd.legacy?.['hashUnknown'] !== true) {
          if (pd.missing) restoredNow.push({ f, id: pd.id });
          else result.unchanged++;
          continue;
        }
        if (!pd) {
          const aid = aliasOf.get(pathKey(f.rel));
          const ad = aid ? docs.get(aid) : undefined;
          // A copy listed in `aliasPaths` has no stored size/mtime of its own: the size is the cheap check.
          if (ad && ad.size === f.size) {
            result.unchanged++;
            continue;
          }
        }
        toHash.push(f);
      }

      /* ------------------------------ hashing (the only reads) ------------------------------ */
      const hashes = new Map<string, string>();
      let hashed = 0;
      progress('hashing', 0, toHash.length);
      await mapLimit(
        toHash,
        hashConcurrency,
        async (f) => {
          try {
            hashes.set(f.rel, await withRetry(() => hashFile(f.abs, signal), opts.retry));
          } catch (e) {
            if (aborted() || (e instanceof AppError && e.code === 'CANCELLED')) return;
            const code = e instanceof AppError ? (e.details?.['code'] as string | undefined) ?? e.code : (e as NodeJS.ErrnoException).code;
            addError(f.rel, `cannot read file (${code ?? 'unknown'})`);
          }
          hashed++;
          if (hashed % 5 === 0 || hashed === toHash.length) progress('hashing', hashed, toHash.length);
        },
        aborted,
      );
      if (aborted()) {
        result.cancelled = true;
        return finish();
      }

      /* ------------------------------ apply ------------------------------ */
      const guarded = async (rel: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          if (e instanceof AppError && e.code === 'CANCELLED') throw e;
          addError(rel, `could not update the record (${e instanceof AppError ? e.code : 'error'})`);
        }
      };
      const scanned = (f: Found, hash?: string, docId?: DocumentId): ScannedFile => ({
        path: f.rel,
        size: f.size,
        mtimeMs: f.mtimeMs,
        ...(hash ? { hash } : {}),
        ...(docId ? { docId } : {}),
      });
      const pushHistory = (d: DocumentRecord, oldPath: string): DocumentRecord['pathHistory'] =>
        [...d.pathHistory, { path: oldPath, seenUntil: nowIso }].slice(-L.pathHistory);

      // Files that are visible again without being read (same size and mtime as before).
      for (const { f, id } of restoredNow) {
        if (aborted()) break;
        await guarded(f.rel, async () => {
          await write(id, (cur) => ({ ...cur, missing: false, updatedAt: nowIso }));
          result.restored.push(id);
          result.unchanged++;
        });
      }

      const withHash = toHash.filter((f) => hashes.has(f.rel));
      // Pass 1: files at a known path (touched or changed). Pass 2: new paths, so pass 2 sees the final hashes.
      const newPaths: Found[] = [];
      for (const f of withHash) {
        if (aborted()) break;
        const h = hashes.get(f.rel) as string;
        const pid = byPath.get(pathKey(f.rel));
        if (!pid) {
          newPaths.push(f);
          continue;
        }
        await guarded(f.rel, async () => {
          const pd = docs.get(pid) as DocumentRecord;
          const hashUnknown = pd.legacy?.['hashUnknown'] === true;
          if (h === pd.hash || hashUnknown) {
            // Same content (only the timestamp moved), or the importer never knew the real hash.
            const wasMissing = pd.missing;
            await write(pid, (cur) => {
              const next: DocumentRecord = { ...cur, hash: h, size: f.size, mtimeMs: f.mtimeMs, missing: false, updatedAt: nowIso };
              if (cur.legacy && cur.legacy['hashUnknown'] === true) {
                const { hashUnknown: _drop, ...rest } = cur.legacy;
                if (Object.keys(rest).length) next.legacy = rest;
                else delete next.legacy;
              }
              return next;
            });
            if (wasMissing) result.restored.push(pid);
            result.unchanged++;
            return;
          }
          await write(pid, (cur) => ({
            ...cur,
            previousHashes: cur.previousHashes.includes(cur.hash) ? cur.previousHashes : [...cur.previousHashes, cur.hash].slice(-L.hashes),
            hash: h,
            size: f.size,
            mtimeMs: f.mtimeMs,
            missing: false,
            inbox: markInbox ? (cur.inbox ?? { since: nowIso, reason: 'changed' as const }) : cur.inbox,
            updatedAt: nowIso,
          }));
          result.changed.push({ docId: pid, file: scanned(f, h, pid) });
        });
      }

      // Pass 2: paths no record has as its primary path.
      for (const f of newPaths) {
        if (aborted()) break;
        const h = hashes.get(f.rel) as string;
        await guarded(f.rel, async () => {
          // A listed copy whose size changed is no longer the same content: forget the alias, then treat it as a new path.
          const aid = aliasOf.get(pathKey(f.rel));
          if (aid) {
            await write(aid, (cur) => ({ ...cur, aliasPaths: cur.aliasPaths.filter((a) => pathKey(a) !== pathKey(f.rel)), updatedAt: nowIso }));
          }
          const yid = byHash.get(h);
          const y = yid ? docs.get(yid) : undefined;
          if (y) {
            if (await existsRel(y.path)) {
              // The original is still there: this is a copy.
              if (y.aliasPaths.some((a) => pathKey(a) === pathKey(f.rel))) {
                result.unchanged++;
                return;
              }
              if (y.aliasPaths.length >= L.paths) {
                addError(f.rel, 'too many copies of the same file');
                return;
              }
              await write(y.id, (cur) => ({ ...cur, aliasPaths: [...cur.aliasPaths, f.rel], updatedAt: nowIso }));
              result.duplicates.push({ docId: y.id, path: f.rel });
            } else {
              const from = y.path;
              await write(y.id, (cur) => ({
                ...cur,
                path: f.rel,
                pathHistory: pushHistory(cur, cur.path),
                aliasPaths: cur.aliasPaths.filter((a) => pathKey(a) !== pathKey(f.rel)),
                size: f.size,
                mtimeMs: f.mtimeMs,
                missing: false,
                updatedAt: nowIso,
              }));
              result.moved.push({ docId: y.id, from, file: scanned(f, h, y.id) });
            }
            return;
          }
          // New document. The id comes from the content (D-006); if that id is already taken by a record
          // with another current hash (an old version of it), derive one from hash and path instead.
          let id = documentIdFromHash(h);
          for (let n = 0; docs.has(id) || (await store.documents.get(id)) !== null; n++) id = documentIdFromHash(sha256Of(`${h}:${f.rel}:${n}`));
          const rec = documentRecordSchema.parse({
            schemaVersion: SCHEMA_VERSION,
            id,
            hash: h,
            path: f.rel,
            size: f.size,
            mtimeMs: f.mtimeMs,
            addedAt: nowIso,
            updatedAt: nowIso,
            ...(markInbox ? { inbox: { since: nowIso, reason: 'new' } } : {}),
          });
          const written = await store.documents.update(id, (cur) => cur ?? rec);
          index(written);
          result.added.push(scanned(f, h, id));
        });
      }
      if (aborted()) {
        result.cancelled = true;
        return finish();
      }

      /* ------------------------------ files that are gone ------------------------------ */
      progress('writing', 0);
      for (const id of [...docs.keys()]) {
        if (aborted()) break;
        const d = docs.get(id) as DocumentRecord;
        const aliasesInScope = d.aliasPaths.filter((a) => inScope(a) && scannable(a));
        const primaryRelevant = inScope(d.path) && scannable(d.path);
        if (!primaryRelevant && aliasesInScope.length === 0) continue;
        await guarded(d.path, async () => {
          const primaryPresent = !primaryRelevant || (await existsRel(d.path));
          const goneAliases: string[] = [];
          for (const a of aliasesInScope) if (!(await existsRel(a))) goneAliases.push(a);
          if (!primaryPresent) {
            const alive = d.aliasPaths.filter((a) => !goneAliases.includes(a) && scannable(a));
            const promoted = alive[0];
            if (promoted !== undefined) {
              // The original is gone but a copy remains: the copy becomes the document's path.
              let size = d.size;
              let mtimeMs = d.mtimeMs;
              const f = found.get(pathKey(promoted));
              if (f && f.size >= 0) {
                size = f.size;
                mtimeMs = f.mtimeMs;
              }
              const from = d.path;
              await write(id, (cur) => ({
                ...cur,
                path: promoted,
                pathHistory: pushHistory(cur, cur.path),
                aliasPaths: cur.aliasPaths.filter((a) => a !== promoted && !goneAliases.includes(a)),
                size,
                mtimeMs,
                missing: false,
                updatedAt: nowIso,
              }));
              result.moved.push({ docId: id, from, file: { path: promoted, size, mtimeMs } });
            } else if (!d.missing || goneAliases.length > 0) {
              await write(id, (cur) => ({
                ...cur,
                aliasPaths: cur.aliasPaths.filter((a) => !goneAliases.includes(a)),
                missing: true,
                updatedAt: nowIso,
              }));
              if (!d.missing) result.missing.push(id);
            }
          } else if (goneAliases.length > 0) {
            await write(id, (cur) => ({ ...cur, aliasPaths: cur.aliasPaths.filter((a) => !goneAliases.includes(a)), updatedAt: nowIso }));
          }
        });
      }
      if (aborted()) result.cancelled = true;
      return finish();
    },
  };
}
