import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels, createDispatcher, createMemoryLogger, type ImportReport, type IpcEnvelope, type LegacyImporter } from '@rl/core';
import { ApprovedPaths } from '../approved-paths.js';
import { LibraryService } from '../library-service.js';
import { FileSecretStore, type Cipher } from '../secret-store.js';
import { SettingsStore } from '../settings-store.js';
import { probeLegacyIndex } from './handlers/core-handlers.js';
import { noRuntime } from './no-runtime.js';
import { buildHandlers, type MainServices } from './handlers/index.js';

let tmp: string;
let picked: string | null;
let pickedFile: string | null;

const goodCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(`enc:${p}`, 'utf8').reverse(),
  decrypt: (d) => Buffer.from(d).reverse().toString('utf8').slice(4),
};

function setup(options: { cipher?: Cipher } = {}) {
  const log = createMemoryLogger();
  const settings = SettingsStore.forDir(path.join(tmp, 'user'), log);
  const approved = new ApprovedPaths();
  const secrets = new FileSecretStore(path.join(tmp, 'user'), options.cipher ?? goodCipher);
  const services: MainServices = {
    log,
    emit: () => {},
    settings,
    approved,
    runtime: noRuntime,
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
  const dispatch = createDispatcher(channels, buildHandlers(services), log); // one dispatcher: handler state (import lock) is shared, as in the app
  const call = async (channel: string, payload: unknown = {}) => dispatch(channel, payload);
  return { call, services, log };
}
type Setup = ReturnType<typeof setup>;

const data = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const code = (r: IpcEnvelope) => (r.ok ? 'ok' : r.error.code);

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rl-hardening-h-')));
  picked = null;
  pickedFile = null;
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const approve = async (s: Setup, dir: string, purpose: 'library-root' | 'legacy-index' | 'export-destination') => {
  picked = dir;
  return data(await s.call('dialog:chooseFolder', { purpose }));
};
const approveFile = async (s: Setup, file: string) => {
  pickedFile = file;
  return data(await s.call('dialog:chooseFile', { purpose: 'taxonomy-file' }));
};
const mkLibrary = async (s: Setup, name = 'lib') => {
  const root = path.join(tmp, name);
  await mkdir(root, { recursive: true });
  await approve(s, root, 'library-root');
  return { root, profile: data(await s.call('library:create', { name, rootPath: root })) };
};

describe('partial patches through the handlers (defect: defaults were re-applied)', () => {
  it('settings:set keeps the profile fields that were not sent', async () => {
    const { call } = setup();
    await call('settings:set', { user: { name: 'Test User', email: 'test@example.com', orcid: '0000-0002-1825-0097', authorVariants: ['T. User'] } });
    const next = data(await call('settings:set', { user: { name: 'Other Name' } }));
    expect(next.user).toMatchObject({ name: 'Other Name', email: 'test@example.com', orcid: '0000-0002-1825-0097', authorVariants: ['T. User'] });
    expect(data(await call('settings:set', { uiLanguage: 'en' })).user.name).toBe('Other Name');
    expect(data(await call('settings:set', { user: {} })).user.email).toBe('test@example.com');
  });

  it('library:setConfig keeps provider, models, defaultModel, usage cap and mcp.enabled', async () => {
    const s = setup();
    await mkLibrary(s);
    const models = [
      { id: 'm-small', label: 'Small' },
      { id: 'm-big', label: 'Big' },
    ];
    await s.call('library:setConfig', {
      patch: {
        ai: { provider: 'anthropic-api', models, defaultModel: 'm-big', usageCap: { monthlyUsd: 20, confirmBatchAboveUsd: 2 } },
        mcp: { enabled: true },
      },
    });
    let cfg = data(await s.call('library:setConfig', { patch: { ai: { defaultReasoning: 'high' } } }));
    expect(cfg.ai).toMatchObject({ provider: 'anthropic-api', models, defaultModel: 'm-big', defaultReasoning: 'high', usageCap: { monthlyUsd: 20, confirmBatchAboveUsd: 2 } });
    cfg = data(await s.call('library:setConfig', { patch: { mcp: { writeEnabled: true } } }));
    expect(cfg.mcp).toEqual({ enabled: true, writeEnabled: true });
    cfg = data(await s.call('library:setConfig', { patch: { ai: { usageCap: { monthlyUsd: 5 } } } }));
    expect(cfg.ai.usageCap).toEqual({ monthlyUsd: 5, confirmBatchAboveUsd: 2 });
    expect(data(await s.call('library:getConfig', {})).ai.usageCap).toEqual({ monthlyUsd: 5, confirmBatchAboveUsd: 2 });
  });
});

describe('approvals are bound to their purpose (handlers)', () => {
  it('a folder approved as import source is not a library root, and vice versa', async () => {
    const s = setup();
    const dir = path.join(tmp, 'f');
    await mkdir(dir);
    await approve(s, dir, 'legacy-index');
    expect(code(await s.call('library:create', { name: 'x', rootPath: dir }))).toBe('PERMISSION_DENIED');
    expect(code(await s.call('library:listFolders', { rootPath: dir }))).toBe('PERMISSION_DENIED');
    expect(code(await s.call('import:probeLegacy', { rootPath: dir }))).toBe('PERMISSION_DENIED');
    await approve(s, dir, 'export-destination');
    expect(code(await s.call('library:create', { name: 'x', rootPath: dir }))).toBe('PERMISSION_DENIED');
    await approve(s, dir, 'library-root');
    expect(code(await s.call('library:create', { name: 'x', rootPath: dir }))).toBe('ok');
  });

  it('a file approved as taxonomy is not a folder, and a folder is not a taxonomy file', async () => {
    const s = setup();
    const root = path.join(tmp, 'r');
    await mkdir(root);
    await approve(s, root, 'library-root');
    const file = path.join(tmp, 'tax.json');
    await writeFile(file, JSON.stringify({ nodes: [] }));
    expect(code(await s.call('library:create', { name: 'x', rootPath: root, taxonomyFilePath: file }))).toBe('PERMISSION_DENIED');
    await approve(s, file, 'legacy-index'); // right path, wrong purpose
    expect(code(await s.call('library:create', { name: 'x', rootPath: root, taxonomyFilePath: file }))).toBe('PERMISSION_DENIED');
    await approveFile(s, file);
    expect(code(await s.call('library:create', { name: 'x', rootPath: root, taxonomyFilePath: file }))).toBe('ok');
  });

  it('sub-folders, parents, ".." and sibling look-alikes of an approved folder are refused', async () => {
    const s = setup();
    const root = path.join(tmp, 'Lib');
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await mkdir(path.join(tmp, 'Lib2'));
    await approve(s, root, 'library-root');
    for (const p of [path.join(root, 'sub'), tmp, path.join(root, '..'), path.join(root, 'sub', '..', '..'), path.join(tmp, 'Lib2'), path.join(tmp, 'Li')]) {
      expect(code(await s.call('library:create', { name: 'x', rootPath: p })), p).toBe('PERMISSION_DENIED');
      expect(code(await s.call('library:listFolders', { rootPath: p })), p).toBe('PERMISSION_DENIED');
    }
    expect(code(await s.call('library:listFolders', { rootPath: path.join(root, 'sub', '..') }))).toBe('ok');
  });

  it('relative paths and empty strings are refused', async () => {
    const s = setup();
    await mkdir(path.join(tmp, 'r'));
    await approve(s, path.join(tmp, 'r'), 'library-root');
    expect(code(await s.call('library:create', { name: 'x', rootPath: 'r' }))).toBe('PERMISSION_DENIED');
    expect(code(await s.call('library:create', { name: 'x', rootPath: '' }))).toBe('INVALID_REQUEST');
  });

  it.runIf(process.platform === 'win32')('Windows spellings of an approved folder: case, slashes, extended prefix; and UNC/device refused', async () => {
    const s = setup();
    const root = path.join(tmp, 'WinLib');
    await mkdir(root);
    await approve(s, root, 'library-root');
    const variants = [root.toUpperCase(), root.toLowerCase(), root.replaceAll('\\', '/'), `${root}\\`, `\\\\?\\${root}`, `//?/${root.replaceAll('\\', '/')}`];
    const profile = data(await s.call('library:create', { name: 'x', rootPath: variants[4]! }));
    expect(profile.rootPath).toBe(root); // stored without the extended prefix and in the approved spelling
    for (const v of variants) expect(code(await s.call('library:listFolders', { rootPath: v })), v).toBe('ok');
    const drive = root.slice(0, 2);
    for (const v of [`\\\\.\\${drive}${root.slice(2)}`, `\\\\localhost\\${drive[0]}$${root.slice(2)}`, `\\\\?\\UNC\\localhost\\${drive[0]}$${root.slice(2)}`]) {
      expect(code(await s.call('library:listFolders', { rootPath: v })), v).toBe('PERMISSION_DENIED');
    }
  });
});

describe('import start is exclusive per library', () => {
  const report: ImportReport = { documents: 1, taxonomyNodes: 0, skipped: 0, warnings: [], skippedFiles: [], selfNames: [] };

  const withImporter = (s: Setup) => {
    const gates: Array<() => void> = [];
    let runs = 0;
    s.services.createImporter = (): LegacyImporter => ({
      run: () => {
        runs++;
        return new Promise<ImportReport>((resolve) => gates.push(() => resolve(report)));
      },
    });
    return { release: () => gates.splice(0).forEach((g) => g()), runs: () => runs };
  };

  it('a second start while one runs is refused, also when both arrive together', async () => {
    const s = setup();
    const imp = withImporter(s);
    const { root, profile } = await mkLibrary(s);
    void root;
    const [a, b] = await Promise.all([
      s.call('import:startLegacy', { libraryId: profile.id, sourcePath: root }),
      s.call('import:startLegacy', { libraryId: profile.id, sourcePath: root }),
    ]);
    expect([code(a), code(b)].sort()).toEqual(['ALREADY_EXISTS', 'ok']);
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: root }))).toBe('ALREADY_EXISTS');
    await new Promise((r) => setTimeout(r, 20));
    expect(imp.runs()).toBe(1);

    imp.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: root }))).toBe('ok'); // free again
    imp.release();
  });

  it('another library is not blocked, and a failed start does not keep the lock', async () => {
    const s = setup();
    const imp = withImporter(s);
    const a = await mkLibrary(s, 'a');
    const b = await mkLibrary(s, 'b');
    expect(code(await s.call('import:startLegacy', { libraryId: a.profile.id, sourcePath: path.join(tmp, 'not-approved') }))).toBe('PERMISSION_DENIED');
    expect(code(await s.call('import:startLegacy', { libraryId: a.profile.id, sourcePath: a.root }))).toBe('ok');
    expect(code(await s.call('import:startLegacy', { libraryId: b.profile.id, sourcePath: b.root }))).toBe('ok');
    await new Promise((r) => setTimeout(r, 20));
    expect(imp.runs()).toBe(2);
    imp.release();
  });

  it('the lock is released when the importer fails', async () => {
    const s = setup();
    s.services.createImporter = () => ({
      run: () => Promise.reject(new Error('boom')),
    });
    const { root, profile } = await mkLibrary(s);
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: root }))).toBe('ok');
    await new Promise((r) => setTimeout(r, 30));
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: root }))).toBe('ok');
  });

  it('the source must be approved for this purpose: another folder approved as library root, or any export folder, is refused', async () => {
    const s = setup();
    withImporter(s);
    const { profile } = await mkLibrary(s, 'own');
    const other = path.join(tmp, 'other');
    await mkdir(other);
    await approve(s, other, 'library-root');
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: other }))).toBe('PERMISSION_DENIED');
    const exp = path.join(tmp, 'exp');
    await mkdir(exp);
    await approve(s, exp, 'export-destination');
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: exp }))).toBe('PERMISSION_DENIED');
    await approve(s, other, 'legacy-index');
    expect(code(await s.call('import:startLegacy', { libraryId: profile.id, sourcePath: other }))).toBe('ok');
  });
});

