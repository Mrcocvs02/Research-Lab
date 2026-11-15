import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels, createDispatcher, createMemoryLogger, type IpcEnvelope, type SecretScope } from '@rl/core';
import { ApprovedPaths } from '../approved-paths.js';
import { e2eDialogOverride } from '../dialog-override.js';
import { resolveAppDirs } from '../dirs.js';
import { LibraryService } from '../library-service.js';
import { FileSecretStore } from '../secret-store.js';
import { SettingsStore } from '../settings-store.js';
import { buildHandlers, type MainServices } from './handlers/index.js';

let tmp: string;
let picked: string | null;
let pickedFile: string | null;
let events: Array<[string, unknown]>;

function setup() {
  const log = createMemoryLogger();
  const settings = SettingsStore.forDir(path.join(tmp, 'user'), log);
  const approved = new ApprovedPaths();
  const secrets = new FileSecretStore(path.join(tmp, 'user'), {
    isAvailable: () => true,
    encrypt: (p) => Buffer.from(`enc:${p}`, 'utf8').reverse(),
    decrypt: (d) => Buffer.from(d).reverse().toString('utf8').slice(4),
  });
  const services: MainServices = {
    log,
    emit: (e, p) => void events.push([e, p]),
    settings,
    approved,
    libraries: new LibraryService(settings, approved, secrets),
    secrets,
    pickFolder: async () => picked,
    pickFile: async () => pickedFile,
    appInfo: () => ({ name: 'Research Lab', version: '0', platform: 'test', electron: 'x' }),
    backupDataDir: async () => null,
    createImporter: () => {
      throw new Error('not implemented');
    },
  };
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  const call = async (channel: string, payload: unknown = {}) => dispatch(channel, payload);
  return { call, services, log };
}

const data = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const errCode = (r: IpcEnvelope) => (r.ok ? 'ok' : r.error.code);
const errorCodeOf = errCode;

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rl-desktop-')));
  picked = null;
  pickedFile = null;
  events = [];
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('app dirs', () => {
  it('honours env overrides and otherwise uses defaults', () => {
    const d = resolveAppDirs({ RL_USER_DATA_DIR: path.join(tmp, 'u'), RL_LOCAL_DATA_DIR: path.join(tmp, 'l') }, { userData: 'X' }, false);
    expect(d).toEqual({ userData: path.join(tmp, 'u'), localData: path.join(tmp, 'l') });
    const def = resolveAppDirs({ LOCALAPPDATA: path.join(tmp, 'la'), RL_USER_DATA_DIR: 'relative' }, { userData: path.join(tmp, 'default') }, false);
    expect(def.userData).toBe(path.join(tmp, 'default'));
    expect(def.localData).toBe(path.join(tmp, 'la', 'ResearchLab'));
  });
});

describe('settings handlers', () => {
  it('returns defaults, patches user and language, persists', async () => {
    const { call } = setup();
    expect(data(await call('settings:get')).uiLanguage).toBe('it');
    const next = data(await call('settings:set', { uiLanguage: 'en', user: { name: 'Test User', authorVariants: ['T. User'] } }));
    expect(next.uiLanguage).toBe('en');
    expect(next.user).toMatchObject({ name: 'Test User', authorVariants: ['T. User'], email: '' });
    const again = setup();
    expect(data(await again.call('settings:get')).user.name).toBe('Test User');
  });

  it('creates the defaults once under concurrent first reads', async () => {
    const { call } = setup();
    const [a, b] = await Promise.all([call('settings:get'), call('settings:get')]);
    expect(data(a).deviceId).toBe(data(b).deviceId);
    expect(JSON.parse(await readFile(path.join(tmp, 'user', 'settings.json'), 'utf8')).deviceId).toBe(data(a).deviceId);
  });

  it('rejects invalid input and cannot touch libraries through settings:set', async () => {
    const { call } = setup();
    expect(errCode(await call('settings:set', { user: { orcid: 'bad' } }))).toBe('INVALID_REQUEST');
    await call('settings:set', { libraries: [{ id: 'x' }] });
    expect(data(await call('settings:get')).libraries).toEqual([]);
  });

  it('moves an invalid settings file aside instead of crashing', async () => {
    await mkdir(path.join(tmp, 'user'), { recursive: true });
    await writeFile(path.join(tmp, 'user', 'settings.json'), '{broken');
    const { call } = setup();
    expect(data(await call('settings:get')).uiLanguage).toBe('it');
    const files = await readdir(path.join(tmp, 'user'));
    expect(files.some((f) => f.startsWith('settings.json.invalid-'))).toBe(true);
    const notices = data(await call('app:notices')).notices;
    expect(notices).toMatchObject([{ kind: 'settings-reset', reason: 'invalid-json' }]);
  });
});

