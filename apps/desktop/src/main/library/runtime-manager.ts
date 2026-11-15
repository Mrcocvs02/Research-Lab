import { AppError, type LibraryStore, type Logger, type ScanStatus, type SearchIndex } from '@rl/core';
import type { LibraryService } from '../library-service.js';
import type { SettingsStore } from '../settings-store.js';
import { LibraryRuntime, localPaths, type RuntimeDeps } from './library-runtime.js';
import type { LibraryWorker } from './worker-protocol.js';

export interface ManagerDeps {
  libraries: Pick<LibraryService, 'list' | 'profile' | 'dataDir'>;
  settings: Pick<SettingsStore, 'get'>;
  /** Machine-local app folder (index, cache, backups). */
  localDataDir: string;
  log: Logger;
  /** Pushes a status to the renderer (`scan:progress`). */
  emit(status: ScanStatus): void;
  backupDataDir(libraryId: string, dataDir: string): Promise<unknown>;
  createStore(options: { rootPath: string; dataDir: string; deviceId: string }): LibraryStore;
  createIndex(): SearchIndex;
  /** Starts the worker thread of a library (the manager disposes it when the library closes). */
  spawnWorker(): LibraryWorker;
  watch?: RuntimeDeps['watch'];
  runtime?: Pick<RuntimeDeps, 'progressIntervalMs' | 'watchDebounceMs' | 'now'>;
}

/**
 * Keeps one `LibraryRuntime`, the one of the active library: opens it when the library becomes active
 * (and starts the first scan), closes it on a switch or at exit. `sync()` is cheap when nothing changed, so
 * IPC handlers call it before they use the runtime.
 */
export class RuntimeManager {
  private rt: LibraryRuntime | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private openError: { libraryId: string; error: AppError } | null = null;
  /** Libraries where something else is writing the data folder (the legacy import): no scan meanwhile. */
  private readonly holds = new Map<string, number>();

  constructor(private readonly d: ManagerDeps) {}

  /**
   * Makes the runtime match the active library. With `autoScan`, a library that is opened here is scanned
   * at once (app start, library switch); otherwise it only opens. Never throws: a library that cannot open
   * is reported by `status()`.
   */
  sync(options: { autoScan?: boolean } = {}): Promise<void> {
    const run = async () => {
      const { activeLibraryId } = await this.d.libraries.list();
      if (this.rt && this.rt.libraryId === activeLibraryId) return;
      if (!this.rt && this.openError?.libraryId === activeLibraryId) return;
      const old = this.rt;
      this.rt = null;
      this.openError = null;
      await old?.close().catch((e: unknown) => this.d.log.warn('closing the previous library failed', { error: e }));
      if (!activeLibraryId) return;
      try {
        this.rt = await this.open(activeLibraryId);
        if (options.autoScan && !this.isHeld(activeLibraryId)) this.rt.startScan();
      } catch (e) {
        this.d.log.error('library runtime could not start', { error: e, libraryId: activeLibraryId });
        const error = AppError.from(e);
        this.openError = { libraryId: activeLibraryId, error };
        this.d.emit(this.status());
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next as Promise<void>;
  }

  private isHeld(libraryId: string): boolean {
    return (this.holds.get(libraryId) ?? 0) > 0;
  }

  /**
   * Keeps scans of `libraryId` from starting until the returned function is called (the legacy import writes the
   * same records; scanning meanwhile would race it). Releasing starts the scan the hold postponed.
   */
  hold(libraryId: string): () => void {
    this.holds.set(libraryId, (this.holds.get(libraryId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.holds.get(libraryId) ?? 1) - 1;
      if (n <= 0) this.holds.delete(libraryId);
      else this.holds.set(libraryId, n);
      if (n <= 0) {
        void this.sync({ autoScan: true }).then(() => {
          if (this.rt?.libraryId === libraryId) this.rt.startScan();
        });
      }
    };
  }

  private async open(libraryId: string): Promise<LibraryRuntime> {
    const profile = await this.d.libraries.profile(libraryId);
    const dataDir = await this.d.libraries.dataDir(libraryId);
    const { deviceId } = await this.d.settings.get();
    const { indexFile, textCacheDir } = localPaths(this.d.localDataDir, libraryId);
    const worker = this.d.spawnWorker();
    try {
      return await LibraryRuntime.open({
        libraryId,
        rootPath: profile.rootPath,
        store: this.d.createStore({ rootPath: profile.rootPath, dataDir, deviceId }),
        index: this.d.createIndex(),
        worker,
        indexFile,
        textCacheDir,
        log: this.d.log,
        onStatus: (s) => this.d.emit(s),
        backup: async () => {
          const r = await this.d.backupDataDir(libraryId, dataDir);
          if (r) this.d.log.info('data folder backed up before the first scan write');
        },
        watch: this.d.watch,
        ...this.d.runtime,
      });
    } catch (e) {
      await worker.dispose().catch(() => {});
      throw e;
    }
  }

  /** The runtime of the active library; `libraryId`, when given, must be that library. */
  async require(libraryId?: string, options: { retry?: boolean } = {}): Promise<LibraryRuntime> {
    if (options.retry && !this.rt) this.openError = null;
    await this.sync();
    if (!this.rt) {
      if (this.openError) throw this.openError.error;
      throw new AppError('LIBRARY_NOT_ACTIVE', 'No active library');
    }
    if (libraryId !== undefined && libraryId !== this.rt.libraryId) throw new AppError('LIBRARY_NOT_ACTIVE', 'This library is not the active one');
    if (options.retry && this.isHeld(this.rt.libraryId)) throw new AppError('ALREADY_EXISTS', 'The library is being imported; scanning starts when the import is done');
    return this.rt;
  }

  /** Status of the active library's scan; idle when there is none. */
  status(): ScanStatus {
    if (this.rt) return this.rt.status();
    if (this.openError) {
      return { libraryId: this.openError.libraryId, state: 'failed', seen: 0, processed: 0, indexed: 0, error: this.openError.error.toJSON() };
    }
    return { libraryId: null, state: 'idle', seen: 0, processed: 0, indexed: 0 };
  }

  async closeAll(): Promise<void> {
    await this.chain;
    const rt = this.rt;
    this.rt = null;
    await rt?.close();
  }
}