describe('library.json updates are serialised', () => {
  it('concurrent setConfig calls on different fields all survive', async () => {
    const s = setup();
    const { profile } = await mkLibrary(s);
    const patches = [
      { scan: { pruneDeletedDays: 11 } },
      { mcp: { enabled: true } },
      { ai: { usageCap: { monthlyUsd: 7 } } },
      { aiEnabledFolders: ['papers'] },
      { ai: { defaultReasoning: 'high' } },
      { language: 'en' },
    ];
    const results = await Promise.all(patches.map((patch) => s.call('library:setConfig', { libraryId: profile.id, patch })));
    expect(results.map(code)).toEqual(patches.map(() => 'ok'));
    const cfg = data(await s.call('library:getConfig', { libraryId: profile.id }));
    expect(cfg.scan.pruneDeletedDays).toBe(11);
    expect(cfg.mcp.enabled).toBe(true);
    expect(cfg.ai.usageCap.monthlyUsd).toBe(7);
    expect(cfg.aiEnabledFolders).toEqual(['papers']);
    expect(cfg.ai.defaultReasoning).toBe('high');
    expect(cfg.language).toBe('en');
  });

  it('a rename racing with setConfig does not lose either', async () => {
    const s = setup();
    const { profile } = await mkLibrary(s);
    await Promise.all([
      s.call('library:rename', { libraryId: profile.id, name: 'Renamed' }),
      s.call('library:setConfig', { libraryId: profile.id, patch: { scan: { pruneDeletedDays: 3 } } }),
      s.services.libraries.updateConfig((c) => ({ ...c, excludedFolders: ['x'] }), profile.id),
    ]);
    const cfg = data(await s.call('library:getConfig', { libraryId: profile.id }));
    expect(cfg).toMatchObject({ name: 'Renamed', scan: { pruneDeletedDays: 3 }, excludedFolders: ['x'] });
  });

  it('a failing update does not block the queue', async () => {
    const s = setup();
    const { profile } = await mkLibrary(s);
    const [bad, good] = await Promise.all([
      s.call('library:setConfig', { libraryId: profile.id, patch: { ai: { defaultModel: 'ghost' } } }),
      s.call('library:setConfig', { libraryId: profile.id, patch: { language: 'en' } }),
    ]);
    expect(code(bad)).toBe('INVALID_REQUEST');
    expect(code(good)).toBe('ok');
  });
});

