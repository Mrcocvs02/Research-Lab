import type { DocumentId } from './common.js';

/**
 * Layout of a library data directory, as paths RELATIVE to the data dir (`/` separators).
 * Everything that writes or reads library data must use these helpers, so that
 * all packages agree on the layout.
 */
export const dataPath = {
  config: 'library.json',
  taxonomy: 'taxonomy.json',
  watch: 'watch.json',
  guide: 'CLAUDE.md',
  documents: 'documents',
  document: (id: DocumentId | string) => `documents/${id}.json`,
  fileNote: (id: DocumentId | string) => `notes/${id}.md`,
  pageNote: (id: DocumentId | string, page: number) => `notes/${id}/p${page}.md`,
  annotations: (id: DocumentId | string) => `annotations/${id}.json`,
  citations: (id: DocumentId | string) => `citations/${id}.json`,
  project: (id: string) => `projects/${id}.json`,
  /** Append-only JSONL, one file per device and month (avoids sync conflicts). */
  logFile: (kind: 'changes' | 'ai-sends', deviceId: string, month: string) => `log/${kind}-${month}.${deviceId}.jsonl`,
  commands: 'commands',
} as const;

/** Directory names created inside a data dir (for init and for generality/non-destructive checks). */
export const DATA_SUBDIRS = ['documents', 'notes', 'annotations', 'citations', 'projects', 'log', 'commands'] as const;

/** Local (not synced, rebuildable) files, relative to the machine-local app data dir of a library. */
export const localPath = {
  searchIndex: (libraryId: string) => `libraries/${libraryId}/search.sqlite`,
  cache: (libraryId: string) => `libraries/${libraryId}/cache`,
  vectors: (libraryId: string) => `libraries/${libraryId}/vectors`,
  logs: 'logs',
} as const;
