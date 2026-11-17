import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, BACKUP_LIMITS, channels, createDispatcher, createMemoryLogger, type IpcEnvelope } from '@rl/core';
import { ApprovedPaths } from '../approved-paths.js';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { LibraryService } from '../library-service.js';
import { SettingsStore } from '../settings-store.js';
import { MANIFEST_NAME } from './archive.js';
import { autoBackupOnStart, create, whenBackupDone } from './service.js';
import { ZipReader, ZipWriter } from './zip.js';

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

let base: string;
let userData: string;
let local: string;
let rootA: string;
let dest: string;
let approved: ApprovedPaths;
let settings: SettingsStore;
let libraries: LibraryService;
let services: MainServices;
let libId: string;
let picked: string | null;
let running: boolean;
let events: Array<{ channel: string; payload: any }>;
let call: (channel: string, payload?: unknown) => Promise<IpcEnvelope>;

const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const exists = (p: string) => stat(p).then(() => true, () => false);

async function walk(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else out.push(r);
  }
  return out.sort();
}

/** Hashes of every file of a folder, by relative path. */
async function hashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of await walk(dir)) out[f] = sha(await readFile(path.join(dir, f)));
  return out;
}

const dataDirOf = (root: string) => path.join(root, '.lab');

async function seed(): Promise<void> {
  const dd = dataDirOf(rootA);
  await writeFile(path.join(dd, 'documents', 'aaaaaaaaaaaaaaaa.json'), JSON.stringify({ id: 'aaaaaaaaaaaaaaaa', title: 'Doc one' }));
  await writeFile(path.join(dd, 'documents', 'bbbbbbbbbbbbbbbb.json'), JSON.stringify({ id: 'bbbbbbbbbbbbbbbb', title: 'Doc two' }));
  await mkdir(path.join(dd, 'notes'), { recursive: true });
  await writeFile(path.join(dd, 'notes', 'aaaaaaaaaaaaaaaa.md'), 'My note about the first paper.\n'.repeat(50));
  await writeFile(path.join(dd, 'taxonomy.json'), JSON.stringify({ nodes: [] }));
  await writeFile(path.join(dd, 'log', 'changes-2026-01.device1.jsonl'), '{"a":1}\n');
  // An original document of the library root: never part of a backup, never touched by a restore.
  await writeFile(path.join(rootA, 'paper.pdf'), 'original bytes');
  await mkdir(path.join(local, 'chat', libId), { recursive: true });
  await writeFile(path.join(local, 'chat', libId, 'conv1.json'), JSON.stringify({ id: 'conv1', turns: ['hello'] }));
  // Rebuildable data: never saved.
  await mkdir(path.join(local, 'thumbs', libId), { recursive: true });
  await writeFile(path.join(local, 'thumbs', libId, 'x.webp'), 'thumb');
}

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'rl-bk-'));
  userData = path.join(base, 'user');
  local = path.join(base, 'local');
  rootA = path.join(base, 'libA');
  dest = path.join(base, 'dest');
  for (const d of [userData, local, rootA, dest]) await mkdir(d, { recursive: true });
  const log = createMemoryLogger();
  approved = new ApprovedPaths();
  settings = SettingsStore.forDir(userData, log);
  libraries = new LibraryService(settings, approved);
  events = [];
  picked = dest;
  running = false;
  services = {
    log,
    localDataDir: local,
    emit: (channel: string, payload: unknown) => events.push({ channel, payload }),
    settings,
    libraries,
    approved,
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({ state: running ? 'running' : 'idle' }), require: async () => { throw new AppError('LIBRARY_NOT_ACTIVE', 'none'); } },
    secrets: { has: async () => false, get: async () => null, set: async () => {}, delete: async () => {}, deleteLibrary: async () => {} },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    pickFolder: async () => picked,
    appInfo: () => ({ name: 'Research Lab', version: '1.0.0', platform: 'win32', electron: '0' }),
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  call = (c, p = {}) => dispatch(c, p);
  approved.add(rootA, 'library-root');
  libId = (await libraries.create({ name: 'Source library', rootPath: rootA, language: 'en' })).id;
  await seed();
  await settings.update((s) => {
    s.backup.destination = dest;
  });
});
afterEach(async () => {
  await whenBackupDone(services).catch(() => {});
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function runCreate(payload: Record<string, unknown> = {}) {
  const { jobId } = ok(await call('backup:create', payload));
  await whenBackupDone(services);
  return ok(await call('backup:status', { jobId })) as { state: string; result: any; error: any; phase: string };
}

const backupsIn = async () => (await readdir(dest)).filter((n) => n.endsWith(BACKUP_LIMITS.extension));

async function newRoot(name: string): Promise<string> {
  const r = path.join(base, name);
  await mkdir(r, { recursive: true });
  approved.add(r, 'library-root');
  return r;
}

describe('backup round trip', () => {
  it('creates a verified archive, lists it, and restores it as a new library with the same data', async () => {
    const made = await runCreate();
    expect(made.state).toBe('done');
    expect(made.result.problemCount).toBe(0);
    const names = await readdir(dest);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\.rlbackup$/);
    expect(names.some((n) => n.endsWith('.part'))).toBe(false);

    const listed = ok(await call('backup:list')).items as any[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ libraryName: 'Source library', language: 'en', documents: 2, includesLocal: true, includesSettings: true, origin: 'manual', newerFormat: false });
    const file = listed[0].file as string;

    // The manifest is the last entry, lists no document of the library root and nothing rebuildable or secret.
    const zip = await ZipReader.open(file, BACKUP_LIMITS.entries);
    expect(zip.entries[zip.entries.length - 1]!.name).toBe(MANIFEST_NAME);
    const all = zip.entries.map((e) => e.name);
    expect(all).toContain('library/library.json');
    expect(all).toContain('library/documents/aaaaaaaaaaaaaaaa.json');
    expect(all.some((n) => n.endsWith('.pdf') || n.includes('thumbs') || n.includes('secrets'))).toBe(false);
    const settingsJson = JSON.parse((await zip.read(zip.entries.find((e) => e.name === 'settings.json')!, 1 << 20)).toString('utf8'));
    expect(Object.keys(settingsJson).sort()).toEqual(['appearance', 'formatVersion', 'guide', 'shortcuts', 'uiLanguage', 'user']);

    const v = ok(await call('backup:verify', { file }));
    await whenBackupDone(services);
    const vres = ok(await call('backup:status', { jobId: v.jobId })).result; expect(vres.problems).toEqual([]);

    const rootB = await newRoot('libB');
    await writeFile(path.join(rootB, 'mine.pdf'), 'someone else file');
    const r = ok(await call('backup:restore', { file, rootPath: rootB, name: 'Restored copy', restoreLocal: true, restoreSettings: true }));
    await whenBackupDone(services);
    const st = ok(await call('backup:status', { jobId: r.jobId })) as { state: string; result: any; error: any };
    expect(st.error).toBeNull();
    expect(st.state).toBe('done');
    const newId = st.result.restoredLibraryId as string;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(libId);
    expect(st.result.settingsRestored).toBe(true);
    expect(Array.isArray(st.result.secretsToEnter)).toBe(true);

    const profile = (await settings.get()).libraries.find((l) => l.id === newId)!;
    expect(profile.name).toBe('Restored copy');
    expect(profile.rootPath).toBe(rootB);
    const a = await hashes(dataDirOf(rootA));
    const b = await hashes(dataDirOf(rootB));
    const { 'library.json': cfgA, ...restA } = a;
    const { 'library.json': cfgB, ...restB } = b;
    expect(restB).toEqual(restA);
    expect(cfgA).toBeTruthy();
    expect(JSON.parse(await readFile(path.join(dataDirOf(rootB), 'library.json'), 'utf8')).name).toBe('Restored copy');
    expect(JSON.parse(await readFile(path.join(local, 'chat', newId, 'conv1.json'), 'utf8')).turns).toEqual(['hello']);
    // Documents of the root: the original is untouched, the new root only has what was there.
    expect(await readFile(path.join(rootA, 'paper.pdf'), 'utf8')).toBe('original bytes');
    expect((await readdir(rootB)).sort()).toEqual(['.lab', 'mine.pdf']);
    // No temporary folder left behind.
    expect((await readdir(local)).filter((n) => n.startsWith('restore-'))).toEqual([]);
  });

  it('never overwrites an existing data folder and refuses a root that already has a library', async () => {
    await runCreate();
    const file = (ok(await call('backup:list')).items as any[])[0].file as string;
    const rootB = await newRoot('libB');
    await mkdir(path.join(dataDirOf(rootB)), { recursive: true });
    await writeFile(path.join(dataDirOf(rootB), 'precious.txt'), 'keep me');
    expect(fail(await call('backup:restore', { file, rootPath: rootB })).details).toMatchObject({ reason: 'not-empty' });
    expect(await readFile(path.join(dataDirOf(rootB), 'precious.txt'), 'utf8')).toBe('keep me');
    expect(fail(await call('backup:restore', { file, rootPath: rootA })).details).toMatchObject({ reason: 'already-registered' });
  });

  it('refuses a file the user did not pick', async () => {
    await runCreate();
    const file = (ok(await call('backup:list')).items as any[])[0].file as string;
    const other = path.join(base, 'elsewhere.rlbackup');
    await writeFile(other, 'x');
    expect(fail(await call('backup:inspect', { file: other })).details).toMatchObject({ reason: 'file-not-approved' });
    expect(ok(await call('backup:inspect', { file })).libraryName).toBe('Source library');
  });
});

