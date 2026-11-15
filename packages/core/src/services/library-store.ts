import { AppError } from '../errors.js';
import type { DocumentId } from '../common.js';
import type { LibraryConfig } from '../settings.js';
import type { Annotation, AnnotationFile } from '../model/annotation.js';
import type { CitationFile } from '../model/citation.js';
import type { DocumentRecord } from '../model/document.js';
import type { LogEntry } from '../model/log-entry.js';
import type { Note } from '../model/note.js';
import type { Project } from '../model/project.js';
import type { TaxonomyFile } from '../model/taxonomy.js';
import type { WatchFile } from '../model/watch.js';

/**
 * Optimistic-concurrency failure: the caller worked on an outdated revision.
 * Carries `details.conflict === 'revision'` (see D-031: `ERROR_CODES` has no dedicated code yet).
 */
export class RevisionConflictError extends AppError {
  constructor(what: string, expected: number, actual: number | null) {
    super('ALREADY_EXISTS', 'The data was changed by someone else; reload and retry', { conflict: 'revision', what, expected, actual });
    this.name = 'RevisionConflictError';
  }
}

export function isRevisionConflict(e: unknown): e is AppError {
  return e instanceof AppError && e.details?.['conflict'] === 'revision';
}

export interface PutOptions {
  /**
   * The revision the caller read. When given, the write fails with a revision conflict unless the stored item
   * still has exactly that revision (a missing item counts as a conflict). Only for items that carry a revision
   * (documents); other repositories reject it with INVALID_REQUEST.
   */
  expectedRevision?: number;
}

/**
 * Generic one-file-per-item repository. All writes are atomic.
 * Writes to the same item are serialised inside the process (a queue per file); across processes the
 * revision check is what detects a lost update.
 */
export interface ItemRepository<T, Id extends string = string> {
  get(id: Id): Promise<T | null>;
  /** Ids only, cheap. */
  listIds(): Promise<Id[]>;
  /** Reads and validates every item; invalid files are reported via the logger and skipped. */
  list(): Promise<T[]>;
  /** Writes the item; returns what was stored (with its new revision, when the items have one). */
  put(item: T, options?: PutOptions): Promise<T>;
  /**
   * Serialised read-modify-write: `fn` receives the current item (null when absent) and returns the one to store.
   * Concurrent updates of the same id run one after the other, so none is lost.
   */
  update(id: Id, fn: (current: T | null) => T | Promise<T>): Promise<T>;
  remove(id: Id): Promise<void>;
}

export interface NoteRepository {
  get(docId: DocumentId, page?: number): Promise<Note | null>;
  /** All notes (file + pages) of a document. */
  listForDocument(docId: DocumentId): Promise<Note[]>;
  put(note: Note): Promise<void>;
  remove(docId: DocumentId, page?: number): Promise<void>;
}

/**
 * The library's data directory. Implemented in `@rl/data`.
 * It writes ONLY inside the data dir; original documents are never touched.
 */
export interface LibraryStore {
  /** Absolute root of the library (machine-local knowledge, never serialised). */
  readonly rootPath: string;
  readonly dataDir: string;

  /** Creates the data dir layout and a default library.json if missing. Idempotent. */
  init(): Promise<void>;
  readConfig(): Promise<LibraryConfig>;
  writeConfig(config: LibraryConfig): Promise<void>;

  readonly documents: ItemRepository<DocumentRecord, DocumentId>;
  readonly notes: NoteRepository;
  readonly annotations: {
    get(docId: DocumentId): Promise<AnnotationFile | null>;
    put(file: AnnotationFile): Promise<void>;
    /** Serialised read-modify-write of one document's annotation file. */
    update(docId: DocumentId, fn: (current: AnnotationFile | null) => AnnotationFile | Promise<AnnotationFile>): Promise<AnnotationFile>;
    /** Serialised: two concurrent upserts never lose one another. */
    upsert(docId: DocumentId, annotation: Annotation): Promise<void>;
  };
  readonly citations: ItemRepository<CitationFile, DocumentId>;
  readonly projects: ItemRepository<Project>;
  readTaxonomy(): Promise<TaxonomyFile>;
  /** With `expectedRevision` (the taxonomy revision the caller read) a stale write fails with a revision conflict. */
  writeTaxonomy(taxonomy: TaxonomyFile, options?: PutOptions): Promise<void>;
  /** Serialised read-modify-write of the taxonomy. */
  updateTaxonomy(fn: (current: TaxonomyFile) => TaxonomyFile | Promise<TaxonomyFile>): Promise<void>;
  readWatch(): Promise<WatchFile>;
  writeWatch(watch: WatchFile): Promise<void>;

  /** Appends to this device's log file for the current month. */
  appendLog(entry: LogEntry): Promise<void>;
  readLog(query?: { type?: LogEntry['type']; since?: string; limit?: number }): Promise<LogEntry[]>;

  /** Copies the data dir to `backupDir` (absolute, chosen by main) before the first real write. */
  backup(backupDir: string): Promise<{ files: number }>;
}
