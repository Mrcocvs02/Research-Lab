import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, BACKUP_LIMITS, channels, createDispatcher, createMemoryLogger, type IpcEnvelope } from '@rl/core';
import { ApprovedPaths } from '../approved-paths.js';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { LibraryService } from '../library-service.js';
import { SettingsStore } from '../settings-store.js';
import { MANIFEST_NAME, writeArchive } from './archive.js';
import { cancelAllBackups, create, whenBackupDone } from './service.js';
import { checkLayout, MAX_TOTAL_USIZE, ZipReader, ZipWriter, type ZipEntry } from './zip.js';

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const entry = (over: Partial<ZipEntry>): ZipEntry => ({ name: 'library/x', method: 8, crc: 0, csize: 10, usize: 10, offset: 0, nameLen: 9, ...over });
const manifestOf = (entries: Array<{ path: string; size: number; sha256: string }>) => ({
  format: 'rl-backup',
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  appVersion: '1',
  sourceLibraryId: 'lib-x',
  libraryName: 'Crafted',
  language: 'en',
  dataDirName: '.lab',
  documents: 0,
  includesLocal: false,
  includesSettings: false,
  origin: 'manual',
  entries,
});

let base: string;
let local: string;
let rootA: string;
let dest: string;
let approved: ApprovedPaths;
let settings: SettingsStore;
let services: MainServices;
let libId: string;
let call: (channel: string, payload?: unknown) => Promise<IpcEnvelope>;

