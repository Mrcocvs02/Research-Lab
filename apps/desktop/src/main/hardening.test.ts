import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovedPaths, type ApprovalPurpose } from './approved-paths.js';
import { e2eDialogOverride } from './dialog-override.js';
import { resolveAppDirs } from './dirs.js';
import { isTrustedUrlFor, resolveRendererFile } from './renderer-url.js';
import { parseDevServerUrl, resolveRuntimeConfig } from './runtime.js';

let tmp: string;
let rendererDir: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rl-hardening-')));
  rendererDir = path.join(tmp, 'renderer');
  await mkdir(path.join(rendererDir, 'assets'), { recursive: true });
  await writeFile(path.join(rendererDir, 'index.html'), '<html></html>');
  await writeFile(path.join(rendererDir, 'assets', 'a.js'), 'x');
  await writeFile(path.join(tmp, 'outside.txt'), 'secret');
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const ABS = (name: string) => path.join(os.tmpdir(), 'rl-hardening-names', name);

describe('runtime switches are development-only', () => {
  const hostile = {
    RL_E2E: '1',
    RL_E2E_DIALOG_PATH: ABS('picked'),
    RL_E2E_OFFLINE: '1',
    RL_E2E_HIDDEN: '1',
    RL_USER_DATA_DIR: ABS('u'),
    RL_LOCAL_DATA_DIR: ABS('l'),
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
  };

  it('an installed app (isPackaged) ignores every one of them and says so', () => {
    const rt = resolveRuntimeConfig(hostile, true);
    expect(rt).toMatchObject({ userDataDir: null, localDataDir: null, dialogPath: null, hiddenWindow: false, offline: false, rendererDevUrl: null });
    for (const name of Object.keys(hostile)) expect(rt.warnings.join(' ')).toContain(name);
    expect(resolveRuntimeConfig({}, true).warnings).toEqual([]);
  });

  it('packaged: data folders keep their defaults and the dialog hook does not exist', () => {
    const dirs = resolveAppDirs({ ...hostile, LOCALAPPDATA: ABS('la') }, { userData: ABS('default') }, true);
    expect(dirs).toEqual({ userData: ABS('default'), localData: path.join(ABS('la'), 'ResearchLab') });
    expect(e2eDialogOverride(hostile, true)).toBeNull();
  });

  it('a development run honours them (the dialog path only together with RL_E2E=1)', () => {
    const rt = resolveRuntimeConfig(hostile, false);
    expect(rt).toMatchObject({
      userDataDir: ABS('u'),
      localDataDir: ABS('l'),
      dialogPath: ABS('picked'),
      hiddenWindow: true,
      rendererDevUrl: 'http://localhost:5173',
      warnings: [],
    });
    expect(resolveRuntimeConfig({ RL_E2E_DIALOG_PATH: ABS('picked') }, false).dialogPath).toBeNull();
    expect(resolveRuntimeConfig({ RL_USER_DATA_DIR: 'relative' }, false).userDataDir).toBeNull();
  });

  it('a dev server URL that is not plain localhost is ignored with a warning, even in development', () => {
    const rt = resolveRuntimeConfig({ ELECTRON_RENDERER_URL: 'https://evil.example/app' }, false);
    expect(rt.rendererDevUrl).toBeNull();
    expect(rt.warnings.join(' ')).toContain('ELECTRON_RENDERER_URL');
  });

  it.each([
    ['http://localhost:5173', 'http://localhost:5173'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ])('accepts %s', (raw, origin) => expect(parseDevServerUrl(raw)).toBe(origin));

  it.each([
    'https://localhost:5173',
    'http://localhost',
    'http://localhost:0',
    'http://localhost:99999',
    'http://evil.example:5173',
    'http://localhost.evil.example:5173',
    'http://localhost:5173@evil.example',
    'http://user:pw@localhost:5173',
    'http://[::1]:5173',
    'http://localhost:5173/some/path',
    'http://localhost:5173/?x=1',
    'http://localhost:5173/#x',
    'file:///C:/app/index.html',
    'javascript:alert(1)',
    'rl-app://app',
    'not a url',
    '',
  ])('rejects %s', (raw) => expect(parseDevServerUrl(raw)).toBeNull());
});

describe('isTrustedUrlFor', () => {
  it('trusts the app origin, and the dev origin only when one was validated', () => {
    expect(isTrustedUrlFor('rl-app://app/index.html', null)).toBe(true);
    expect(isTrustedUrlFor('rl-app://app/', 'http://localhost:5173')).toBe(false);
    expect(isTrustedUrlFor('http://localhost:5173/x', 'http://localhost:5173')).toBe(true);
    expect(isTrustedUrlFor('http://localhost:5173/x', null)).toBe(false);
  });

  it.each([
    'rl-app://app.evil.example/',
    'rl-app://app:81/',
    'rl-app://user@app/',
    'rl-app://user:pw@app/',
    'rl-app://evil/',
    'https://app/',
    'http://app/',
    'file:///index.html',
    'about:blank',
    'javascript:alert(1)',
    'http://localhost:5174/',
    'http://localhost:5173@evil.example/',
    'not a url',
    '',
  ])('does not trust %s', (url) => {
    expect(isTrustedUrlFor(url, null)).toBe(false);
    expect(isTrustedUrlFor(url, 'http://localhost:5173')).toBe(url === 'http://localhost:5173/' ? true : false);
  });
});

describe('rl-app:// file resolution (serveRenderer)', () => {
  const status = async (url: string) => (await resolveRendererFile(rendererDir, url)).status;

  it('serves the index and assets', async () => {
    expect(await resolveRendererFile(rendererDir, 'rl-app://app/')).toEqual({ status: 200, file: path.join(rendererDir, 'index.html') });
    expect(await resolveRendererFile(rendererDir, 'rl-app://app/index.html')).toMatchObject({ status: 200 });
    expect(await resolveRendererFile(rendererDir, 'rl-app://app/assets/a.js')).toEqual({ status: 200, file: path.join(rendererDir, 'assets', 'a.js') });
  });

  it.each([
    'rl-app://app/..%5C..%5Coutside.txt',
    'rl-app://app/..%5Coutside.txt',
    'rl-app://app/%2e%2e/outside.txt',
    'rl-app://app/%2e%2e%2foutside.txt',
    'rl-app://app/%2E%2E%2F%2E%2E%2Foutside.txt',
    'rl-app://app/assets/..%2f..%2foutside.txt',
    'rl-app://app/%252e%252e/outside.txt',
    'rl-app://app/../outside.txt',
    'rl-app://app/..%5C..',
  ])('never serves anything outside the renderer folder: %s', async (url) => {
    expect([403, 404]).toContain(await status(url));
  });

  it('refuses a literal parent segment after decoding', async () => {
    expect(await status('rl-app://app/assets/%2e%2e%2f..%2foutside.txt')).toBe(403);
  });

  it.each([
    'rl-app://app/C:/Windows/win.ini',
    'rl-app://app/C%3A/Windows/win.ini',
    'rl-app://app/C%3A%5CWindows%5Cwin.ini',
    'rl-app://app/%5C%5Cserver%5Cshare%5Cfile',
    'rl-app://app/index.html::$DATA',
    'rl-app://app/index.html%3A%3A%24DATA',
    'rl-app://app/index.html:stream',
    'rl-app://app/assets%5Ca.js',
  ])('refuses drive letters, UNC paths, alternate data streams and backslashes: %s', async (url) => {
    expect(await status(url)).toBe(403);
  });

  it('answers 404 for directories and missing files, never a listing', async () => {
    expect(await status('rl-app://app/assets')).toBe(404);
    expect(await status('rl-app://app/assets/')).toBe(404);
    expect(await status('rl-app://app/nope.js')).toBe(404);
  });

  it('answers 400 for NUL bytes and broken escapes', async () => {
    expect(await status('rl-app://app/index.html%00.png')).toBe(400);
    expect(await status('rl-app://app/%E0%A4%A')).toBe(400);
    expect(await status('not a url')).toBe(400);
  });

  it('answers 404 for other hosts, schemes and credentials', async () => {
    expect(await status('rl-app://evil/index.html')).toBe(404);
    expect(await status('rl-app://user@app/index.html')).toBe(404);
    expect(await status('https://app/index.html')).toBe(404);
    expect(await status('file:///index.html')).toBe(404);
  });

  it('does not follow a link that leaves the renderer folder', async () => {
    const link = path.join(rendererDir, 'escape');
    try {
      await symlink(tmp, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return; // links not available here
    }
    expect(await status('rl-app://app/escape/outside.txt')).toBe(403);
  });
});

describe('ApprovedPaths', () => {
  const purposes: ApprovalPurpose[] = ['library-root', 'legacy-index', 'export-destination', 'taxonomy-file'];

  describe('Windows semantics', () => {
    const make = () => {
      const a = new ApprovedPaths({ platform: 'win32' });
      a.add('C:\\Lib\\Root', 'library-root');
      a.add('\\\\srv\\share\\Dir', 'legacy-index');
      return a;
    };

    it.each([
      'C:\\Lib\\Root',
      'c:\\lib\\root',
      'C:/Lib/Root',
      'C:/Lib//Root/',
      'C:\\Lib\\Root\\',
      'C:\\Lib\\Root\\.',
      'C:\\Lib\\Root\\..\\Root',
      '\\\\?\\C:\\Lib\\Root',
      '\\\\?\\c:\\lib\\root\\',
      '//?/C:/Lib/Root',
    ])('treats %s as the approved folder', (p) => {
      expect(make().has(p, 'library-root')).toBe(true);
    });

    it.each([
      'C:\\Lib\\Root\\sub',
      'C:\\Lib\\Root\\sub\\..\\..',
      'C:\\Lib',
      'C:\\Lib\\Root\\..',
      'C:\\Lib\\Root2',
      'C:\\Lib\\Roo',
      'D:\\Lib\\Root',
      'C:Lib\\Root',
      '\\Lib\\Root',
      'Lib\\Root',
      '',
      'C:\\Lib\\Root\0',
      '\\\\.\\C:\\Lib\\Root',
      '\\\\?\\C:\\Lib\\Root\\sub',
      '\\\\?\\GLOBALROOT\\Lib\\Root',
      '\\\\srv\\share\\Dir',
    ])('does not accept %s as a library root', (p) => {
      expect(make().has(p, 'library-root')).toBe(false);
    });

    it('matches UNC shares however they are spelled, and no parent share', () => {
      const a = make();
      for (const p of ['\\\\srv\\share\\Dir', '//SRV/share/dir', '\\\\?\\UNC\\srv\\share\\Dir', '\\\\?\\unc\\SRV\\SHARE\\DIR\\']) {
        expect(a.has(p, 'legacy-index')).toBe(true);
      }
      expect(a.has('\\\\srv\\share', 'legacy-index')).toBe(false);
      expect(a.has('\\\\srv\\share\\Dir\\sub', 'legacy-index')).toBe(false);
      expect(a.has('\\\\other\\share\\Dir', 'legacy-index')).toBe(false);
    });

    it('resolve() hands back the plain native path, not the renderer spelling', () => {
      const a = make();
      expect(a.resolve('\\\\?\\C:\\Lib\\Root\\', 'library-root')).toBe('C:\\Lib\\Root');
      expect(a.resolve('\\\\?\\UNC\\srv\\share\\Dir', 'legacy-index')).toBe('\\\\srv\\share\\Dir');
      expect(a.resolve('C:\\Lib\\Root\\sub', 'library-root')).toBeNull();
    });
  });

  describe('POSIX semantics', () => {
    it('is exact and case-sensitive', () => {
      const a = new ApprovedPaths({ platform: 'linux' });
      a.add('/data/Lib', 'library-root');
      expect(a.has('/data/Lib', 'library-root')).toBe(true);
      expect(a.has('/data/Lib/', 'library-root')).toBe(true);
      expect(a.has('/data/Lib/../Lib', 'library-root')).toBe(true);
      expect(a.has('/data/lib', 'library-root')).toBe(false);
      expect(a.has('/data/Lib/sub', 'library-root')).toBe(false);
      expect(a.has('/data', 'library-root')).toBe(false);
      expect(a.has('data/Lib', 'library-root')).toBe(false);
    });
  });

  it('binds an approval to its purpose', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const p = platform === 'win32' ? 'C:\\Picked' : '/picked';
      for (const granted of purposes) {
        const a = new ApprovedPaths({ platform });
        a.add(p, granted);
        for (const asked of purposes) expect(a.has(p, asked), `${platform} ${granted} -> ${asked}`).toBe(granted === asked);
      }
    }
  });

  it('keeps purposes independent when one path is approved for several', () => {
    const a = new ApprovedPaths({ platform: 'linux' });
    a.add('/x', 'library-root');
    a.add('/x', 'export-destination');
    expect(a.has('/x', 'library-root') && a.has('/x', 'export-destination')).toBe(true);
    expect(a.has('/x', 'legacy-index')).toBe(false);
  });

  it('ignores garbage on add', () => {
    const a = new ApprovedPaths({ platform: 'linux' });
    a.add('relative', 'library-root');
    a.add('', 'library-root');
    expect(a.has('relative', 'library-root')).toBe(false);
    expect(a.has('', 'library-root')).toBe(false);
  });
});
