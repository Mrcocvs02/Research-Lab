import type { LegacyImporter, LibraryConfig, Logger, SecretStore } from '@rl/core';
import type { AiProviderFactory } from '../../ai/provider-factory.js';
import type { ApprovedPaths } from '../../approved-paths.js';
import type { GraphEngine } from '../../graph/engine.js';
import type { RuntimeManager } from '../../library/runtime-manager.js';
import type { LibraryService } from '../../library-service.js';
import type { SettingsStore } from '../../settings-store.js';
import type { EmitFn } from '../types.js';

export interface ShellService {
  /** Opens a file with the default application; resolves '' on success, else an error text (Electron's `shell.openPath`). */
  openPath(absolutePath: string): Promise<string>;
  showItemInFolder(absolutePath: string): void;
  /** Opens an http(s) URL in the system browser (Electron's `shell.openExternal`); the handler has already checked the scheme. */
  openExternal(url: string): Promise<void>;
}

/**
 * Everything handlers may use. Handlers never import `electron`; main/index.ts builds this
 * object with the real implementations, tests build it with fakes.
 */
export interface MainServices {
  log: Logger;
  /** Asks the OS shell for a thumbnail of a file (`nativeImage.createThumbnailFromPath`); absent where the platform has no such API. */
  nativeThumbnail?: (absPath: string, size: number) => Promise<import('../../thumbs.js').NativeImageLike>;
  /** Machine-local, non-synced app folder (caches such as the grid thumbnails). */
  localDataDir: string;
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
  /** Native multi-file picker for PDF files (inbox); resolves [] when cancelled. */
  pickPdfFiles?(): Promise<string[]>;
  /** Native single-file picker for the Claude Code executable; resolves null when cancelled. */
  pickExecutable?(): Promise<string | null>;
  /** The system clipboard (Electron `clipboard`); the MCP configuration with its token is written here in main, never sent to the renderer. */
  clipboard?: { writeText(text: string): void };
  appInfo(): { name: string; version: string; platform: string; electron: string };
  /** Factory so a missing implementation only fails when the feature is used. */
  createImporter(options?: { updateConfig?: (fn: (current: LibraryConfig) => LibraryConfig | Promise<LibraryConfig>) => Promise<unknown> }): LegacyImporter;
  /**
   * Copies an existing data folder into the local (non-synced) backup area before a bulk write.
   * Resolves null when the data folder does not exist yet.
   */
  backupDataDir(libraryId: string, dataDir: string): Promise<{ backupDir: string; files: number } | null>;
  /** The AI provider for a library's configuration (D-204); absent in tests that do not use the AI layer. */
  aiProvider?: AiProviderFactory;
  /** Whether the machine has a network connection (`net.isOnline()`); absent: assumed online. Not used by the mock provider. */
  isOnline?: () => boolean;
  /** HTTPS fetch of the metadata lookup (Electron `net.fetch`); absent in tests that do not use it. */
  fetch?: typeof fetch;
  /** The graph worker (build, similarity on the fly), started on demand; absent: the work runs in-process (tests). */
  graphEngine?: () => GraphEngine;
  /** Test hook (RL_E2E=1, development run only): JSON file that replaces the online metadata lookup. */
  metadataFile?: string | null;
}
