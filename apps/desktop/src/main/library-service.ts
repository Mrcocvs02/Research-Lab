import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  DATA_SUBDIRS,
  dataPath,
  defaultLibraryConfig,
  libraryConfigSchema,
  taxonomyFileSchema,
  type AppSettings,
  type LibraryConfig,
  type LibraryConfigPatch,
  type LibraryProfile,
} from '@rl/core';
import { atomicWriteJson, readJsonFile, resolveInRoot } from '@rl/core/node';
import type { ApprovedPaths } from './approved-paths.js';
import type { SettingsStore } from './settings-store.js';

const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Library profiles (per machine) and library.json. Minimal on purpose: `@rl/data` owns
 * everything else inside the data dir.
 */
export class LibraryService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly approved: ApprovedPaths,
  ) {}

  async create(input: {
    name: string;
    rootPath: string;
    language?: 'it' | 'en';
    dataDirName?: string;
    aiEnabledFolders?: string[];
    taxonomyFilePath?: string;
  }): Promise<LibraryProfile> {
    if (!this.approved.has(input.rootPath)) {
      throw new AppError('PERMISSION_DENIED', 'The library folder must be chosen with the folder dialog');
    }
    const rootPath = path.resolve(input.rootPath);
    const st = await stat(rootPath).catch(() => null);
    if (!st?.isDirectory()) throw new AppError('NOT_FOUND', 'The chosen folder does not exist');

    if (input.taxonomyFilePath !== undefined && !this.approved.has(input.taxonomyFilePath)) {
      throw new AppError('PERMISSION_DENIED', 'The taxonomy file must be chosen with the file dialog');
    }
    // Validate the starting taxonomy before anything is written.
    const taxonomy = input.taxonomyFilePath ? await readJsonFile(input.taxonomyFilePath, taxonomyFileSchema) : null;

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
      const taxonomyFile = path.join(dataDir, dataPath.taxonomy);
      const hasTaxonomy = await stat(taxonomyFile).then(
        () => true,
        () => false,
      );
      if (!hasTaxonomy) await atomicWriteJson(taxonomyFile, taxonomy);
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
      if (!this.approved.has(root.rootPath)) throw new AppError('PERMISSION_DENIED', 'The folder must be chosen with the folder dialog');
      rootPath = path.resolve(root.rootPath);
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

  /** Removes the profile only; no file is deleted. */
  async forget(libraryId: string): Promise<string | null> {
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

  async setConfig(patch: LibraryConfigPatch, libraryId?: string): Promise<LibraryConfig> {
    const dir = await this.dataDir(libraryId);
    const current = await this.getConfig(libraryId);
    const merged = {
      ...current,
      ...defined({
        name: patch.name,
        language: patch.language,
        excludedFolders: patch.excludedFolders,
        aiEnabledFolders: patch.aiEnabledFolders,
        exportPresets: patch.exportPresets,
      }),
      ai: { ...current.ai, ...defined(patch.ai ?? {}) },
      scan: { ...current.scan, ...defined(patch.scan ?? {}) },
      mcp: { ...current.mcp, ...defined(patch.mcp ?? {}) },
    };
    const parsed = libraryConfigSchema.safeParse(merged);
    if (!parsed.success) {
      throw new AppError('INVALID_REQUEST', 'Invalid library configuration', {
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    await atomicWriteJson(path.join(dir, dataPath.config), parsed.data);
    return parsed.data;
  }

  private find(s: AppSettings, id: string): LibraryProfile {
    const p = s.libraries.find((l) => l.id === id);
    if (!p) throw new AppError('NOT_FOUND', 'Unknown library');
    return p;
  }
}