const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const exists = (p: string) => stat(p).then(() => true, () => false);
const dataDirOf = (root: string) => path.join(root, '.lab');

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'rl-bkh-'));
  const userData = path.join(base, 'user');
  local = path.join(base, 'local');
  rootA = path.join(base, 'libA');
  dest = path.join(base, 'dest');
  for (const d of [userData, local, rootA, dest]) await mkdir(d, { recursive: true });
  const log = createMemoryLogger();
  approved = new ApprovedPaths();
  settings = SettingsStore.forDir(userData, log);
  const libraries = new LibraryService(settings, approved);
  services = {
    log,
    localDataDir: local,
    emit: () => {},
    settings,
    libraries,
    approved,
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({ state: 'idle' }), require: async () => { throw new AppError('LIBRARY_NOT_ACTIVE', 'none'); } },
    secrets: { has: async () => false, get: async () => null, set: async () => {}, delete: async () => {}, deleteLibrary: async () => {} },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    pickFolder: async () => dest,
    appInfo: () => ({ name: 'Research Lab', version: '1.0.0', platform: 'win32', electron: '0' }),
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  call = (c, p = {}) => dispatch(c, p);
  approved.add(rootA, 'library-root');
  libId = (await libraries.create({ name: 'Source library', rootPath: rootA, language: 'en' })).id;
  await writeFile(path.join(dataDirOf(rootA), 'documents', 'aaaaaaaaaaaaaaaa.json'), JSON.stringify({ id: 'aaaaaaaaaaaaaaaa', title: 'Doc one' }));
  await mkdir(path.join(local, 'chat', libId), { recursive: true });
  await writeFile(path.join(local, 'chat', libId, 'conv1.json'), JSON.stringify({ id: 'conv1' }));
  await settings.update((s) => {
    s.backup.destination = dest;
  });
});
afterEach(async () => {
  await whenBackupDone(services).catch(() => {});
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const finished = async (jobId: string) => {
  await whenBackupDone(services);
  return ok(await call('backup:status', { jobId })) as { state: string; result: any; error: any };
};
async function runCreate(payload: Record<string, unknown> = {}) {
  return finished(ok(await call('backup:create', payload)).jobId);
}
const firstBackup = async () => (ok(await call('backup:list')).items as any[])[0].file as string;
async function newRoot(name: string): Promise<string> {
  const r = path.join(base, name);
  await mkdir(r, { recursive: true });
  approved.add(r, 'library-root');
  return r;
}
async function craft(name: string, files: Record<string, string>): Promise<string> {
  const file = path.join(dest, name);
  const w = await ZipWriter.create(file);
  const entries = [];
  for (const [n, text] of Object.entries(files)) {
    const r = await w.addBuffer(n, Buffer.from(text));
    entries.push({ path: n, size: r.size, sha256: r.sha256 });
  }
  await w.addBuffer(MANIFEST_NAME, Buffer.from(JSON.stringify(manifestOf(entries))));
  await w.finish();
  approved.add(file, 'backup-file');
  return file;
}

describe('zip reader limits', () => {
  it('rejects overlapping entries (two central records pointing at the same local record)', async () => {
    const file = path.join(base, 'overlap.zip');
    const w = await ZipWriter.create(file);
    await w.addBuffer('library/a.txt', Buffer.from('aaaa'.repeat(50)));
    await w.addBuffer('library/b.txt', Buffer.from('bbbb'.repeat(50)));
    await w.finish();
    const bytes = await readFile(file);
    const first = (await ZipReader.open(file, 10)).entries[0]!;
    // The second central record: patch its offset to the first entry's.
    const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const at = bytes.indexOf(sig, bytes.indexOf(sig) + 4);
    bytes.writeUInt32LE(first.offset, at + 42);
    await writeFile(file, bytes);
    await expect(ZipReader.open(file, 10)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'integrity' } });
  });

  it('checkLayout: overlap, running into the directory, ratio and total caps', () => {
    expect(() => checkLayout([entry({ offset: 0 }), entry({ offset: 100 })], 1000)).not.toThrow();
    expect(() => checkLayout([entry({ offset: 0, csize: 100 }), entry({ offset: 50 })], 1000)).toThrow(/overlap/i);
    expect(() => checkLayout([entry({ offset: 0, csize: 2000 })], 1000)).toThrow(/central directory/);
    expect(() => checkLayout([entry({ usize: 8 * 1024 * 1024, csize: 1000 })], 100000)).toThrow(/ratio/);
    expect(() => checkLayout([entry({ usize: 8 * 1024 * 1024, csize: 0 })], 100000)).toThrow(/ratio/);
    expect(() => checkLayout([entry({ usize: 8 * 1024 * 1024, csize: 100 * 1024 })], 200000)).not.toThrow();
    const big = MAX_TOTAL_USIZE / 2 + 1;
    expect(() => checkLayout([entry({ usize: big, csize: big, offset: 0 }), entry({ usize: big, csize: big, offset: big + 100 })], big * 3)).toThrow(/too much/);
  });

  it('a real 8 MiB run of zeros is refused by its ratio', async () => {
    const file = path.join(base, 'zeros.zip');
    const w = await ZipWriter.create(file);
    await w.addBuffer('library/zeros.bin', Buffer.alloc(8 * 1024 * 1024));
    await w.finish();
    await expect(ZipReader.open(file, 10)).rejects.toMatchObject({ details: { reason: 'integrity' } });
  });

  it('a central directory larger than its entries can be is refused before it is read', async () => {
    const file = path.join(base, 'cd.zip');
    const buf = Buffer.alloc(60_000 + 22);
    buf.writeUInt32LE(0x06054b50, 60_000);
    buf.writeUInt16LE(1, 60_000 + 8);
    buf.writeUInt16LE(1, 60_000 + 10);
    buf.writeUInt32LE(60_000, 60_000 + 12);
    await writeFile(file, buf);
    await expect(ZipReader.open(file, 10)).rejects.toMatchObject({ details: { reason: 'not-a-backup', why: 'central-size' } });
  });

  it('a local header that names another entry is an integrity error when streamed', async () => {
    const file = path.join(base, 'names.zip');
    const w = await ZipWriter.create(file);
    await w.addBuffer('library/aaaa.txt', Buffer.from('payload'));
    await w.finish();
    const bytes = await readFile(file);
    bytes.write('library/bbbb.txt', 30, 'utf8');
    await writeFile(file, bytes);
    const zip = await ZipReader.open(file, 10);
    await expect(zip.read(zip.entries[0]!, 100)).rejects.toMatchObject({ details: { reason: 'integrity' } });
  });
});

