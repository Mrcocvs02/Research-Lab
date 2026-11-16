import { StringDecoder } from 'node:string_decoder';
import { appendFile, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import {
  AppError,
  DATA_SUBDIRS,
  DEFAULT_DATA_DIR_NAME,
  annotationFileSchema,
  citationFileSchema,
  dataPath,
  defaultLibraryConfig,
  documentIdSchema,
  documentRecordSchema,
  itemIdSchema,
  libraryConfigSchema,
  logEntrySchema,
  noopLogger,
  noteSchema,
  projectSchema,
  taxonomyFileSchema,
  watchFileSchema,
  type Annotation,
  type AnnotationFile,
  type ChangeEntry,
  type CitationFile,
  type DocumentId,
  type DocumentRecord,
  type ItemRepository,
  type LibraryConfig,
  type LibraryStore,
  type LogEntry,
  type Logger,
  type Note,
  type NoteRepository,
  type PutOptions,
  type Project,
  RevisionConflictError,
  type TaxonomyFile,
  type WatchFile,
} from '@rl/core';
import { atomicWriteFile, atomicWriteJson, readJsonFile, readTextFileLimited, resolveInRoot, type AtomicWriteOptions } from '@rl/core/node';
import { copyDataDir } from './backup.js';
import { withRetry, type RetryOptions } from './retry.js';
import { diffTaxonomy } from './taxonomy-diff.js';

export interface LibraryStoreOptions {
  rootPath: string;
  /** Data dir name inside the root (default `.lab`). */
  dataDirName?: string;
  /** Absolute data dir; overrides `rootPath` + `dataDirName` (used by the importer, which is handed the folder). */
  dataDir?: string;
  deviceId: string;
  /** Who is credited in the change log. Default `user`. */
  actor?: ChangeEntry['actor'];
  /** Log tag changes of single documents (default true). The importer turns it off and logs one summary. */
  logDocumentChanges?: boolean;
  logger?: Logger;
  atomic?: AtomicWriteOptions;
  retry?: RetryOptions;
}

/** No data file the app parses whole (a record, the taxonomy, a note) may be larger than this: 32 MiB. */
export const MAX_DATA_FILE_BYTES = 32 * 1024 * 1024;
/** A change-log file is read from its end up to this many bytes; older lines are left unread (reported as an issue). */
export const MAX_LOG_READ_BYTES = 32 * 1024 * 1024;
/** One log line longer than this is skipped. */
export const MAX_LOG_LINE_BYTES = 1024 * 1024;

/** A data file that could not be read; the rest of the library still loads. */
export interface LoadIssue {
  file: string;
  code: string;
  message: string;
}

export interface FileLibraryStore extends LibraryStore {
  /** Files skipped by `list()` calls since this store was created (corrupt or unreadable). */
  issues(): LoadIssue[];
  /** Same store, but crediting another actor in the change log. */
  withActor(actor: ChangeEntry['actor']): FileLibraryStore;
  /**
   * Same store, but every change entry it logs carries `changeId` (and `summary`, `undoOf`): the entries of one user
   * operation form one group that `history` can list and undo. Also turns on logging of document field and project
   * changes, which the plain store does not log (only tags and taxonomy).
   */
  withChange(ctx: ChangeContext): FileLibraryStore;
}

export interface ChangeContext {
  changeId: string;
  summary?: string;
  undoOf?: string;
}

/** The user-owned document fields whose before/after are logged when a change context is set (undo restores them). */
export const LOGGED_DOCUMENT_FIELDS = ['title', 'authors', 'year', 'type', 'ref', 'doi', 'arxivId', 'userDescription', 'study', 'extracted'] as const;
/** The project fields whose before/after are logged. */
export const LOGGED_PROJECT_FIELDS = ['kind', 'name', 'description', 'status', 'members', 'notes', 'readingPlan', 'archivedFrom'] as const;

/** `undefined` is not JSON: it is logged as `null` (and an absent `userDescription` as `''`). */
export function logValue(key: string, value: unknown): unknown {
  if (value === undefined) return key === 'userDescription' ? '' : null;
  return value;
}

/** Stable JSON (sorted keys): equality of two values read at different times. */
export function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, norm(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null, keys: readonly string[]): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    const bv = logValue(k, before?.[k]);
    const av = logValue(k, after?.[k]);
    if (canonical(bv) !== canonical(av)) {
      b[k] = bv;
      a[k] = av;
    }
  }
  return Object.keys(b).length > 0 ? { before: b, after: a } : null;
}