describe('library:create and the data folder', () => {
  const create = (s: Setup, root: string, extra: object = {}) => s.call('library:create', { name: 'L', rootPath: root, ...extra });

  it('refuses a data folder name that exists and is not a Research Lab data folder, writing nothing', async () => {
    const s = setup();
    const root = path.join(tmp, 'r');
    await mkdir(path.join(root, 'Papers'), { recursive: true });
    await writeFile(path.join(root, 'Papers', 'a.pdf'), 'x');
    await approve(s, root, 'library-root');
    expect(code(await create(s, root, { dataDirName: 'Papers' }))).toBe('ALREADY_EXISTS');
    expect(await readdir(path.join(root, 'Papers'))).toEqual(['a.pdf']);
    expect((await s.services.libraries.list()).profiles).toEqual([]);
  });

  it('refuses an existing folder whose library.json is invalid, and a file with that name', async () => {
    const s = setup();
    const root = path.join(tmp, 'r');
    await mkdir(path.join(root, 'broken'), { recursive: true });
    await writeFile(path.join(root, 'broken', 'library.json'), '{nope');
    await writeFile(path.join(root, 'afile'), 'x');
    await approve(s, root, 'library-root');
    expect(code(await create(s, root, { dataDirName: 'broken' }))).toBe('ALREADY_EXISTS');
    expect(code(await create(s, root, { dataDirName: 'afile' }))).toBe('ALREADY_EXISTS');
  });

  it('refuses the default data folder too when it holds foreign files', async () => {
    const s = setup();
    const root = path.join(tmp, 'r');
    await mkdir(path.join(root, '.lab'), { recursive: true });
    await writeFile(path.join(root, '.lab', 'notes.txt'), 'x');
    await approve(s, root, 'library-root');
    expect(code(await create(s, root))).toBe('ALREADY_EXISTS');
  });

  it('accepts an existing Research Lab data folder (restored from sync) and an empty folder', async () => {
    const s = setup();
    const a = await mkLibrary(s, 'first');
    const synced = path.join(tmp, 'second');
    await mkdir(path.join(synced, '.lab'), { recursive: true });
    await writeFile(path.join(synced, '.lab', 'library.json'), await readFile(path.join(a.root, '.lab', 'library.json')));
    await approve(s, synced, 'library-root');
    expect(code(await create(s, synced))).toBe('ok');

    const empty = path.join(tmp, 'third');
    await mkdir(path.join(empty, 'data'), { recursive: true });
    await approve(s, empty, 'library-root');
    expect(code(await create(s, empty, { dataDirName: 'data' }))).toBe('ok');
  });

  it.each(['CON', 'nul', 'COM1', 'lab.', 'lab ', 'Aux.txt'])('rejects the reserved or trailing-dot data folder name %j', async (name) => {
    const s = setup();
    const root = path.join(tmp, 'r');
    await mkdir(root);
    await approve(s, root, 'library-root');
    expect(code(await create(s, root, { dataDirName: name }))).toBe('INVALID_REQUEST');
  });
});