describe('integrity', () => {
  it('a changed byte is found by verify and stops the restore without leaving anything', async () => {
    const dd = dataDirOf(rootA);
    await writeFile(path.join(dd, 'notes', 'big.md'), randomBytes(4000).toString('base64').repeat(20));
    await runCreate();
    const file = (ok(await call('backup:list')).items as any[])[0].file as string;
    const zip = await ZipReader.open(file, BACKUP_LIMITS.entries);
    const target = zip.entries.find((e) => e.name === 'library/notes/big.md')!;
    const bytes = await readFile(file);
    const at = target.offset + 30 + Buffer.byteLength(target.name) + Math.floor(target.csize / 2);
    bytes[at] = bytes[at]! ^ 0xff;
    await writeFile(file, bytes);

    const v = ok(await call('backup:verify', { file }));
    await whenBackupDone(services);
    const vs = ok(await call('backup:status', { jobId: v.jobId })) as { result: any };
    expect(vs.result.problemCount).toBeGreaterThanOrEqual(1);
    expect(vs.result.problems.some((p: any) => p.path === 'library/notes/big.md')).toBe(true);

    const rootB = await newRoot('libB');
    const before = (await settings.get()).libraries.length;
    const r = ok(await call('backup:restore', { file, rootPath: rootB }));
    await whenBackupDone(services);
    const st = ok(await call('backup:status', { jobId: r.jobId })) as { state: string; error: any; result: any };
    expect(st.state).toBe('failed');
    expect(st.error).toMatchObject({ code: 'CONFLICT', reason: 'integrity' });
    expect(st.error.message).toMatch(/^integrity:/);
    expect(st.result.problemCount).toBeGreaterThanOrEqual(1);
    expect(await readdir(rootB)).toEqual([]);
    expect((await settings.get()).libraries).toHaveLength(before);
    expect(await exists(path.join(local, 'chat'))).toBe(true);
    expect((await readdir(path.join(local, 'chat'))).sort()).toEqual([libId]);
  });

  it('entries that leave the folder are rejected and nothing is written outside', async () => {
    const evil = path.join(dest, 'evil.rlbackup');
    const w = await ZipWriter.create(evil);
    const names = ['library/../../escaped.txt', '/abs/escaped.txt', 'library\\..\\escaped.txt', 'C:/escaped.txt', 'library/ok.txt'];
    const entries = [];
    for (const n of names) {
      const r = await w.addBuffer(n, Buffer.from('payload'));
      entries.push({ path: n, size: r.size, sha256: r.sha256 });
    }
    const manifest = { format: 'rl-backup', formatVersion: 1, createdAt: new Date().toISOString(), appVersion: '1', sourceLibraryId: 'lib-evil', libraryName: 'Evil', language: 'en', dataDirName: '.lab', documents: 0, includesLocal: false, includesSettings: false, origin: 'manual', entries };
    await w.addBuffer(MANIFEST_NAME, Buffer.from(JSON.stringify(manifest)));
    await w.finish();
    approved.add(evil, 'backup-file');

    const v = ok(await call('backup:verify', { file: evil }));
    await whenBackupDone(services);
    const vs = ok(await call('backup:status', { jobId: v.jobId })) as { result: any };
    expect(vs.result.problemCount).toBe(4);
    expect(vs.result.problems.every((p: any) => p.reason === 'unexpected')).toBe(true);

    const rootB = await newRoot('libB');
    const r = ok(await call('backup:restore', { file: evil, rootPath: rootB }));
    await whenBackupDone(services);
    expect(ok(await call('backup:status', { jobId: r.jobId })).state).toBe('failed');
    expect(await readdir(rootB)).toEqual([]);
    for (const p of [path.join(base, 'escaped.txt'), path.join(rootB, 'escaped.txt'), path.join(dest, 'escaped.txt')]) expect(await exists(p)).toBe(false);
  });

  it('a backup of a newer format is shown but refused', async () => {
    const f = path.join(dest, 'future.rlbackup');
    const w = await ZipWriter.create(f);
    await w.addBuffer(MANIFEST_NAME, Buffer.from(JSON.stringify({ format: 'rl-backup', formatVersion: 2, createdAt: '2030-01-01T00:00:00.000Z', libraryName: 'Future', language: 'it' })));
    await w.finish();
    const item = (ok(await call('backup:list')).items as any[]).find((i) => i.name === 'future.rlbackup');
    expect(item).toMatchObject({ newerFormat: true, libraryName: 'Future' });
    expect(fail(await call('backup:verify', { file: f })).details).toMatchObject({ reason: 'newer-format' });
    const rootB = await newRoot('libB');
    expect(fail(await call('backup:restore', { file: f, rootPath: rootB })).details).toMatchObject({ reason: 'newer-format' });
  });
});