/** In-process serialisation: tasks with the same key run one after the other; a failure does not block the next. */
class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

interface SharedState {
  issues: LoadIssue[];
  queue: KeyedQueue;
}

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function frontmatterOf(note: Note): string {
  const f = note.frontmatter;
  const lines = [`docId: ${f.docId}`, `scope: ${f.scope}`];
  if (f.page !== undefined) lines.push(`page: ${f.page}`);
  lines.push(`createdAt: ${f.createdAt}`, `updatedAt: ${f.updatedAt}`);
  return `---\n${lines.join('\n')}\n---\n${note.body}`;
}

function parseNote(raw: string): Note {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) throw new AppError('SCHEMA_INVALID', 'Note has no frontmatter');
  const data: Record<string, unknown> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    data[key] = key === 'page' ? Number(value) : value;
  }
  const parsed = noteSchema.safeParse({
    frontmatter: data,
    body: text.slice(m[0].length),
  });
  if (!parsed.success) {
    throw new AppError('SCHEMA_INVALID', 'Note does not match its schema', {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

/** True when the file exists, is not empty and its last byte is not a line feed. */
async function endsWithoutNewline(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    await handle.read(buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

class FileStore implements FileLibraryStore {
  readonly rootPath: string;
  readonly dataDir: string;
  private readonly deviceId: string;
  private readonly actor: ChangeEntry['actor'];
  private readonly logDocs: boolean;
  private readonly log: Logger;
  private readonly atomic: AtomicWriteOptions;
  private readonly retry: RetryOptions;
  private readonly loadIssues: LoadIssue[];
  private readonly queue: KeyedQueue;
  private readonly options: LibraryStoreOptions;
  private readonly change: ChangeContext | undefined;
  /** Whether this change context already wrote its summary on an entry: the next entries go without it (D-179). */
  private changeHeadLogged = false;

  constructor(options: LibraryStoreOptions, shared?: SharedState, change?: ChangeContext) {
    this.change = change;
    if (!path.isAbsolute(options.rootPath)) throw new AppError('INVALID_PATH', 'Library root must be absolute');
    if (!DEVICE_ID.test(options.deviceId)) throw new AppError('INVALID_REQUEST', 'Invalid device id');
    this.options = options;
    this.rootPath = path.resolve(options.rootPath);
    this.dataDir = path.resolve(options.dataDir ?? path.join(options.rootPath, options.dataDirName ?? DEFAULT_DATA_DIR_NAME));
    this.deviceId = options.deviceId;
    this.actor = options.actor ?? 'user';
    this.logDocs = options.logDocumentChanges ?? true;
    this.log = options.logger ?? noopLogger;
    this.atomic = options.atomic ?? {};
    this.retry = options.retry ?? {};
    this.loadIssues = shared?.issues ?? [];
    this.queue = shared?.queue ?? new KeyedQueue();
  }

  issues(): LoadIssue[] {
    return [...this.loadIssues];
  }

  withActor(actor: ChangeEntry['actor']): FileLibraryStore {
    return new FileStore({ ...this.options, actor }, { issues: this.loadIssues, queue: this.queue }, this.change);
  }

  withChange(ctx: ChangeContext): FileLibraryStore {
    return new FileStore(this.options, { issues: this.loadIssues, queue: this.queue }, ctx);
  }

  /* ---------------------------- low level ---------------------------- */

  /** Absolute path of a data-dir-relative path, confined to the data dir (also through links). */
  private async abs(rel: string, create = false): Promise<string> {
    if (create) await mkdir(this.dataDir, { recursive: true });
    return resolveInRoot(this.dataDir, rel);
  }

  /** Runs `fn` after every earlier task on the same data file (same store family, same process). */
  private locked<T>(rel: string, fn: () => Promise<T>): Promise<T> {
    return this.queue.run(rel, fn);
  }

  /** Validated read; null when the file (or the data dir) does not exist. Corrupt -> SCHEMA_INVALID. */
  private async readOptional<S extends z.ZodType>(rel: string, schema: S): Promise<z.output<S> | null> {
    try {
      const file = await this.abs(rel);
      return await withRetry(() => readJsonFile(file, schema, { maxBytes: MAX_DATA_FILE_BYTES }), this.retry);
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return null;
      // Too large to be one of ours: treated like a corrupt file (skipped and reported by `issues()` in listings).
      if (e instanceof AppError && e.code === 'INVALID_REQUEST' && e.details?.['maxBytes'] !== undefined) throw new AppError('SCHEMA_INVALID', 'File is too large', { maxBytes: MAX_DATA_FILE_BYTES });
      throw e;
    }
  }

  private async writeJson<S extends z.ZodType>(rel: string, schema: S, value: unknown): Promise<z.output<S>> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new AppError('SCHEMA_INVALID', 'Refusing to write data that does not match its schema', {
        file: rel,
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const file = await this.abs(rel, true);
    await atomicWriteJson(file, parsed.data, this.atomic);
    return parsed.data;
  }

  private async removeFile(rel: string): Promise<void> {
    const file = await this.abs(rel).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return null;
      throw e;
    });
    if (!file) return;
    try {
      await withRetry(() => unlink(file), this.retry);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new AppError('IO_ERROR', 'Cannot delete file', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' }, { cause: e });
    }
  }

  private async listNames(relDir: string): Promise<string[]> {
    try {
      const dir = await this.abs(relDir);
      return await withRetry(() => readdir(dir), this.retry);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((e instanceof AppError && e.code === 'NOT_FOUND') || code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw e instanceof AppError ? e : new AppError('IO_ERROR', 'Cannot list folder', { code: code ?? 'unknown' }, { cause: e });
    }
  }

  private noteIssue(rel: string, e: unknown): void {
    const err = AppError.from(e);
    this.loadIssues.push({ file: rel, code: err.code, message: err.message });
    this.log.warn('skipping unreadable data file', {
      file: rel,
      code: err.code,
    });
  }

  /* ------------------------------ layout ----------------------------- */

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    for (const sub of DATA_SUBDIRS) await mkdir(await this.abs(sub), { recursive: true });
    if ((await this.readOptional(dataPath.config, libraryConfigSchema)) === null) await this.writeConfig(defaultLibraryConfig());
  }

  async readConfig(): Promise<LibraryConfig> {
    return (await this.readOptional(dataPath.config, libraryConfigSchema)) ?? defaultLibraryConfig();
  }

  async writeConfig(config: LibraryConfig): Promise<void> {
    await this.writeJson(dataPath.config, libraryConfigSchema, config);
  }

  /* ------------------------------ items ------------------------------ */

  private repo<T, Id extends string>(spec: {
    dir: string;
    file: (id: Id) => string;
    schema: z.ZodType<T>;
    idSchema: z.ZodType<Id>;
    idOf: (item: T) => Id;
    onPut?: (before: T | null, after: T) => Promise<void>;
    onRemove?: (before: T) => Promise<void>;
    /** Items that carry a revision: the store bumps it at each write and checks `expectedRevision`. */
    revision?: { get: (item: T) => number; set: (item: T, n: number) => T };
  }): ItemRepository<T, Id> {
    const parseId = (id: string): Id => {
      const r = spec.idSchema.safeParse(id);
      if (!r.success) throw new AppError('INVALID_REQUEST', 'Invalid item id');
      return r.data;
    };
    const get = async (id: Id): Promise<T | null> => {
      const item = await this.readOptional(spec.file(parseId(id)), spec.schema);
      if (item !== null && spec.idOf(item) !== id) {
        throw new AppError('SCHEMA_INVALID', 'File content does not match its file name', { file: spec.file(id) });
      }
      return item;
    };
    const listIds = async (): Promise<Id[]> => {
      const ids: Id[] = [];
      for (const name of await this.listNames(spec.dir)) {
        if (!name.endsWith('.json') || name.startsWith('.')) continue;
        const r = spec.idSchema.safeParse(name.slice(0, -'.json'.length));
        if (r.success) ids.push(r.data);
      }
      return ids.sort();
    };
    const putLocked = async (item: T, options?: PutOptions, known?: T | null): Promise<T> => {
      const id = spec.idOf(item);
      if (options?.expectedRevision !== undefined && !spec.revision) throw new AppError('INVALID_REQUEST', 'This kind of item has no revision');
      const needBefore = spec.onPut !== undefined || spec.revision !== undefined;
      let before: T | null = known ?? null;
      if (known === undefined && needBefore) before = options?.expectedRevision !== undefined ? await get(id) : await get(id).catch(() => null);
      let toWrite = item;
      if (spec.revision) {
        const actual = before === null ? null : spec.revision.get(before);
        if (options?.expectedRevision !== undefined && actual !== options.expectedRevision) {
          throw new RevisionConflictError(spec.file(id), options.expectedRevision, actual);
        }
        toWrite = spec.revision.set(item, actual === null ? spec.revision.get(item) : actual + 1);
      }
      const written = await this.writeJson(spec.file(id), spec.schema, toWrite);
      await spec.onPut?.(before, written);
      return written;
    };
    return {
      get,
      listIds,
      list: async () => {
        const out: T[] = [];
        const ids = await listIds();
        for (let i = 0; i < ids.length; i += 16) {
          const chunk = await Promise.all(
            ids.slice(i, i + 16).map(async (id) => {
              try {
                return await get(id);
              } catch (e) {
                this.noteIssue(spec.file(id), e);
                return null;
              }
            }),
          );
          for (const item of chunk) if (item !== null) out.push(item);
        }
        return out;
      },
      put: (item, options) => this.locked(spec.file(spec.idOf(item)), () => putLocked(item, options)),
      update: (id, fn) =>
        this.locked(spec.file(parseId(id)), async () => {
          const current = await get(parseId(id));
          return putLocked(await fn(current), undefined, current);
        }),
      remove: (id) =>
        this.locked(spec.file(parseId(id)), async () => {
          const before = spec.onRemove ? await get(parseId(id)).catch(() => null) : null;
          await this.removeFile(spec.file(parseId(id)));
          if (before) await spec.onRemove?.(before);
        }),
    };
  }

  private async logDocument(id: string, action: string, before: unknown, after: unknown): Promise<void> {
    if (!this.logDocs) return;
    await this.appendLog({
      type: 'change',
      at: new Date().toISOString(),
      deviceId: this.deviceId,
      actor: this.actor,
      target: { kind: 'document', id },
      action,
      before,
      after,
    });
  }

  /** Field changes of a document and changes of a project are logged only inside a change context (user operations). */
  private async logFields(kind: 'document' | 'project', id: string, action: string, diff: { before: Record<string, unknown>; after: Record<string, unknown> } | null): Promise<void> {
    if (!this.change || diff === null) return;
    await this.appendLog({ type: 'change', at: new Date().toISOString(), deviceId: this.deviceId, actor: this.actor, target: { kind, id }, action, before: diff.before, after: diff.after });
  }

  readonly documents: ItemRepository<DocumentRecord, DocumentId> = this.repo<DocumentRecord, DocumentId>({
    dir: dataPath.documents,
    file: (id) => dataPath.document(id),
    schema: documentRecordSchema,
    idSchema: documentIdSchema,
    idOf: (d) => d.id,
    revision: {
      get: (d) => d.revision,
      set: (d, n) => ({ ...d, revision: n }),
    },
    onPut: async (before, after) => {
      if (before === null) {
        if (after.tags.length > 0)
          await this.logDocument(after.id, 'document.create', null, {
            tags: after.tags,
          });
      } else if (!sameTags(before.tags, after.tags)) {
        await this.logDocument(after.id, 'tags.update', { tags: before.tags }, { tags: after.tags });
      }
      if (before !== null && this.change) {
        await this.logFields('document', after.id, 'document.fields', changedFields(before as never, after as never, LOGGED_DOCUMENT_FIELDS));
      }
    },
    onRemove: async (before) => this.logDocument(before.id, 'document.remove', { tags: before.tags, path: before.path }, null),
  });

  readonly citations: ItemRepository<CitationFile, DocumentId> = this.repo<CitationFile, DocumentId>({
    dir: 'citations',
    file: (id) => dataPath.citations(id),
    schema: citationFileSchema,
    idSchema: documentIdSchema,
    idOf: (c) => c.docId,
  });

  readonly projects: ItemRepository<Project> = this.repo<Project, string>({
    dir: 'projects',
    file: (id) => dataPath.project(id),
    schema: projectSchema,
    idSchema: itemIdSchema,
    idOf: (p) => p.id,
    revision: {
      get: (p) => p.revision ?? 0,
      set: (p, n) => ({ ...p, revision: n }),
    },
    onPut: async (before, after) => {
      if (before === null) await this.logFields('project', after.id, 'project.create', { before: {}, after: { project: after } });
      else await this.logFields('project', after.id, 'project.update', changedFields(before as never, after as never, LOGGED_PROJECT_FIELDS));
    },
    onRemove: async (before) => this.logFields('project', before.id, 'project.remove', { before: { project: before }, after: {} }),
  });

  readonly annotations = {
    get: async (docId: DocumentId): Promise<AnnotationFile | null> => {
      const id = documentIdSchema.parse(docId);
      const file = await this.readOptional(dataPath.annotations(id), annotationFileSchema);
      if (file !== null && file.docId !== id) throw new AppError('SCHEMA_INVALID', 'File content does not match its file name');
      return file;
    },
    put: (file: AnnotationFile): Promise<void> =>
      this.locked(dataPath.annotations(file.docId), async () => {
        await this.writeJson(dataPath.annotations(file.docId), annotationFileSchema, file);
      }),
    update: (docId: DocumentId, fn: (current: AnnotationFile | null) => AnnotationFile | Promise<AnnotationFile>): Promise<AnnotationFile> => {
      const id = documentIdSchema.parse(docId);
      return this.locked(dataPath.annotations(id), async () => {
        const current = await this.annotations.get(id);
        return this.writeJson(dataPath.annotations(id), annotationFileSchema, await fn(current));
      });
    },
    upsert: async (docId: DocumentId, annotation: Annotation): Promise<void> => {
      await this.annotations.update(docId, (current) => {
        const existing = current ?? annotationFileSchema.parse({ docId });
        const i = existing.annotations.findIndex((a) => a.id === annotation.id);
        const next = [...existing.annotations];
        if (i >= 0) next[i] = annotation;
        else next.push(annotation);
        return { ...existing, annotations: next };
      });
    },
  };

  readonly notes: NoteRepository = {
    get: async (docId, page) => {
      const id = documentIdSchema.parse(docId);
      const rel = page === undefined ? dataPath.fileNote(id) : dataPath.pageNote(id, page);
      let raw: string;
      try {
        const file = await this.abs(rel);
        raw = await withRetry(() => readTextFileLimited(file, MAX_DATA_FILE_BYTES), this.retry);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if ((e instanceof AppError && e.code === 'NOT_FOUND') || code === 'ENOENT') return null;
        throw e instanceof AppError ? e : new AppError('IO_ERROR', 'Cannot read note', { code: code ?? 'unknown' }, { cause: e });
      }
      return parseNote(raw);
    },
    listForDocument: async (docId) => {
      const id = documentIdSchema.parse(docId);
      const out: Note[] = [];
      const fileNote = await this.notes.get(id).catch((e: unknown) => {
        this.noteIssue(dataPath.fileNote(id), e);
        return null;
      });
      if (fileNote) out.push(fileNote);
      const pages = (await this.listNames(`notes/${id}`))
        .map((n) => /^p(\d+)\.md$/.exec(n)?.[1])
        .filter((p): p is string => p !== undefined)
        .map(Number)
        .sort((a, b) => a - b);
      for (const page of pages) {
        const note = await this.notes.get(id, page).catch((e: unknown) => {
          this.noteIssue(dataPath.pageNote(id, page), e);
          return null;
        });
        if (note) out.push(note);
      }
      return out;
    },
    put: async (note) => {
      const valid = noteSchema.parse(note);
      const f = valid.frontmatter;
      const rel = f.scope === 'page' ? dataPath.pageNote(f.docId, f.page ?? 1) : dataPath.fileNote(f.docId);
      await atomicWriteFile(await this.abs(rel, true), frontmatterOf(valid), this.atomic);
    },
    remove: async (docId, page) => {
      const id = documentIdSchema.parse(docId);
      await this.removeFile(page === undefined ? dataPath.fileNote(id) : dataPath.pageNote(id, page));
    },
  };

  /* --------------------- taxonomy, watch, change log --------------------- */

  async readTaxonomy(): Promise<TaxonomyFile> {
    return (await this.readOptional(dataPath.taxonomy, taxonomyFileSchema)) ?? taxonomyFileSchema.parse({});
  }

  writeTaxonomy(taxonomy: TaxonomyFile, options: PutOptions = {}): Promise<void> {
    return this.locked(dataPath.taxonomy, () => this.writeTaxonomyLocked(taxonomy, options));
  }

  updateTaxonomy(fn: (current: TaxonomyFile) => TaxonomyFile | Promise<TaxonomyFile>): Promise<void> {
    return this.locked(dataPath.taxonomy, async () => {
      const current = await this.readTaxonomy();
      await this.writeTaxonomyLocked(await fn(current), {});
    });
  }

  private async writeTaxonomyLocked(taxonomy: TaxonomyFile, options: PutOptions): Promise<void> {
    const valid = taxonomyFileSchema.parse(taxonomy);
    // A corrupt existing file must not be silently replaced.
    const before = await this.readOptional(dataPath.taxonomy, taxonomyFileSchema);
    if (options.expectedRevision !== undefined && (before?.revision ?? 0) !== options.expectedRevision) {
      throw new RevisionConflictError(dataPath.taxonomy, options.expectedRevision, before?.revision ?? null);
    }
    const diff = diffTaxonomy(before ?? taxonomyFileSchema.parse({}), valid);
    if (before !== null && diff === null) return;
    const revision = Math.max(before?.revision ?? -1, valid.revision) + 1;
    await this.writeJson(dataPath.taxonomy, taxonomyFileSchema, {
      ...valid,
      revision,
    });
    if (diff !== null) {
      await this.appendLog({
        type: 'change',
        at: new Date().toISOString(),
        deviceId: this.deviceId,
        actor: this.actor,
        target: { kind: 'taxonomy' },
        action: 'taxonomy.update',
        before: { revision: before?.revision ?? null, ...diff.before },
        after: { revision, ...diff.after },
      });
    }
  }

  async readWatch(): Promise<WatchFile> {
    return (await this.readOptional(dataPath.watch, watchFileSchema)) ?? watchFileSchema.parse({});
  }

  async writeWatch(watch: WatchFile): Promise<void> {
    await this.locked(dataPath.watch, async () => {
      await this.writeJson(dataPath.watch, watchFileSchema, watch);
    });
  }

  async appendLog(entry: LogEntry): Promise<void> {
    let withCtx: LogEntry = entry;
    if (this.change && entry.type === 'change' && entry.changeId === undefined) {
      // The summary is a property of the group, not of each entry: a change on tens of thousands of documents would
      // otherwise repeat it on every line and outgrow the part of the log that is read back (D-179). `undoOf` is short and
      // stays on every entry, so that a group whose first lines fall outside that part is still known as an undo.
      const head = !this.changeHeadLogged && this.change.summary ? { summary: this.change.summary } : {};
      if ('summary' in head) this.changeHeadLogged = true;
      withCtx = { ...entry, changeId: this.change.changeId, ...head, ...(this.change.undoOf ? { undoOf: this.change.undoOf } : {}) };
    }
    const carriesHead = this.change !== undefined && 'summary' in withCtx && withCtx.summary !== undefined && withCtx.changeId === this.change.changeId;
    const valid = logEntrySchema.parse(withCtx);
    const month = valid.at.slice(0, 7);
    const rel = dataPath.logFile(valid.type === 'change' ? 'changes' : 'ai-sends', this.deviceId, month);
    const file = await this.abs(rel, true);
    await mkdir(path.dirname(file), { recursive: true });
    await this.locked(rel, () =>
      withRetry(async () => {
        // A process that died mid-line leaves a fragment: start on a fresh line so that the new entry stays readable.
        const prefix = (await endsWithoutNewline(file)) ? '\n' : '';
        await appendFile(file, `${prefix}${JSON.stringify(valid)}\n`, 'utf8');
      }, this.retry),
    ).catch((e: unknown) => {
      // The entry that should have carried the summary was not written: the next one carries it instead.
      if (carriesHead) this.changeHeadLogged = false;
      throw e instanceof AppError ? e : new AppError('IO_ERROR', 'Cannot append to the log', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' }, { cause: e });
    });
  }

  async readLog(query: { type?: LogEntry['type']; since?: string; limit?: number } = {}): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    for (const name of await this.listNames('log')) {
      if (!/^(changes|ai-sends)-\d{4}-\d{2}\..+\.jsonl$/.test(name)) continue;
      let invalid = 0;
      let truncated = false;
      try {
        const file = await this.abs(`log/${name}`);
        const res = await withRetry(
          () =>
            readLogLines(file, (line) => {
              if (!line.trim()) return;
              try {
                const parsed = logEntrySchema.safeParse(JSON.parse(line));
                if (parsed.success) entries.push(parsed.data);
                else invalid++;
              } catch {
                invalid++; // a torn line must not hide the rest
              }
            }),
          this.retry,
        );
        invalid += res.skipped;
        truncated = res.truncated;
      } catch (e) {
        this.noteIssue(`log/${name}`, e);
        continue;
      }
      if (truncated) this.loadIssues.push({ file: `log/${name}`, code: 'LOG_TRUNCATED', message: 'only the newest part of a very large log was read' });
      if (invalid > 0) {
        this.loadIssues.push({
          file: `log/${name}`,
          code: 'LOG_LINES_SKIPPED',
          message: `${invalid} unreadable line(s) skipped`,
        });
        this.log.warn('skipping unreadable log lines', {
          file: `log/${name}`,
          count: invalid,
        });
      }
    }
    let result = entries.filter((e) => (query.type === undefined || e.type === query.type) && (query.since === undefined || e.at >= query.since));
    result.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (query.limit !== undefined) result = result.slice(-query.limit);
    return result;
  }

  /** Fingerprint of the change-log files: when it is the same, `readLog` would return the same entries. */
  async logSignature(): Promise<string> {
    const parts: string[] = [];
    for (const name of (await this.listNames('log')).sort()) {
      if (!/^(changes|ai-sends)-\d{4}-\d{2}\..+\.jsonl$/.test(name)) continue;
      try {
        const st = await stat(await this.abs(`log/${name}`));
        parts.push(`${name}:${st.size}:${Math.round(st.mtimeMs)}`);
      } catch {
        parts.push(`${name}:?`);
      }
    }
    return parts.join('|');
  }

  async backup(backupDir: string): Promise<{ files: number }> {
    return copyDataDir(this.dataDir, backupDir);
  }
}

/**
 * Reads a log file line by line without holding it whole: at most `MAX_LOG_READ_BYTES` from its end (a partial first
 * line is dropped), and a line over `MAX_LOG_LINE_BYTES` is skipped. Returns how many lines were skipped.
 */
async function readLogLines(file: string, onLine: (line: string) => void): Promise<{ skipped: number; truncated: boolean }> {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - MAX_LOG_READ_BYTES);
    const truncated = start > 0;
    const decoder = new StringDecoder('utf8');
    const buf = Buffer.allocUnsafe(256 * 1024);
    let pos = start;
    let carry = '';
    let skipping = truncated; // the first line of a tail read is cut in the middle
    let skipped = 0;
    const feed = (text: string) => {
      let from = 0;
      for (;;) {
        const nl = text.indexOf('\n', from);
        if (nl === -1) break;
        const piece = text.slice(from, nl);
        if (skipping) skipping = false;
        else if (carry.length + piece.length > MAX_LOG_LINE_BYTES) skipped++;
        else onLine(carry + piece);
        carry = '';
        from = nl + 1;
      }
      const rest = text.slice(from);
      if (!skipping && carry.length + rest.length > MAX_LOG_LINE_BYTES) {
        // An endless line: drop what is buffered and everything up to the next line break.
        skipped++;
        carry = '';
        skipping = true;
      } else if (!skipping) carry += rest;
    };
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      feed(decoder.write(buf.subarray(0, bytesRead)));
    }
    feed(decoder.end());
    if (!skipping && carry.trim()) onLine(carry);
    return { skipped, truncated };
  } finally {
    await handle.close().catch(() => {});
  }
}

/** File-based library store (atomic writes, one file per item, confined to the data dir). */
export function createLibraryStore(options: LibraryStoreOptions): FileLibraryStore {
  return new FileStore(options);
}
