import type { LegacyImporter, Scanner, TextExtractor } from '@rl/core';
import { createLegacyImporterImpl, type LegacyImporterOptions } from './legacy-importer.js';

export { backupDataDir, copyDataDir } from './backup.js';
export { createLibraryStore, type FileLibraryStore, type LibraryStoreOptions, type LoadIssue } from './store.js';
export { NameIndex, normalizeName, slugify } from './normalize.js';
export { withRetry, isTransientIoError, type RetryOptions } from './retry.js';
export { diffTaxonomy } from './taxonomy-diff.js';
export type { LegacyImporterOptions } from './legacy-importer.js';

/** Owner: data-engineer. Read-only walker of the library root. */
export function createScanner(): Scanner {
  throw new Error('not implemented');
}

/** One-shot importer of the old index (read-only on the source). */
export function createLegacyImporter(options?: LegacyImporterOptions): LegacyImporter {
  return createLegacyImporterImpl(options);
}

/** Owner: data-engineer. pdf.js based text extraction. */
export function createTextExtractor(): TextExtractor {
  throw new Error('not implemented');
}