describe('cancel, destination and schedule', () => {
  it('a cancelled backup leaves no file at all', async () => {
    const dd = dataDirOf(rootA);
    for (let i = 0; i < 300; i++) await writeFile(path.join(dd, 'notes', `n${i}.md`), randomBytes(2000).toString('hex'));
    await writeFile(path.join(dd, 'notes', 'zzz-big.bin'), randomBytes(16 * 1024 * 1024));
    const { jobId } = ok(await call('backup:create', {}));
    expect(ok(await call('backup:cancel', { jobId })).cancelled).toBe(true);
    await whenBackupDone(services);
    expect(ok(await call('backup:status', { jobId })).state).toBe('cancelled');
    expect(await readdir(dest)).toEqual([]);
  });

  it('refuses a destination inside a library, from the dialog and from the stored setting', async () => {
    picked = path.join(rootA, 'subfolder');
    await mkdir(picked, { recursive: true });
    expect(fail(await call('backup:chooseDestination')).details).toMatchObject({ reason: 'inside-library' });
    expect((await settings.get()).backup.destination).toBe(dest);
    await settings.update((s) => {
      s.backup.destination = picked;
    });
    expect(fail(await call('backup:create', {})).details).toMatchObject({ reason: 'inside-library' });
    expect(await readdir(picked as string)).toEqual([]);
    picked = dest;
    const good = ok(await call('backup:chooseDestination'));
    expect(good.destination).toBe(dest);
  });

  it('needs a destination, and keeps only the newest automatic backups (manual ones stay)', async () => {
    await settings.update((s) => {
      s.backup.destination = null;
    });
    expect(fail(await call('backup:create', {})).details).toMatchObject({ reason: 'no-destination' });
    await settings.update((s) => {
      s.backup.destination = dest;
      s.backup.keep = 2;
    });
    await runCreate();
    for (let i = 0; i < 4; i++) {
      const { jobId } = await create(services, { includeLocal: false, origin: 'auto' });
      await whenBackupDone(services);
      expect(ok(await call('backup:status', { jobId })).state).toBe('done');
    }
    const items = ok(await call('backup:list')).items as any[];
    expect(items.filter((i) => i.origin === 'auto')).toHaveLength(2);
    expect(items.filter((i) => i.origin === 'manual')).toHaveLength(1);
  });

  it('the start-up check makes a backup only when the last one is older than the cadence, and records a failure', async () => {
    await settings.update((s) => {
      s.backup.auto = 'daily';
    });
    await autoBackupOnStart(services);
    expect(await backupsIn()).toHaveLength(1);
    await autoBackupOnStart(services);
    expect(await backupsIn()).toHaveLength(1);
    await autoBackupOnStart(services, () => Date.now() + 2 * 24 * 3600_000);
    expect(await backupsIn()).toHaveLength(2);
    expect(ok(await call('backup:settings')).lastBackupAt).toBeTruthy();
    await settings.update((s) => {
      s.backup.destination = null;
    });
    await autoBackupOnStart(services);
    expect(ok(await call('backup:settings')).lastAutoError).toBe('no-destination');
    expect(events.some((e) => e.channel === 'app:notice' && e.payload.kind === 'backup-failed')).toBe(true);
  });

  it('removes only a backup listed in the destination folder', async () => {
    await runCreate();
    const file = (ok(await call('backup:list')).items as any[])[0].file as string;
    const stray = path.join(base, 'stray.rlbackup');
    await writeFile(stray, 'x');
    approved.add(stray, 'backup-file');
    expect(fail(await call('backup:remove', { file: stray })).details).toMatchObject({ reason: 'file-not-listed' });
    expect(await exists(stray)).toBe(true);
    ok(await call('backup:remove', { file }));
    expect(await backupsIn()).toEqual([]);
  });
});

