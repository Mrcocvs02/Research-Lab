import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  applyPatch,
  DATA_SUBDIRS,
  dataPath,
  defaultLibraryConfig,
  libraryConfigSchema,
  taxonomyFileSchema,
  type AppSettings,
  type LibraryConfig,
  type LibraryConfigPatch,
  type LibraryProfile,
  type SecretStore,
} from '@rl/core';
import { atomicWriteJson, DEFAULT_MAX_READ_BYTES, readJsonFile, resolveInRoot } from '@rl/core/node';
import type { ApprovedPaths } from './approved-paths.js';
import type { SettingsStore } from './settings-store.js';

/**
 * Library profiles (per machine) and library.json. Minimal on purpose: `@rl/data` owns
 * everything else inside the data dir.
 */
export class LibraryService {
  /** One write queue per library: read-modify-write of library.json must not interleave. */
  private readonly configQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly approved: ApprovedPaths,
    /** Secrets scoped to a library are removed when its profile is forgotten. */
    private readonly secrets?: Pick<SecretStore, 'deleteLibrary'>,
  ) {}

  async create(input: {
    name: string;
    rootPath: string;
    language?: 'it' | 'en';
    dataDirName?: string;
    aiEnabledFolders?: string[];
    taxonomyFilePath?: string;
  }): Promise<LibraryProfile> {
    const rootPath = this.approved.resolve(input.rootPath, 'library-root');
    if (rootPath === null) {
      throw new AppError('PERMISSION_DENIED', 'The library folder must be chosen with the folder dialog');
    }
    const st = await stat(rootPath).catch(() => null);
    if (!st?.isDirectory()) throw new AppError('NOT_FOUND', 'The chosen folder does not exist');

    const taxonomyFile = input.taxonomyFilePath === undefined ? null : this.approved.resolve(input.taxonomyFilePath, 'taxonomy-file');
    if (input.taxonomyFilePath !== undefined && taxonomyFile === null) {
      throw new AppError('PERMISSION_DENIED', 'The taxonomy file must be chosen with the file dialog');
    }
    // Validate the starting taxonomy (size-capped) before anything is written.
    const taxonomy = taxonomyFile ? await readJsonFile(taxonomyFile, taxonomyFileSchema, { maxBytes: DEFAULT_MAX_READ_BYTES }) : null;

    const current = await this.settings.get();
    const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (current.libraries.some((l) => same(l.rootPath, rootPath))) {
      throw new AppError('ALREADY_EXISTS', 'A library for this folder already exists');
    }

    const profile: LibraryProfile = {
      id: `lib-${randomBytes(4).toString('hex')}`,
      name: input.name,
      rootPath,
      dataDirName: input.dataDirName ?? '.lab',
      createdAt: new Date().toISOString(),
    };

    // Initialise the data dir (the only place the app writes), confined to the root.
    const dataDir = await resolveInRoot(rootPath, profile.dataDirName);
    await this.assertUsableDataDir(dataDir);
    await mkdir(dataDir, { recursive: true });
    for (const sub of DATA_SUBDIRS) await mkdir(path.join(dataDir, sub), { recursive: true });
    const configFile = path.join(dataDir, dataPath.config);
    const exists = await stat(configFile).then(
      () => true,
      () => false,
    );
    if (!exists) {
      const config = defaultLibraryConfig({ name: profile.name, language: input.language ?? current.uiLanguage });
      config.aiEnabledFolders = input.aiEnabledFolders ?? [];
      await atomicWriteJson(configFile, libraryConfigSchema.parse(config));
    }
    if (taxonomy) {
      const target = path.join(dataDir, dataPath.taxonomy);
      const hasTaxonomy = await stat(target).then(
        () => true,
        () => false,
      );
      if (!hasTaxonomy) await atomicWriteJson(target, taxonomy);
    }

    await this.settings.update((s) => {
      s.libraries.push(profile);
      if (s.activeLibraryId === null) s.activeLibraryId = profile.id;
    });
    return profile;
  }

  /** Renames the profile (per machine) and the name stored in library.json. */
  async rename(libraryId: string, name: string): Promise<LibraryProfile> {
    const profile = await this.profile(libraryId);
    await this.setConfig({ name }, libraryId).catch((e: unknown) => {
      // A missing data dir must not block renaming the profile.
      if (!(e instanceof AppError && (e.code === 'NOT_FOUND' || e.code === 'PATH_OUTSIDE_ROOT'))) throw e;
    });
    const next = await this.settings.update((s) => {
      this.find(s, profile.id).name = name;
    });
    return this.find(next, profile.id);
  }

  /** Direct sub-folders of `parent` under a root (hidden folders skipped). Read-only. */
  async listFolders(
    root: { rootPath?: string; libraryId?: string },
    parent = '',
  ): Promise<Array<{ path: string; name: string; hasChildren: boolean }>> {
    let rootPath: string;
    if (root.rootPath !== undefined) {
      const approved = this.approved.resolve(root.rootPath, 'library-root');
      if (approved === null) throw new AppError('PERMISSION_DENIED', 'The folder must be chosen with the folder dialog');
      rootPath = approved;
    } else {
      rootPath = (await this.profile(root.libraryId)).rootPath;
    }
    const dir = parent ? await resolveInRoot(rootPath, parent) : rootPath;
    const subdirs = async (d: string) => {
      const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    };
    const names = (await subdirs(dir)).sort((a, b) => a.localeCompare(b)).slice(0, 500);
    return Promise.all(
      names.map(async (name) => ({
        path: parent ? `${parent}/${name}` : name,
        name,
        hasChildren: (await subdirs(path.join(dir, name))).length > 0,
      })),
    );
  }

  async list(): Promise<{ profiles: LibraryProfile[]; activeLibraryId: string | null }> {
    const s = await this.settings.get();
    return { profiles: s.libraries, activeLibraryId: s.activeLibraryId };
  }

  async setActive(libraryId: string): Promise<string> {
    await this.settings.update((s) => {
      this.find(s, libraryId);
      s.activeLibraryId = libraryId;
    });
    return libraryId;
  }

  /**
   * Removes the profile and the secrets scoped to it (API keys of that library); no library
   * file is deleted. Secrets go first: if that fails the profile is still there and the user can retry.
   */
  async forget(libraryId: string): Promise<string | null> {
    await this.profile(libraryId);
    await this.secrets?.deleteLibrary(libraryId);
    const next = await this.settings.update((s) => {
      this.find(s, libraryId);
      s.libraries = s.libraries.filter((l) => l.id !== libraryId);
      if (s.activeLibraryId === libraryId) s.activeLibraryId = s.libraries[0]?.id ?? null;
    });
    return next.activeLibraryId;
  }

  async profile(libraryId?: string): Promise<LibraryProfile> {
    const s = await this.settings.get();
    const id = libraryId ?? s.activeLibraryId;
    if (!id) throw new AppError('LIBRARY_NOT_ACTIVE', 'No active library');
    return this.find(s, id);
  }

  async dataDir(libraryId?: string): Promise<string> {
    const p = await this.profile(libraryId);
    return resolveInRoot(p.rootPath, p.dataDirName);
  }

  async getConfig(libraryId?: string): Promise<LibraryConfig> {
    const file = path.join(await this.dataDir(libraryId), dataPath.config);
    return readJsonFile(file, libraryConfigSchema).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return defaultLibraryConfig();
      throw e;
    });
  }

  /** Applies a patch to library.json: only the fields present change; arrays are replaced whole. */
  setConfig(patch: LibraryConfigPatch, libraryId?: string): Promise<LibraryConfig> {
    return this.updateConfig((current) => applyPatch(current, patch), libraryId);
  }

  /**
   * Serialised read-modify-write of library.json (one queue per library). Anything in the main
   * process that rewrites library.json should go through here, so concurrent writers cannot
   * overwrite each other's changes.
   */
  async updateConfig(mutate: (current: LibraryConfig) => unknown, libraryId?: string): Promise<LibraryConfig> {
    const profile = await this.profile(libraryId);
    const run = async () => {
      const dir = await this.dataDir(profile.id);
      const current = await this.getConfig(profile.id);
      const parsed = libraryConfigSchema.safeParse(mutate(structuredClone(current)));
      if (!parsed.success) {
        throw new AppError('INVALID_REQUEST', 'Invalid library configuration', {
          issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      await atomicWriteJson(path.join(dir, dataPath.config), parsed.data);
      return parsed.data;
    };
    const prev = this.configQueues.get(profile.id) ?? Promise.resolve();
    const result = prev.then(run, run);
    const tail = result.catch(() => {});
    this.configQueues.set(profile.id, tail);
    void tail.then(() => {
      if (this.configQueues.get(profile.id) === tail) this.configQueues.delete(profile.id);
    });
    return result;
  }

  /**
   * A data folder name that already exists must be a Research Lab data folder (valid
   * library.json) or empty (left by an interrupted creation); otherwise we would write into
   * somebody else's folder.
   */
  private async assertUsableDataDir(dataDir: string): Promise<void> {
    const st = await stat(dataDir).catch(() => null);
    if (!st) return;
    const refuse = () => new AppError('ALREADY_EXISTS', 'A folder with this name already exists and is not a Research Lab data folder');
    if (!st.isDirectory()) throw refuse();
    if ((await readdir(dataDir)).length === 0) return;
    await readJsonFile(path.join(dataDir, dataPath.config), libraryConfigSchema, { maxBytes: DEFAULT_MAX_READ_BYTES }).catch(() => {
      throw refuse();
    });
  }

  private find(s: AppSettings, id: string): LibraryProfile {
    const p = s.libraries.find((l) => l.id === id);
    if (!p) throw new AppError('NOT_FOUND', 'Unknown library');
    return p;
  }
}
