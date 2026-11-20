import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { openSyntheticLibrary } from './helpers/ui';

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
    // `pathForFile` (dropped files, wave 4.2) only maps a File to a string: anything else gives '' and nothing leaks.
    pathOfNonFile: (() => {
      try {
        return (window as unknown as { rlBridge: { pathForFile(f: unknown): string } }).rlBridge.pathForFile({ name: 'x' });
      } catch {
        return 'threw';
      }
    })(),
    pathOfSyntheticFile: (window as unknown as { rlBridge: { pathForFile(f: File): string } }).rlBridge.pathForFile(new File(['x'], 'x.pdf')),
  }));
  expect(inPage).toEqual({
    require: 'undefined',
    process: 'undefined',
    ipcRenderer: 'undefined',
    bridge: ['invokeRaw', 'pathForFile', 'subscribe'],
    pathOfNonFile: '',
    pathOfSyntheticFile: '',
  });
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

test('shell with a library: sidebar order and Alt+1..5, Back/Forward, Activity chip, palette, language', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const lib = await openSyntheticLibrary(testInfo);
  try {
  const w = lib.window;
  const order = await w.locator('nav[aria-label] [data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order).toEqual(['nav-library', 'nav-review', 'nav-projects', 'nav-discover', 'nav-map', 'nav-tags']);
  const current = () => w.locator('[data-testid^="nav-"][aria-current="page"]').getAttribute('data-testid');
  await w.keyboard.press('Alt+2');
  await expect.poll(current).toBe('nav-review');
  await w.keyboard.press('Alt+5');
  await expect.poll(current).toBe('nav-map');
  await w.keyboard.press('Alt+3');
  await expect.poll(current).toBe('nav-projects');
  await w.keyboard.press('Alt+ArrowLeft');
  await expect.poll(current).toBe('nav-map');
  await w.getByTestId('nav-back').click();
  await expect.poll(current).toBe('nav-review');
  await w.getByTestId('nav-forward').click();
  await expect.poll(current).toBe('nav-map');
  await w.keyboard.press('Control+,');
  await expect.poll(current).toBe('nav-settings');
  await w.keyboard.press('Alt+1');
  await expect.poll(current).toBe('nav-library');
  // The sidebar toggle keeps every entry reachable by its name when only the icons show.
  await w.getByTestId('sidebar-toggle').click();
  await expect(w.getByTestId('shell')).toHaveAttribute('data-collapsed', 'true');
  await expect(w.getByTestId('nav-review')).toHaveAccessibleName(/./);
  await w.getByTestId('sidebar-toggle').click();
  await expect(w.getByTestId('shell')).not.toHaveAttribute('data-collapsed');

  await w.getByTestId('scan-status').click();
  await expect(w.getByTestId('activity-popover')).toBeVisible();
  await expect(w.getByTestId('activity-scan-now')).toBeEnabled();
  await w.keyboard.press('Escape');
  await expect(w.getByTestId('activity-popover')).toHaveCount(0);
  await w.getByTestId('palette-open').click();
  await expect(w.getByTestId('command-palette')).toBeVisible();
  await w.keyboard.press('Escape');
  await expect(w.getByTestId('command-palette')).toHaveCount(0);

  const stored = () =>
    w.evaluate(async () => {
      const r = (await (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<{ data: { uiLanguage: string } }> } }).rlBridge.invokeRaw('settings:get', {})) as { data: { uiLanguage: string } };
      return r.data.uiLanguage;
    });
  // The language settings load a moment after the window opens: wait for them, then switch to the other language.
  await expect.poll(stored).toMatch(/^(it|en)$/);
  const before = await stored();
  await w.keyboard.press('Control+k');
  await w.getByTestId('palette-input').fill(before === 'en' ? 'Italiano' : 'English');
  await w.locator('[data-testid="palette-item"][data-command="app-switchLanguage"]').click();
  // The UI updates before settings:set is persisted, so poll the stored value instead of reading it once.
  await expect.poll(stored, { timeout: 10_000 }).toBe(before === 'en' ? 'it' : 'en');
  await expect(w.getByTestId('nav-library')).toHaveAccessibleName(before === 'en' ? 'Libreria' : 'Library');
  } finally {
    await lib.ctx.close();
  }
});
