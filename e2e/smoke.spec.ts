import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';

let ctx: LaunchedApp;
test.beforeAll(async () => {
  ctx = await launchApp();
});
test.afterAll(async () => {
  await ctx?.close();
});

test('window opens with the app title and renders the shell', async () => {
  await expect(ctx.window).toHaveTitle('Research Lab');
  await expect(ctx.window.getByTestId('app-title')).toHaveText('Research Lab');
});

test('renderer is isolated: contextIsolation on, nodeIntegration off, sandbox on', async () => {
  const prefs = await ctx.app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
    const p = wc.getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webviewTag: p.webviewTag };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false });

  const inPage = await ctx.window.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    bridge: Object.keys((window as unknown as { rlBridge: object }).rlBridge).sort(),
  }));
  expect(inPage).toEqual({ require: 'undefined', process: 'undefined', ipcRenderer: 'undefined', bridge: ['invokeRaw', 'subscribe'] });
});

test('typed IPC round trip and strict CSP', async () => {
  const info = await ctx.window.evaluate(async () => {
    const env = await (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<unknown> } }).rlBridge.invokeRaw('app:info', {});
    const bad = await (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<unknown> } }).rlBridge.invokeRaw('nope:nope', {});
    const csp = await fetch(location.href).then((r) => r.headers.get('content-security-policy'));
    return { env, bad, csp };
  });
  expect(info.env).toMatchObject({ ok: true, data: { name: 'Research Lab' } });
  expect(info.bad).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
  expect(info.csp).toContain("default-src 'none'");
  expect(info.csp).toContain("script-src 'self'");
  expect(info.csp).not.toContain("'unsafe-eval'");
});

test('language switch persists through settings (UI strings change)', async () => {
  const select = ctx.window.getByTestId('language-select');
  // The select is disabled until the first settings load has finished: wait for that, not for a fixed time.
  await expect(select).toBeEnabled();
  await select.selectOption('en');
  await expect(ctx.window.getByTestId('shell-empty')).toContainText('No library is open');
  // The UI updates before settings:set is persisted, so poll the stored value instead of reading it once.
  await expect
    .poll(
      () =>
        ctx.window.evaluate(async () => {
          const r = (await (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<{ data: { uiLanguage: string } }> } }).rlBridge.invokeRaw('settings:get', {})) as { data: { uiLanguage: string } };
          return r.data.uiLanguage;
        }),
      { timeout: 10_000 },
    )
    .toBe('en');
});