describe('forgetting a library removes its secrets', () => {
  it('deletes the library-scoped keys and nothing else', async () => {
    const s = setup();
    const a = await mkLibrary(s, 'a');
    const b = await mkLibrary(s, 'b');
    const scopeA = { kind: 'library', libraryId: a.profile.id } as const;
    const scopeB = { kind: 'library', libraryId: b.profile.id } as const;
    await s.call('secrets:set', { scope: scopeA, name: 'anthropic-key', value: 'sk-a-1' });
    await s.call('secrets:set', { scope: scopeA, name: 'other-key', value: 'sk-a-2' });
    await s.call('secrets:set', { scope: scopeB, name: 'anthropic-key', value: 'sk-b-1' });
    await s.call('secrets:set', { scope: { kind: 'app' }, name: 'anthropic-key', value: 'sk-app' });

    expect(code(await s.call('library:forget', { libraryId: a.profile.id }))).toBe('ok');
    const has = async (scope: object, name: string) => data(await s.call('secrets:has', { scope, name })).exists;
    expect(await has(scopeA, 'anthropic-key')).toBe(false);
    expect(await has(scopeA, 'other-key')).toBe(false);
    expect(await has(scopeB, 'anthropic-key')).toBe(true);
    expect(await has({ kind: 'app' }, 'anthropic-key')).toBe(true);
    const raw = JSON.parse(await readFile(path.join(tmp, 'user', 'secrets.json'), 'utf8'));
    expect(Object.keys(raw.entries).sort()).toEqual([`app/anthropic-key`, `library:${b.profile.id}/anthropic-key`]);
  });

  it('an unknown library is NOT_FOUND and touches no secret', async () => {
    const s = setup();
    await s.call('secrets:set', { scope: { kind: 'library', libraryId: 'ghost' }, name: 'k', value: 'v' });
    expect(code(await s.call('library:forget', { libraryId: 'ghost' }))).toBe('NOT_FOUND');
    expect(data(await s.call('secrets:has', { scope: { kind: 'library', libraryId: 'ghost' }, name: 'k' })).exists).toBe(true);
  });

  it('works when secure storage is unavailable (nothing is decrypted)', async () => {
    const s = setup({ cipher: { ...goodCipher, isAvailable: () => false } });
    const a = await mkLibrary(s, 'a');
    expect(code(await s.call('library:forget', { libraryId: a.profile.id }))).toBe('ok');
  });
});

