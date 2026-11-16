import type { LegacyImporter, LibraryConfig, Logger, SecretStore } from '@rl/core';
import type { ApprovedPaths } from '../../approved-paths.js';
import type { RuntimeManager } from '../../library/runtime-manager.js';
import type { LibraryService } from '../../library-service.js';
import type { SettingsStore } from '../../settings-store.js';
import type { EmitFn } from '../types.js';

export interface ShellService {
  /** Opens a file with the default application; resolves '' on success, else an error text (Electron's `shell.openPath`). */
  openPath(absolutePath: string): Promise<string>;
  showItemInFolder(absolutePath: string): void;
}

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
  /** Scan, index and search of the active library (see `library/`). */
  runtime: Pick<RuntimeManager, 'sync' | 'require' | 'status' | 'hold'>;
  secrets: SecretStore;
  /** Opens files with the system (injected so that handlers are testable without Electron). Receives absolute paths resolved in main only. */
  shell: ShellService;
  /** Native folder picker; resolves null when cancelled. */
  pickFolder(purpose: 'library-root' | 'legacy-index' | 'export-destination', title?: string): Promise<string | null>;
  /** Native single-file picker; resolves null when cancelled. */
  pickFile(purpose: 'taxonomy-file', title?: string): Promise<string | null>;
  appInfo(): { name: string; version: string; platform: string; electron: string };
  /** Factory so a missing implementation only fails when the feature is used. */
  createImporter(options?: { updateConfig?: (fn: (current: LibraryConfig) => LibraryConfig | Promise<LibraryConfig>) => Promise<unknown> }): LegacyImporter;
  /**
   * Copies an existing data folder into the local (non-synced) backup area before a bulk write.
   * Resolves null when the data folder does not exist yet.
   */
  backupDataDir(libraryId: string, dataDir: string): Promise<{ backupDir: string; files: number } | null>;
}
