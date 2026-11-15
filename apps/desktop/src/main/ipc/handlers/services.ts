import type { LegacyImporter, Logger, SecretStore } from '@rl/core';
import type { ApprovedPaths } from '../../approved-paths.js';
import type { LibraryService } from '../../library-service.js';
import type { SettingsStore } from '../../settings-store.js';
import type { EmitFn } from '../types.js';

/**
 * Everything handlers may use. Handlers never import `electron`; main/index.ts builds this
 * object with the real implementations, tests build it with fakes.
 */
export interface MainServices {
  log: Logger;
  emit: EmitFn;
  settings: SettingsStore;
  libraries: LibraryService;
  approved: ApprovedPaths;
  secrets: SecretStore;
  /** Native folder picker; resolves null when cancelled. */
  pickFolder(purpose: 'library-root' | 'legacy-index' | 'export-destination', title?: string): Promise<string | null>;
  /** Native single-file picker; resolves null when cancelled. */
  pickFile(purpose: 'taxonomy-file', title?: string): Promise<string | null>;
  appInfo(): { name: string; version: string; platform: string; electron: string };
  /** Factory so a missing implementation only fails when the feature is used. */
  createImporter(): LegacyImporter;
}