describe('settings.json is never silently replaced', () => {
  const settingsFile = () => path.join(tmp, 'user', 'settings.json');

  it('a file from a newer version is opened read-only, left byte-identical, and reported', async () => {
    await mkdir(path.join(tmp, 'user'), { recursive: true });
    const original = JSON.stringify(
      {
        schemaVersion: 99,
        deviceId: 'device-12345678',
        uiLanguage: 'en',
        libraries: [{ id: 'lib-1', name: 'Kept', rootPath: path.join(tmp, 'kept'), dataDirName: '.lab', createdAt: '2026-01-01T00:00:00Z' }],
        activeLibraryId: 'lib-1',
        somethingNew: { a: 1 },
      },
      null,
      2,
    );
    await writeFile(settingsFile(), original);
    const s = setup();
    const settings = data(await s.call('settings:get'));
    expect(settings).toMatchObject({ deviceId: 'device-12345678', uiLanguage: 'en', activeLibraryId: 'lib-1' });
    expect(settings.libraries).toHaveLength(1);
    expect(data(await s.call('app:notices')).notices).toEqual([{ id: 'settings-read-only', kind: 'settings-read-only', foundVersion: 99, supportedVersion: 1 }]);

    expect(code(await s.call('settings:set', { uiLanguage: 'it' }))).toBe('READ_ONLY');
    expect(code(await s.call('library:setActive', { libraryId: 'lib-1' }))).toBe('READ_ONLY');
    const root = path.join(tmp, 'newroot');
    await mkdir(root);
    await approve(s, root, 'library-root');
    expect(code(await s.call('library:create', { name: 'x', rootPath: root }))).toBe('READ_ONLY');
    expect(await readFile(settingsFile(), 'utf8')).toBe(original);
    expect((await readdir(path.join(tmp, 'user'))).filter((f) => f.includes('invalid'))).toEqual([]);
  });

  it('a corrupt file is kept as a copy, defaults are used, and the notice says why', async () => {
    await mkdir(path.join(tmp, 'user'), { recursive: true });
    const original = JSON.stringify({ schemaVersion: 1, uiLanguage: 'klingon', libraries: 'oops' });
    await writeFile(settingsFile(), original);
    const s = setup();
    expect(data(await s.call('settings:get')).uiLanguage).toBe('it');
    const backups = (await readdir(path.join(tmp, 'user'))).filter((f) => f.startsWith('settings.json.invalid-'));
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(tmp, 'user', backups[0]!), 'utf8')).toBe(original);

    const notices = data(await s.call('app:notices')).notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'settings-reset', reason: 'invalid-schema', backupName: backups[0] });
    expect(notices[0].fields).toEqual(expect.arrayContaining(['uiLanguage', 'libraries']));
    expect(JSON.stringify(notices)).not.toContain('klingon'); // field names only, never values

    await s.call('app:dismissNotice', { id: notices[0].id });
    expect(data(await s.call('app:notices')).notices).toEqual([]);
    expect(code(await s.call('settings:set', { uiLanguage: 'en' }))).toBe('ok'); // writable again
  });

  it('broken JSON gets its own reason', async () => {
    await mkdir(path.join(tmp, 'user'), { recursive: true });
    await writeFile(settingsFile(), '{broken');
    const s = setup();
    await s.call('settings:get');
    expect(data(await s.call('app:notices')).notices[0]).toMatchObject({ kind: 'settings-reset', reason: 'invalid-json' });
  });

  it('a healthy or missing file raises no notice', async () => {
    const s = setup();
    await s.call('settings:get');
    expect(data(await s.call('app:notices')).notices).toEqual([]);
  });
});

