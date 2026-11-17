import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { DESKTOP_DIR } from './helpers/launch';

/**
 * The packaged app (D-260, D-291), written for the final run (NOT run while writing it): build it with
 * `npm run dist:dir`, then run `npx playwright test -c e2e/playwright.config.ts packaged-app`. Skipped when the
 * folder `apps/desktop/release/win-unpacked` does not exist.
 *
 * Playwright's own Electron launcher cannot drive this build (the fuse `EnableNodeCliInspectArguments` is off, on purpose),
 * so the executable is started directly with a throw-away profile (`--user-data-dir`, which also puts the machine-local
 * data inside that folder) and Chromium's `--remote-debugging-port`; the window is reached over CDP. Environment
 * variables `RL_*` must have no effect: one is set to a different folder to prove it.
 */

const EXE = path.join(DESKTOP_DIR, 'release', 'win-unpacked', 'Research Lab.exe');
const PORT = 9333;
const IDLE_MS = 10_000;

/** Working set (MB) of every process of the app, summed from the process list (the app's own metrics are not reachable over CDP). */
function appMemoryMb(): number {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Name '${path.basename(EXE, '.exe')}' -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`], { encoding: 'utf8' });
  return Math.round(Number(out.trim() || 0) / (1024 * 1024));
}

test.skip(process.platform !== 'win32' || !existsSync(EXE), 'the packaged app is not built (npm run dist:dir)');

test('the packaged app starts on its own profile and rests within the memory budget', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'rl-packaged-'));
  const decoy = await mkdtemp(path.join(os.tmpdir(), 'rl-packaged-decoy-'));
  let child: ChildProcess | undefined;
  try {
    child = spawn(EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
      env: { ...process.env, RL_USER_DATA_DIR: decoy, RL_LOCAL_DATA_DIR: decoy, RL_E2E: '1', ELECTRON_RUN_AS_NODE: '' },
      stdio: 'ignore',
    });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
      if (!browser) await new Promise((r) => setTimeout(r, 500));
    }
    expect(browser, 'the app window could not be reached').toBeTruthy();
    const page = browser!.contexts()[0]!.pages()[0] ?? (await browser!.contexts()[0]!.waitForEvent('page'));
    await expect(page.getByTestId('wizard')).toBeVisible({ timeout: 60_000 });
    expect(page.url().startsWith('rl-app://')).toBe(true);

    await new Promise((r) => setTimeout(r, IDLE_MS));
    const mb = appMemoryMb();
    console.log(`PACKAGED-MEASURE ${JSON.stringify({ idleMemoryMb: mb })}`);
    const budgets = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../tools/budgets.json'), 'utf8')) as { runtime?: { idleMemoryMb?: number } };
    if (budgets.runtime?.idleMemoryMb !== undefined) expect(mb).toBeLessThanOrEqual(budgets.runtime.idleMemoryMb);

    // The profile was used, the decoy folders (RL_* variables) were not.
    await browser!.close();
    child.kill();
    await new Promise((r) => setTimeout(r, 1500));
    expect(existsSync(path.join(profile, 'settings.json'))).toBe(true);
    expect(existsSync(path.join(decoy, 'settings.json'))).toBe(false);
    expect(existsSync(path.join(profile, 'local', 'logs'))).toBe(true);
  } finally {
    child?.kill();
    await new Promise((r) => setTimeout(r, 1000));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    await rm(decoy, { recursive: true, force: true }).catch(() => {});
  }
});