describe('settings shortcuts', () => {
  it('stores canonical accelerators and refuses two commands on one key', async () => {
    const saved = ok(await call('settings:set', { shortcuts: [{ id: 'palette.open', accelerator: 'ctrl+shift+p' }] })) as any;
    expect(saved.shortcuts).toEqual([{ id: 'palette.open', accelerator: 'Ctrl+Shift+P' }]);
    const err = fail(await call('settings:set', { shortcuts: [{ id: 'palette.open', accelerator: 'Ctrl+J' }] }));
    expect(err.details).toMatchObject({ reason: 'shortcut-conflict' });
    expect(fail(await call('settings:set', { shortcuts: [{ id: 'palette.open', accelerator: 'P' }] })).code).toBe('INVALID_REQUEST');
    expect((await settings.get()).shortcuts).toEqual([{ id: 'palette.open', accelerator: 'Ctrl+Shift+P' }]);
    // Backup settings are not part of the patch: whatever is sent for them is ignored or refused, never stored.
    await call('settings:set', { backup: { destination: 'C:/elsewhere' } });
    expect((await settings.get()).backup.destination).toBe(dest);
  });
});

describe('maintenance', () => {
  it('cleans only rebuildable data and refuses while work is running', async () => {
    const files: Record<string, string> = {
      'cache/text/a.json': 'c',
      [`thumbs/${libId}/x.webp`]: 't',
      [`graph/${libId}/model.json`]: 'm',
      [`graph/${libId}/meta.json`]: 'm',
      [`graph/${libId}/labels.json`]: 'l',
      'logs/main.log': 'log',
      [`index/${libId}.sqlite`]: 'index',
      [`chat/${libId}/conv1.json`]: 'chat',
      [`backups/${libId}/copy/documents.json`]: 'safety',
    };
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(local, rel)), { recursive: true });
      await writeFile(path.join(local, rel), text);
    }
    const dd = dataDirOf(rootA);
    const dataBefore = await hashes(dd);
    running = true;
    expect(fail(await call('maintenance:clean', { targets: ['cache'] })).details).toMatchObject({ reason: 'busy' });
    expect(await exists(path.join(local, 'cache/text/a.json'))).toBe(true);
    running = false;

    const rep = ok(await call('maintenance:report', {})) as any;
    expect(rep.documents).toBe(2);
    expect(rep.local.index).toBe(5);
    expect(rep.local.backups).toBe(6);
    expect(rep.local.chats).toBeGreaterThan(0);

    const r = ok(await call('maintenance:clean', { targets: ['cache', 'thumbs', 'graph', 'logs'] })) as any;
    expect(r.freedBytes).toBe(1 + 1 + 2 + 3);
    for (const gone of ['cache/text/a.json', `thumbs/${libId}/x.webp`, `graph/${libId}/model.json`, `graph/${libId}/meta.json`, 'logs/main.log']) expect(await exists(path.join(local, gone))).toBe(false);
    for (const kept of [`graph/${libId}/labels.json`, `index/${libId}.sqlite`, `chat/${libId}/conv1.json`, `backups/${libId}/copy/documents.json`]) expect(await exists(path.join(local, kept))).toBe(true);
    expect(await hashes(dd)).toEqual(dataBefore);
    expect(await exists(path.join(userData, 'settings.json'))).toBe(true);
    expect(await readFile(path.join(rootA, 'paper.pdf'), 'utf8')).toBe('original bytes');
  });

  it('the diagnostics text holds no path, name or title', async () => {
    const copied: string[] = [];
    (services as any).clipboard = { writeText: (t: string) => copied.push(t) };
    const { text } = ok(await call('maintenance:copyDiagnostics')) as { text: string };
    expect(copied).toEqual([text]);
    expect(text).toContain('Active library: 2 documents');
    for (const secret of [base, rootA, 'Source library', 'Doc one', 'paper.pdf']) expect(text).not.toContain(secret);
  });
});