describe('verify and restore of crafted archives', () => {
  it('names that differ only by case are flagged as unexpected', async () => {
    const file = await craft('case.rlbackup', { 'library/Note.md': 'one', 'library/note.md': 'two' });
    const { jobId } = ok(await call('backup:verify', { file }));
    const st = await finished(jobId);
    expect(st.result.problemCount).toBe(1);
    expect(st.result.problems[0]).toMatchObject({ path: 'library/note.md', reason: 'unexpected' });
  });

  it('a library.json that does not parse stops the restore with integrity and leaves nothing', async () => {
    const file = await craft('badconfig.rlbackup', { 'library/library.json': '{"aiEnabledFolders":"everything"}' });
    const rootB = await newRoot('libB');
    const before = (await settings.get()).libraries.length;
    const st = await finished(ok(await call('backup:restore', { file, rootPath: rootB })).jobId);
    expect(st.state).toBe('failed');
    expect(st.error).toMatchObject({ code: 'CONFLICT', reason: 'integrity' });
    expect(await readdir(rootB)).toEqual([]);
    expect((await readdir(local)).filter((n) => n.startsWith('restore-'))).toEqual([]);
    expect((await settings.get()).libraries).toHaveLength(before);
  });

  it('a restored library comes back with the MCP server off, no writes and the confirmation on', async () => {
    const cfgFile = path.join(dataDirOf(rootA), 'library.json');
    const cfg = JSON.parse(await readFile(cfgFile, 'utf8'));
    cfg.mcp = { enabled: true, writeEnabled: true };
    cfg.ai = { ...cfg.ai, confirmBeforeSend: false };
    cfg.aiEnabledFolders = ['papers'];
    await writeFile(cfgFile, JSON.stringify(cfg));
    expect((await runCreate({ includeLocal: false })).state).toBe('done');
    const rootB = await newRoot('libB');
    const st = await finished(ok(await call('backup:restore', { file: await firstBackup(), rootPath: rootB, name: 'Copy', restoreLocal: false, restoreSettings: false })).jobId);
    expect(st.state).toBe('done');
    expect(st.result.resetOnRestore).toEqual(['mcp', 'mcp-write', 'confirm-before-send']);
    expect(st.result.secretsToEnter).not.toContain('mcp-token');
    const restored = JSON.parse(await readFile(path.join(dataDirOf(rootB), 'library.json'), 'utf8'));
    expect(restored.mcp).toEqual({ enabled: false, writeEnabled: false });
    expect(restored.ai.confirmBeforeSend).toBe(true);
    expect(restored.aiEnabledFolders).toEqual(['papers']);
    expect(restored.name).toBe('Copy');
  });

  it('a library that already had the safe values reports nothing reset', async () => {
    await runCreate({ includeLocal: false });
    const rootB = await newRoot('libB');
    const st = await finished(ok(await call('backup:restore', { file: await firstBackup(), rootPath: rootB, restoreLocal: false, restoreSettings: false })).jobId);
    expect(st.result.resetOnRestore).toEqual([]);
  });

  it('a failure after the library is registered does not fail the job or leave half a library', async () => {
    await runCreate({ includeLocal: false });
    const rootB = await newRoot('libB');
    (services.secrets as any).has = async () => {
      throw new Error('keychain unavailable');
    };
    const before = (await settings.get()).libraries.length;
    const st = await finished(ok(await call('backup:restore', { file: await firstBackup(), rootPath: rootB, restoreLocal: false, restoreSettings: false })).jobId);
    expect(st.state).toBe('done');
    const profiles = (await settings.get()).libraries;
    expect(profiles).toHaveLength(before + 1);
    expect(profiles.find((p) => p.id === st.result.restoredLibraryId)?.rootPath).toBe(rootB);
    expect(await exists(path.join(dataDirOf(rootB), 'library.json'))).toBe(true);
  });

  it('a cancel that arrives after the work is done leaves the job done, not cancelled', async () => {
    await runCreate({ includeLocal: false });
    const rootB = await newRoot('libB');
    const realGet = settings.get.bind(settings);
    let fired = false;
    (settings as any).get = async () => {
      const s = await realGet();
      // The profile is registered: this is the last stretch of the job.
      if (!fired && s.libraries.some((l) => l.rootPath === rootB)) {
        fired = true;
        cancelAllBackups(services);
      }
      return s;
    };
    const st = await finished(ok(await call('backup:restore', { file: await firstBackup(), rootPath: rootB, restoreLocal: false, restoreSettings: false })).jobId);
    expect(fired).toBe(true);
    expect(st.state).toBe('done');
    expect(st.result.restoredLibraryId).toBeTruthy();
    expect(await exists(path.join(dataDirOf(rootB), 'library.json'))).toBe(true);
  });
});