describe('secrets:set never leaks the value', () => {
  const SECRET = 'sk-test-SUPER-SECRET-VALUE-123';
  const everything = (s: Setup, r: IpcEnvelope) => JSON.stringify([r, s.log.entries]);

  it.each([
    ['value is a number', { scope: { kind: 'app' }, name: 'k', value: 12345 }],
    ['value is empty', { scope: { kind: 'app' }, name: 'k', value: '' }],
    ['value is too long', { scope: { kind: 'app' }, name: 'k', value: `${SECRET}${'x'.repeat(9000)}` }],
    ['name has upper case', { scope: { kind: 'app' }, name: `K-${SECRET}`, value: SECRET }],
    ['name has a path', { scope: { kind: 'app' }, name: '../k', value: SECRET }],
    ['scope is missing', { name: 'k', value: SECRET }],
    ['scope kind is unknown', { scope: { kind: 'machine' }, name: 'k', value: SECRET }],
    ['library scope without id', { scope: { kind: 'library' }, name: 'k', value: SECRET }],
    ['library id is not an id', { scope: { kind: 'library', libraryId: '../x' }, name: 'k', value: SECRET }],
    ['payload is a string', SECRET],
    ['payload is null', null],
    ['payload is an array', [SECRET]],
  ])('rejects a malformed request (%s) without echoing the value', async (_label, payload) => {
    const s = setup();
    const r = await s.call('secrets:set', payload);
    expect(code(r)).toBe('INVALID_REQUEST');
    expect(everything(s, r)).not.toContain(SECRET);
    await expect(readFile(path.join(tmp, 'user', 'secrets.json'), 'utf8')).rejects.toThrow(); // nothing was stored
  });

  it('a cipher that fails (and puts the value in its error) leaks nothing to the reply, the log or the disk', async () => {
    const leaky: Cipher = {
      isAvailable: () => true,
      encrypt: (plain) => {
        throw new Error(`cannot encrypt ${plain}`);
      },
      decrypt: (d) => {
        throw new Error(`cannot decrypt ${d.toString('base64')} ${SECRET}`);
      },
    };
    const s = setup({ cipher: leaky });
    const r = await s.call('secrets:set', { scope: { kind: 'app' }, name: 'k', value: SECRET });
    expect(code(r)).toBe('SECRET_UNAVAILABLE');
    expect(everything(s, r)).not.toContain(SECRET);
    await expect(readFile(path.join(tmp, 'user', 'secrets.json'), 'utf8')).rejects.toThrow();

    // And decryption (main-process only) fails the same way.
    const ok = setup();
    await ok.call('secrets:set', { scope: { kind: 'app' }, name: 'k', value: SECRET });
    const failing = new FileSecretStore(path.join(tmp, 'user'), leaky);
    const err = await failing.get({ kind: 'app' }, 'k').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SECRET_UNAVAILABLE' });
    expect(JSON.stringify([String(err), (err as Error).message, (err as Error).cause])).not.toContain(SECRET);
  });

  it('an unavailable cipher is reported plainly and the value is not logged', async () => {
    const s = setup({ cipher: { ...goodCipher, isAvailable: () => false } });
    const r = await s.call('secrets:set', { scope: { kind: 'app' }, name: 'k', value: SECRET });
    expect(code(r)).toBe('SECRET_UNAVAILABLE');
    expect(everything(s, r)).not.toContain(SECRET);
  });

  it('a successful set never logs or returns the value either', async () => {
    const s = setup();
    const r = await s.call('secrets:set', { scope: { kind: 'app' }, name: 'k', value: SECRET });
    expect(code(r)).toBe('ok');
    expect(everything(s, r)).not.toContain(SECRET);
    expect(await readFile(path.join(tmp, 'user', 'secrets.json'), 'utf8')).not.toContain(SECRET);
  });
});

