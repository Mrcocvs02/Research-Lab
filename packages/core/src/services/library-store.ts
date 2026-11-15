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

/** Generic one-file-per-item repository. All writes are atomic. */
export interface ItemRepository<T, Id extends string = string> {
  get(id: Id): Promise<T | null>;
  /** Ids only, cheap. */
  listIds(): Promise<Id[]>;
  /** Reads and validates every item; invalid files are reported via the logger and skipped. */
  list(): Promise<T[]>;
  put(item: T): Promise<void>;
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
    upsert(docId: DocumentId, annotation: Annotation): Promise<void>;
  };
  readonly citations: ItemRepository<CitationFile, DocumentId>;
  readonly projects: ItemRepository<Project>;
  readTaxonomy(): Promise<TaxonomyFile>;
  writeTaxonomy(taxonomy: TaxonomyFile): Promise<void>;
  readWatch(): Promise<WatchFile>;
  writeWatch(watch: WatchFile): Promise<void>;

  /** Appends to this device's log file for the current month. */
  appendLog(entry: LogEntry): Promise<void>;
  readLog(query?: { type?: LogEntry['type']; since?: string; limit?: number }): Promise<LogEntry[]>;

  /** Copies the data dir to `backupDir` (absolute, chosen by main) before the first real write. */
  backup(backupDir: string): Promise<{ files: number }>;
}
