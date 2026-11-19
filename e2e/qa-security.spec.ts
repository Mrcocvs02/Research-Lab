import { expect, test } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers/launch';
import { createLibraryViaWizard } from './helpers/phase1';

/**
 * Security checks on the built app. The e2e app runs from source with `electron <dir>`, so
 * `app.isPackaged` is false here: the packaged-app rules (every RL_* and ELECTRON_RENDERER_URL
 * variable ignored) are covered by unit tests on the pure resolver (`hardening.test.ts`); this file
 * checks the parts that need a real window: the dev-server URL filter and the rl-app:// handler.
 */

const UNTRUSTED_DEV_URLS = ['http://evil.example:5173', 'http://localhost:5173.evil.example', 'https://localhost:5173', 'file:///C:/some/app/index.html', 'http://localhost'];

for (const url of UNTRUSTED_DEV_URLS) {
  test(`ELECTRON_RENDERER_URL=${url} is ignored: the built renderer loads, with the strict CSP and no DevTools`, async () => {
    const ctx = await launchApp({ env: { ELECTRON_RENDERER_URL: url } });
    try {
      await expect(ctx.window.getByTestId('app-title')).toHaveText('Research Lab');
      expect(ctx.window.url().startsWith('rl-app://app/')).toBe(true);

      // DevTools are disabled for the window: asking for them opens nothing.
      const devToolsOpened = await ctx.app.evaluate(({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0]!.webContents;
        wc.openDevTools();
        return wc.isDevToolsOpened();
      });
      expect(devToolsOpened).toBe(false);

      const csp = await ctx.window.evaluate(() => fetch(location.href).then((r) => r.headers.get('content-security-policy')));
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'"); // the dev CSP would have it
      expect(csp).not.toContain('ws://');

      // The refusal is logged (warning), without ever loading the URL.
      await expect
        .poll(async () => readFile(path.join(ctx.localDataDir, 'logs', 'main.log'), 'utf8').catch(() => ''), { timeout: 10_000 })
        .toContain('Ignored ELECTRON_RENDERER_URL');
    } finally {
      await ctx.close();
    }
  });
}

test('rl-app:// never serves anything outside the renderer folder', async () => {
  const ctx = await launchApp();
  try {
    await expect(ctx.window.getByTestId('app-title')).toHaveText('Research Lab');
    const urls = [
      'rl-app://app/..%5C..%5Cpackage.json',
      'rl-app://app/%2e%2e/package.json',
      'rl-app://app/%2e%2e%2f%2e%2e%2fpackage.json',
      'rl-app://app/C:/Windows/win.ini',
      'rl-app://app/C%3A%5CWindows%5Cwin.ini',
      'rl-app://app/index.html::$DATA',
      'rl-app://app/index.html:stream',
      'rl-app://app/assets',
      'rl-app://app/assets/',
      'rl-app://app/index.html%00.png',
    ];
    const results = await ctx.window.evaluate(async (list) => {
      const out: Array<{ url: string; status: number | string; body: string }> = [];
      for (const url of list) {
        try {
          const r = await fetch(url);
          out.push({ url, status: r.status, body: (await r.text()).slice(0, 80) });
        } catch (e) {
          out.push({ url, status: `error:${String(e)}`, body: '' });
        }
      }
      return out;
    }, urls);
    for (const r of results) {
      expect(r.status === 200 || r.body.includes('"name"'), `${r.url} -> ${r.status} ${r.body}`).toBe(false);
    }
    // And the normal page is still served.
    const ok = await ctx.window.evaluate(() => fetch('rl-app://app/index.html').then((r) => r.status));
    expect(ok).toBe(200);
  } finally {
    await ctx.close();
  }
});

test('secrets:set with malformed requests fails cleanly and never echoes the value', async () => {
  const ctx = await launchApp();
  try {
    await expect(ctx.window.getByTestId('app-title')).toHaveText('Research Lab');
    const secret = 'sk-e2e-SECRET-VALUE-987';
    const replies = await ctx.window.evaluate(async (value) => {
      const bridge = (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<unknown> } }).rlBridge;
      return Promise.all([
        bridge.invokeRaw('secrets:set', { scope: { kind: 'app' }, name: 'BAD NAME', value }),
        bridge.invokeRaw('secrets:set', { scope: { kind: 'nope' }, name: 'k', value }),
        bridge.invokeRaw('secrets:set', { scope: { kind: 'app' }, name: 'k', value: 42 }),
        bridge.invokeRaw('secrets:set', value),
      ]);
    }, secret);
    for (const r of replies) expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(JSON.stringify(replies)).not.toContain(secret);
    const log = await readFile(path.join(ctx.localDataDir, 'logs', 'main.log'), 'utf8').catch(() => '');
    expect(log).not.toContain(secret);
  } finally {
    await ctx.close();
  }
});

test.describe('settings.json problems are shown to the user and the file is not lost', () => {
  const seeded = async (content: string) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rl-e2e-settings-'));
    await writeFile(path.join(dir, 'settings.json'), content);
    return dir;
  };

  test('a corrupt file: banner with the reason, copy kept next to it', async () => {
    const dir = await seeded('{this is not json');
    const folder = await mkdtemp(path.join(os.tmpdir(), 'rl-e2e-lib-'));
    const ctx = await launchApp({ dialogPath: folder, offline: true, env: { RL_USER_DATA_DIR: dir } });
    try {
      const banner = ctx.window.getByTestId('notice-banner');
      await expect(banner).toBeVisible();
      await expect(banner.locator('[data-notice="settings-reset"]')).toBeVisible();
      const copies = (await readdir(dir)).filter((f) => f.startsWith('settings.json.invalid-'));
      expect(copies).toHaveLength(1);
      expect(await readFile(path.join(dir, copies[0]!), 'utf8')).toBe('{this is not json');
      // A first start shows the wizard over the banner (the shell is behind the modal): the notice waits for the user, then is dismissed.
      await createLibraryViaWizard(ctx.window, { name: 'Notice library' });
      await expect(banner.locator('[data-notice="settings-reset"]')).toBeVisible();
      await banner.getByRole('button').click();
      await expect(banner).toBeHidden();
    } finally {
      await ctx.close();
      await rm(dir, { recursive: true, force: true });
      await rm(folder, { recursive: true, force: true });
    }
  });

  test('a file from a newer version: banner, file untouched, changes refused', async () => {
    const original = JSON.stringify({ schemaVersion: 99, deviceId: 'device-12345678', uiLanguage: 'en', libraries: [], activeLibraryId: null });
    const dir = await seeded(original);
    const ctx = await launchApp({ env: { RL_USER_DATA_DIR: dir } });
    try {
      await expect(ctx.window.getByTestId('notice-banner').locator('[data-notice="settings-read-only"]')).toBeVisible();
      const reply = await ctx.window.evaluate(() =>
        (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<unknown> } }).rlBridge.invokeRaw('settings:set', { uiLanguage: 'it' }),
      );
      expect(reply).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
      expect(await readFile(path.join(dir, 'settings.json'), 'utf8')).toBe(original);
    } finally {
      await ctx.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