describe('size limits on chosen files', () => {
  it('library:create refuses a taxonomy file over the cap before writing anything', async () => {
    const s = setup();
    const root = path.join(tmp, 'r');
    await mkdir(root);
    await approve(s, root, 'library-root');
    const file = path.join(tmp, 'huge.json');
    const pad = ' '.repeat(16 * 1024 * 1024 + 10);
    await writeFile(file, `{"nodes":[]}${pad}`);
    await approveFile(s, file);
    expect(code(await s.call('library:create', { name: 'x', rootPath: root, taxonomyFilePath: file }))).toBe('INVALID_REQUEST');
    await expect(readdir(path.join(root, '.lab'))).rejects.toThrow();
    expect((await s.services.libraries.list()).profiles).toEqual([]);
  });

  it('probeLegacyIndex streams files.jsonl: counts non-blank lines (LF, CRLF, no final newline) in bounded memory', async () => {
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, '.phd_index'), { recursive: true });
    const file = path.join(root, '.phd_index', 'files.jsonl');
    await writeFile(file, '{"p":"a"}\r\n\r\n   \n{"p":"b"}\n\t\n{"p":"c"}');
    expect(await probeLegacyIndex(root)).toEqual({ found: true, documents: 3, taxonomyNodes: 0 });
    // A 40 MB single line is read in chunks and counted once, without a line buffer.
    await writeFile(file, `${'x'.repeat(40 * 1024 * 1024)}\n{"p":"b"}\n`);
    expect(await probeLegacyIndex(root)).toMatchObject({ found: true, documents: 2 });
  });

  it('probeLegacyIndex refuses an index over the cap and ignores a taxonomy over its cap', async () => {
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, '.phd_index'), { recursive: true });
    await writeFile(path.join(root, '.phd_index', 'files.jsonl'), `${'{"p":"a"}\n'.repeat(1000)}`);
    await expect(probeLegacyIndex(root, { maxIndexBytes: 1000 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await probeLegacyIndex(root, { maxIndexBytes: 1_000_000 })).toMatchObject({ documents: 1000 });

    await writeFile(path.join(root, '.phd_index', 'taxonomy.json'), JSON.stringify({ macro: { m1: {}, m2: {} } }));
    expect((await probeLegacyIndex(root)).taxonomyNodes).toBe(2);
    expect((await probeLegacyIndex(root, { maxTaxonomyBytes: 5 })).taxonomyNodes).toBe(0);
  });

  it('import:probeLegacy reports the cap as an error through the handler', async () => {
    const s = setup();
    const root = path.join(tmp, 'lib');
    await mkdir(path.join(root, '.phd_index'), { recursive: true });
    await writeFile(path.join(root, '.phd_index', 'files.jsonl'), '{"p":"a"}\n');
    await approve(s, root, 'library-root');
    expect(data(await s.call('import:probeLegacy', { rootPath: root })).documents).toBe(1);
  });
});
