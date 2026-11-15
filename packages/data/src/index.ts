import type { LegacyImporter, LibraryStore, Scanner, TextExtractor } from '@rl/core';

export interface LibraryStoreOptions {
  rootPath: string;
  /** Data dir name inside the root (default `.lab`). */
  dataDirName?: string;
  deviceId: string;
}

/** Owner: data-engineer. File-based library store (atomic writes, one file per item). */
export function createLibraryStore(_options: LibraryStoreOptions): LibraryStore {
  throw new Error('not implemented');
}

/** Owner: data-engineer. Read-only walker of the library root. */
export function createScanner(): Scanner {
  throw new Error('not implemented');
}

/** Owner: data-engineer. One-shot importer of the old index (read-only on the source). */
export function createLegacyImporter(): LegacyImporter {
  throw new Error('not implemented');
}

/** Owner: data-engineer. pdf.js based text extraction. */
export function createTextExtractor(): TextExtractor {
  throw new Error('not implemented');
}