describe('create', () => {
  it('counts a file that vanished meanwhile (ENOENT) and leaves it out', async () => {
    const real = path.join(base, 'real.txt');
    await writeFile(real, 'content');
    const out = await writeArchive({
      tmpFile: path.join(base, 'x.part'),
      library: [
        { rel: 'real.txt', abs: real, size: 7 },
        { rel: 'gone.txt', abs: path.join(base, 'gone.txt'), size: 5 },
      ],
      local: [],
      settings: null,
      base: { format: 'rl-backup', formatVersion: 1, createdAt: new Date().toISOString(), appVersion: '1', sourceLibraryId: 'lib-x', libraryName: 'X', language: 'en', dataDirName: '.lab', origin: 'manual' },
      documents: 0,
      retryDelaysMs: [],
    });
    expect(out.skipped).toBe(1);
    expect(out.files).toBe(1);
    expect(out.manifest.entries.map((e) => e.path)).toEqual(['library/real.txt']);
    expect(sha('content')).toBe(out.manifest.entries[0]!.sha256);
  });

  it('a manual backup takes the chats when asked, an automatic one never does', async () => {
    const manual = await runCreate({ includeLocal: true });
    expect(manual.result.skipped).toBe(0);
    const { jobId } = await create(services, { includeLocal: true, origin: 'auto' });
    expect((await finished(jobId)).state).toBe('done');
    const items = ok(await call('backup:list')).items as any[];
    expect(items.find((i) => i.origin === 'manual').includesLocal).toBe(true);
    expect(items.find((i) => i.origin === 'auto').includesLocal).toBe(false);
  });
});

describe('residue of interrupted work', () => {
  it('a restore removes old restore folders of the exact pattern and leaves everything else', async () => {
    await runCreate({ includeLocal: false });
    const file = await firstBackup();
    const rootB = await newRoot('libB');
    const stale = path.join(rootB, '.lab.restore-0123456789ab');
    const lookalike = path.join(rootB, '.lab.restore-notahexvalue');
    const mine = path.join(rootB, 'my.restore-0123456789ab');
    const staleLocal = path.join(local, 'restore-aaaaaaaaaaaa');
    for (const d of [stale, lookalike, mine, staleLocal]) {
      await mkdir(d, { recursive: true });
      await writeFile(path.join(d, 'f.txt'), 'x');
    }
    const st = await finished(ok(await call('backup:restore', { file, rootPath: rootB, restoreLocal: false, restoreSettings: false })).jobId);
    expect(st.state).toBe('done');
    expect(await exists(stale)).toBe(false);
    expect(await exists(staleLocal)).toBe(false);
    expect(await exists(lookalike)).toBe(true);
    expect(await exists(mine)).toBe(true);
  });

  it('a create removes .part files older than an hour, not fresh ones', async () => {
    const old = path.join(dest, '.rlbackup-aabbccddeeff.part');
    const fresh = path.join(dest, '.rlbackup-112233445566.part');
    await writeFile(old, 'x');
    await writeFile(fresh, 'x');
    const longAgo = new Date(Date.now() - 2 * 3600_000);
    await utimes(old, longAgo, longAgo);
    expect((await runCreate({ includeLocal: false })).state).toBe('done');
    expect(await exists(old)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect((await readdir(dest)).filter((n) => n.endsWith(BACKUP_LIMITS.extension))).toHaveLength(1);
  });
});