describe('library handlers', () => {
  it('refuses a root that did not come from the dialog', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(root);
    expect(errCode(await call('library:create', { name: 'L', rootPath: root }))).toBe('PERMISSION_DENIED');
  });

  it('creates a library after the dialog, writes only the data dir, activates the first one', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'My Library');
    await mkdir(root);
    picked = root;
    const chosen = data(await call('dialog:chooseFolder', { purpose: 'library-root' }));
    expect(chosen).toEqual({ path: root, name: 'My Library' });

    const profile = data(await call('library:create', { name: 'Mine', rootPath: chosen.path, language: 'en' }));
    expect(profile).toMatchObject({ name: 'Mine', rootPath: root, dataDirName: '.lab' });
    const list = data(await call('library:list'));
    expect(list.activeLibraryId).toBe(profile.id);

    const cfg = JSON.parse(await readFile(path.join(root, '.lab', 'library.json'), 'utf8'));
    expect(cfg.language).toBe('en');
    expect(cfg.aiEnabledFolders).toEqual([]);
    expect(JSON.stringify(cfg)).not.toContain(tmp.replaceAll('\\', '\\\\')); // no absolute path in library.json

    expect(errCode(await call('library:create', { name: 'Again', rootPath: root }))).toBe('ALREADY_EXISTS');
  });

  it('supports a second library, custom data dir, switching, config patching and forgetting', async () => {
    const { call } = setup();
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    await mkdir(a);
    await mkdir(b);
    picked = a;
    await call('dialog:chooseFolder', { purpose: 'library-root' });
    picked = b;
    await call('dialog:chooseFolder', { purpose: 'library-root' });
    const pa = data(await call('library:create', { name: 'A', rootPath: a }));
    const pb = data(await call('library:create', { name: 'B', rootPath: b, dataDirName: '_data', language: 'en' }));
    await readFile(path.join(b, '_data', 'library.json'));

    expect(data(await call('library:setActive', { libraryId: pb.id })).activeLibraryId).toBe(pb.id);
    const cfg = data(await call('library:setConfig', { patch: { aiEnabledFolders: ['papers'], ai: { defaultReasoning: 'high' }, mcp: { enabled: true } } }));
    expect(cfg.aiEnabledFolders).toEqual(['papers']);
    expect(cfg.ai.defaultReasoning).toBe('high');
    expect(cfg.ai.models).toHaveLength(2);
    expect(cfg.mcp).toEqual({ enabled: true, writeEnabled: false });
    expect(data(await call('library:getConfig', { libraryId: pa.id })).aiEnabledFolders).toEqual([]);

    expect(errCode(await call('library:setConfig', { patch: { aiEnabledFolders: ['../escape'] } }))).toBe('INVALID_REQUEST');
    expect(errCode(await call('library:setConfig', { patch: { ai: { defaultModel: 'ghost' } } }))).toBe('INVALID_REQUEST');

    expect(data(await call('library:forget', { libraryId: pb.id })).activeLibraryId).toBe(pa.id);
    await readFile(path.join(b, '_data', 'library.json')); // files are kept
    expect(errCode(await call('library:setActive', { libraryId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('rejects a data dir name that would escape the root', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'r');
    await mkdir(root);
    picked = root;
    await call('dialog:chooseFolder', { purpose: 'library-root' });
    expect(errCode(await call('library:create', { name: 'x', rootPath: root, dataDirName: '..' }))).toBe('INVALID_REQUEST');
  });
});

describe('secrets handlers', () => {
  it('stores encrypted, reports presence, never returns the value, deletes', async () => {
    const { call, services } = setup();
    const scope = { kind: 'app' } as const;
    expect(data(await call('secrets:has', { scope, name: 'anthropic-key' })).exists).toBe(false);
    expect(data(await call('secrets:set', { scope, name: 'anthropic-key', value: 'sk-test-123' }))).toEqual({});
    expect(data(await call('secrets:has', { scope, name: 'anthropic-key' })).exists).toBe(true);

    const raw = await readFile(path.join(tmp, 'user', 'secrets.json'), 'utf8');
    expect(raw).not.toContain('sk-test-123');
    expect(await services.secrets.get(scope as SecretScope, 'anthropic-key')).toBe('sk-test-123');

    await call('secrets:delete', { scope, name: 'anthropic-key' });
    expect(data(await call('secrets:has', { scope, name: 'anthropic-key' })).exists).toBe(false);
  });

  it('fails clearly when secure storage is unavailable', async () => {
    const { services } = setup();
    const store = new FileSecretStore(path.join(tmp, 'user2'), { isAvailable: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' });
    await expect(async () => store.set({ kind: 'app' }, 'k', 'v')).rejects.toMatchObject({ code: 'SECRET_UNAVAILABLE' });
    void services;
  });
});

describe('import handlers', () => {
  it('requires a dialog-approved source and reports NOT_IMPLEMENTED until the importer exists', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    const src = path.join(tmp, 'old-index');
    await mkdir(root);
    await mkdir(src);
    picked = root;
    await call('dialog:chooseFolder', { purpose: 'library-root' });
    const profile = data(await call('library:create', { name: 'L', rootPath: root }));
    expect(errCode(await call('import:startLegacy', { libraryId: profile.id, sourcePath: src }))).toBe('PERMISSION_DENIED');
    picked = src;
    await call('dialog:chooseFolder', { purpose: 'legacy-index' });
    expect(errCode(await call('import:startLegacy', { libraryId: profile.id, sourcePath: src }))).toBe('NOT_IMPLEMENTED');
    expect(errCode(await call('import:status', { jobId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('runs a job with a fake importer and publishes progress events', async () => {
    const { call, services } = setup();
    services.createImporter = () => ({
      run: async ({ onProgress }) => {
        onProgress?.({ jobId: 'x', state: 'running', processed: 1, total: 2 });
        return { documents: 2, taxonomyNodes: 1, skipped: 0, warnings: [] };
      },
    });
    const root = path.join(tmp, 'lib');
    const src = path.join(tmp, 'old');
    await mkdir(root);
    await mkdir(src);
    picked = root;
    await call('dialog:chooseFolder', { purpose: 'library-root' });
    picked = src;
    await call('dialog:chooseFolder', { purpose: 'legacy-index' });
    const dispatch = createDispatcher(channels, buildHandlers(services), services.log);
    const profile = data(await dispatch('library:create', { name: 'L', rootPath: root }));
    const { jobId } = data(await dispatch('import:startLegacy', { libraryId: profile.id, sourcePath: src }));
    await new Promise((r) => setTimeout(r, 50));
    const status = data(await dispatch('import:status', { jobId }));
    expect(status).toMatchObject({ state: 'done', report: { documents: 2 } });
    expect(events.map((e) => e[0])).toContain('import:progress');
  });
});

describe('first-run helpers', () => {
  const choose = async (call: (c: string, p?: unknown) => Promise<IpcEnvelope>, dir: string) => {
    picked = dir;
    return data(await call('dialog:chooseFolder', { purpose: 'library-root' }));
  };

  it('lists sub-folders lazily, skips hidden ones, and needs an approved root', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, 'Alpha', 'Deep'), { recursive: true });
    await mkdir(path.join(root, 'beta'));
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, 'file.txt'), 'x');
    expect(errorCodeOf(await call('library:listFolders', { rootPath: root }))).toBe('PERMISSION_DENIED');
    await choose(call, root);
    const top = data(await call('library:listFolders', { rootPath: root })).folders;
    expect(top).toEqual([
      { path: 'Alpha', name: 'Alpha', hasChildren: true },
      { path: 'beta', name: 'beta', hasChildren: false },
    ]);
    const sub = data(await call('library:listFolders', { rootPath: root, parent: 'Alpha' })).folders;
    expect(sub).toEqual([{ path: 'Alpha/Deep', name: 'Deep', hasChildren: false }]);
    expect(errorCodeOf(await call('library:listFolders', { rootPath: root, parent: '../x' }))).toBe('INVALID_REQUEST');
  });

  it('lists the folders of an existing library by id', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, 'one'), { recursive: true });
    await choose(call, root);
    const p = data(await call('library:create', { name: 'L', rootPath: root }));
    const r = data(await call('library:listFolders', { libraryId: p.id })).folders;
    expect(r.map((f: { path: string }) => f.path)).toEqual(['one']);
  });

  it('creates a library with AI folders and a starting taxonomy from an approved file', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, 'papers'), { recursive: true });
    const file = path.join(tmp, 'tax.json');
    await writeFile(file, JSON.stringify({ nodes: [{ id: 'topic-a', label: 'Topic A' }] }));
    await choose(call, root);
    // An unapproved taxonomy path is refused.
    expect(errorCodeOf(await call('library:create', { name: 'L', rootPath: root, taxonomyFilePath: file }))).toBe('PERMISSION_DENIED');
    pickedFile = file;
    expect(data(await call('dialog:chooseFile', { purpose: 'taxonomy-file' }))).toEqual({ path: file, name: 'tax.json' });
    await call('library:create', { name: 'L', rootPath: root, aiEnabledFolders: ['papers'], taxonomyFilePath: file });
    const cfg = JSON.parse(await readFile(path.join(root, '.lab', 'library.json'), 'utf8'));
    expect(cfg.aiEnabledFolders).toEqual(['papers']);
    const tax = JSON.parse(await readFile(path.join(root, '.lab', 'taxonomy.json'), 'utf8'));
    expect(tax.nodes[0]).toMatchObject({ id: 'topic-a', label: 'Topic A' });
  });

  it('rejects an invalid taxonomy file before creating anything', async () => {
    const { call, services } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(root);
    const file = path.join(tmp, 'bad.json');
    await writeFile(file, JSON.stringify({ nodes: [{ label: '' }] }));
    await choose(call, root);
    pickedFile = file;
    await call('dialog:chooseFile', { purpose: 'taxonomy-file' });
    expect(errorCodeOf(await call('library:create', { name: 'L', rootPath: root, taxonomyFilePath: file }))).toBe('SCHEMA_INVALID');
    expect((await services.libraries.list()).profiles).toEqual([]);
  });

  it('renames the profile and library.json without touching other files', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(root);
    await choose(call, root);
    const p = data(await call('library:create', { name: 'Old', rootPath: root }));
    const renamed = data(await call('library:rename', { libraryId: p.id, name: 'New name' }));
    expect(renamed.name).toBe('New name');
    expect(data(await call('library:getConfig', {})).name).toBe('New name');
    expect(errorCodeOf(await call('library:rename', { libraryId: 'ghost', name: 'x' }))).toBe('NOT_FOUND');
  });

  it('probes a legacy index read-only and reports counts', async () => {
    const { call } = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, '.phd_index'), { recursive: true });
    await choose(call, root);
    expect(data(await call('import:probeLegacy', { rootPath: root }))).toEqual({ found: false, documents: 0, taxonomyNodes: 0 });
    await writeFile(path.join(root, '.phd_index', 'files.jsonl'), '{"p":"a.pdf"}\n\n{"p":"b.pdf"}\nnot json\n');
    await writeFile(path.join(root, '.phd_index', 'taxonomy.json'), JSON.stringify({ macro: { m1: {} }, micro: { u1: { macro: ['m1'] }, u2: {} } }));
    expect(data(await call('import:probeLegacy', { rootPath: root }))).toEqual({ found: true, documents: 3, taxonomyNodes: 3 });
    expect(errorCodeOf(await call('import:probeLegacy', { rootPath: path.join(tmp, 'other') }))).toBe('PERMISSION_DENIED');
  });
});

describe('e2e dialog override', () => {
  it('only applies with RL_E2E=1 and an absolute path', () => {
    const abs = path.join(tmp, 'picked');
    expect(e2eDialogOverride({ RL_E2E: '1', RL_E2E_DIALOG_PATH: abs }, false)).toBe(abs);
    expect(e2eDialogOverride({ RL_E2E_DIALOG_PATH: abs }, false)).toBeNull();
    expect(e2eDialogOverride({ RL_E2E: '0', RL_E2E_DIALOG_PATH: abs }, false)).toBeNull();
    expect(e2eDialogOverride({ RL_E2E: '1', RL_E2E_DIALOG_PATH: 'relative/dir' }, false)).toBeNull();
    expect(e2eDialogOverride({ RL_E2E: '1' }, false)).toBeNull();
  });
});
