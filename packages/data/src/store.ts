import { appendFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises';
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
  type Project,
  type TaxonomyFile,
  type WatchFile,
} from '@rl/core';
import { atomicWriteFile, atomicWriteJson, readJsonFile, resolveInRoot, type AtomicWriteOptions } from '@rl/core/node';
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
  const parsed = noteSchema.safeParse({ frontmatter: data, body: text.slice(m[0].length) });
  if (!parsed.success) {
    throw new AppError('SCHEMA_INVALID', 'Note does not match its schema', {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
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
  private readonly options: LibraryStoreOptions;

  constructor(options: LibraryStoreOptions, shared?: LoadIssue[]) {
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
    this.loadIssues = shared ?? [];
  }

  issues(): LoadIssue[] {
    return [...this.loadIssues];
  }

  withActor(actor: ChangeEntry['actor']): FileLibraryStore {
    return new FileStore({ ...this.options, actor }, this.loadIssues);
  }

  /* ---------------------------- low level ---------------------------- */

  /** Absolute path of a data-dir-relative path, confined to the data dir (also through links). */
  private async abs(rel: string, create = false): Promise<string> {
    if (create) await mkdir(this.dataDir, { recursive: true });
    return resolveInRoot(this.dataDir, rel);
  }

  /** Validated read; null when the file (or the data dir) does not exist. Corrupt -> SCHEMA_INVALID. */
  private async readOptional<S extends z.ZodType>(rel: string, schema: S): Promise<z.output<S> | null> {
    try {
      const file = await this.abs(rel);
      return await withRetry(() => readJsonFile(file, schema), this.retry);
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return null;
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
    this.log.warn('skipping unreadable data file', { file: rel, code: err.code });
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
      put: async (item) => {
        const id = spec.idOf(item);
        const before = spec.onPut ? await get(id).catch(() => null) : null;
        const written = await this.writeJson(spec.file(id), spec.schema, item);
        await spec.onPut?.(before, written);
      },
      remove: async (id) => {
        const before = spec.onRemove ? await get(parseId(id)).catch(() => null) : null;
        await this.removeFile(spec.file(parseId(id)));
        if (before) await spec.onRemove?.(before);
      },
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

  readonly documents: ItemRepository<DocumentRecord, DocumentId> = this.repo<DocumentRecord, DocumentId>({
    dir: dataPath.documents,
    file: (id) => dataPath.document(id),
    schema: documentRecordSchema,
    idSchema: documentIdSchema,
    idOf: (d) => d.id,
    onPut: async (before, after) => {
      if (before === null) {
        if (after.tags.length > 0) await this.logDocument(after.id, 'document.create', null, { tags: after.tags });
      } else if (!sameTags(before.tags, after.tags)) {
        await this.logDocument(after.id, 'tags.update', { tags: before.tags }, { tags: after.tags });
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
  });

  readonly annotations = {
    get: async (docId: DocumentId): Promise<AnnotationFile | null> => {
      const id = documentIdSchema.parse(docId);
      const file = await this.readOptional(dataPath.annotations(id), annotationFileSchema);
      if (file !== null && file.docId !== id) throw new AppError('SCHEMA_INVALID', 'File content does not match its file name');
      return file;
    },
    put: async (file: AnnotationFile): Promise<void> => {
      await this.writeJson(dataPath.annotations(file.docId), annotationFileSchema, file);
    },
    upsert: async (docId: DocumentId, annotation: Annotation): Promise<void> => {
      const existing = (await this.annotations.get(docId)) ?? annotationFileSchema.parse({ docId });
      const i = existing.annotations.findIndex((a) => a.id === annotation.id);
      const next = [...existing.annotations];
      if (i >= 0) next[i] = annotation;
      else next.push(annotation);
      await this.annotations.put({ ...existing, annotations: next });
    },
  };

  readonly notes: NoteRepository = {
    get: async (docId, page) => {
      const id = documentIdSchema.parse(docId);
      const rel = page === undefined ? dataPath.fileNote(id) : dataPath.pageNote(id, page);
      let raw: string;
      try {
        const file = await this.abs(rel);
        raw = await withRetry(() => readFile(file, 'utf8'), this.retry);
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

  async writeTaxonomy(taxonomy: TaxonomyFile): Promise<void> {
    const valid = taxonomyFileSchema.parse(taxonomy);
    // A corrupt existing file must not be silently replaced.
    const before = await this.readOptional(dataPath.taxonomy, taxonomyFileSchema);
    const diff = diffTaxonomy(before ?? taxonomyFileSchema.parse({}), valid);
    if (before !== null && diff === null) return;
    const revision = Math.max(before?.revision ?? -1, valid.revision) + 1;
    await this.writeJson(dataPath.taxonomy, taxonomyFileSchema, { ...valid, revision });
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
    await this.writeJson(dataPath.watch, watchFileSchema, watch);
  }

  async appendLog(entry: LogEntry): Promise<void> {
    const valid = logEntrySchema.parse(entry);
    const month = valid.at.slice(0, 7);
    const rel = dataPath.logFile(valid.type === 'change' ? 'changes' : 'ai-sends', this.deviceId, month);
    const file = await this.abs(rel, true);
    await mkdir(path.dirname(file), { recursive: true });
    await withRetry(() => appendFile(file, `${JSON.stringify(valid)}\n`, 'utf8'), this.retry).catch((e: unknown) => {
      throw e instanceof AppError ? e : new AppError('IO_ERROR', 'Cannot append to the log', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' }, { cause: e });
    });
  }

  async readLog(query: { type?: LogEntry['type']; since?: string; limit?: number } = {}): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    for (const name of await this.listNames('log')) {
      if (!/^(changes|ai-sends)-\d{4}-\d{2}\..+\.jsonl$/.test(name)) continue;
      let raw: string;
      try {
        const file = await this.abs(`log/${name}`);
        raw = await withRetry(() => readFile(file, 'utf8'), this.retry);
      } catch (e) {
        this.noteIssue(`log/${name}`, e);
        continue;
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = logEntrySchema.safeParse(JSON.parse(line));
          if (parsed.success) entries.push(parsed.data);
        } catch {
          /* a torn last line must not hide the rest */
        }
      }
    }
    let result = entries.filter((e) => (query.type === undefined || e.type === query.type) && (query.since === undefined || e.at >= query.since));
    result.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (query.limit !== undefined) result = result.slice(-query.limit);
    return result;
  }

  async backup(backupDir: string): Promise<{ files: number }> {
    return copyDataDir(this.dataDir, backupDir);
  }
}

/** File-based library store (atomic writes, one file per item, confined to the data dir). */
export function createLibraryStore(options: LibraryStoreOptions): FileLibraryStore {
  return new FileStore(options);
}
