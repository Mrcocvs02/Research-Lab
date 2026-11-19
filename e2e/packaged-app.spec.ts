import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import { createFixtureLibrary, removeTree } from '@rl/testkit';
import { DESKTOP_DIR } from './helpers/launch';
import { createLibraryViaWizard, ipcData, waitForScan } from './helpers/phase1';
import { openAdvancedGroup, openSettings } from './helpers/settings';
import { rows } from './helpers/ui';

/**
 * The packaged app (D-260, D-291, D-296), written for the final run (NOT run while writing it).
 *
 * Test build: `npm run dist:test-dir` (RL_PACKAGED_TEST=1 at build time; the only build that accepts a remote debugging
 * port, `--user-data-dir` and the e2e dialog hooks), then `npx playwright test -c e2e/playwright.config.ts packaged-app`.
 * Release build: `npm run dist:dir` then the same command with `RL_PACKAGED_RELEASE=1`: only the last test runs and
 * checks that this build REFUSES the debugging port (it never runs the app on the real profile).
 * Skipped when the folder `apps/desktop/release/win-unpacked` does not exist.
 *
 * Playwright's own Electron launcher cannot drive this build (the fuse `EnableNodeCliInspectArguments` is off, on purpose),
 * so the executable is started directly with a throw-away profile (`--user-data-dir`, which also puts the machine-local
 * data inside that folder) and Chromium's `--remote-debugging-port`; the window is reached over CDP. Environment
 * variables `RL_*` other than the dialog hooks must have no effect: one is set to a different folder to prove it.
 *
 * What the test build proves beyond starting: the packaging risks. A small generated library of PDFs is scanned (the
 * scan worker out of the asar and pdf.js extracting text), a PDF is opened in the reader (pdf.js in the renderer), a
 * backup is created and verified (zlib and the zip container), and the AI settings load without Claude Code installed
 * (the Agent SDK is external to the bundle). Only generated fixtures are used.
 */

const EXE = path.join(DESKTOP_DIR, 'release', 'win-unpacked', 'Research Lab.exe');
const PORT = 9333;
const IDLE_MS = 10_000;
const RELEASE_CHECK = process.env.RL_PACKAGED_RELEASE === '1';

/** Working set (MB) of every process of the app, summed from the process list (the app's own metrics are not reachable over CDP). */
function appMemoryMb(): number {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Name '${path.basename(EXE, '.exe')}' -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`], { encoding: 'utf8' });
  return Math.round(Number(out.trim() || 0) / (1024 * 1024));
}

/** The environment of the app: the current one without Electron's node mode (it must not be set, not even empty). */
function appEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface JobStatus {
  state: 'running' | 'done' | 'cancelled' | 'failed';
  result: { problemCount: number } | null;
  error: { code: string; message: string } | null;
}

async function waitJob(page: Page, jobId: string): Promise<JobStatus> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const st = await ipcData<JobStatus>(page, 'backup:status', { jobId });
    if (st.state !== 'running') return st;
    if (Date.now() > deadline) throw new Error('the backup job did not finish');
    await sleep(300);
  }
}

test.skip(process.platform !== 'win32' || !existsSync(EXE), 'the packaged app is not built (npm run dist:test-dir)');

test('the packaged app starts, scans, reads, backs up and rests within the memory budget', async () => {
  test.skip(RELEASE_CHECK, 'RL_PACKAGED_RELEASE=1: this run checks a release build');
  test.setTimeout(300_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'rl-packaged-'));
  const decoy = await mkdtemp(path.join(os.tmpdir(), 'rl-packaged-decoy-'));
  const backups = await mkdtemp(path.join(os.tmpdir(), 'rl-packaged-backups-'));
  const fixture = await createFixtureLibrary('en');
  let child: ChildProcess | undefined;
  try {
    child = spawn(EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
      env: appEnv({ RL_USER_DATA_DIR: decoy, RL_LOCAL_DATA_DIR: decoy, RL_E2E: '1', RL_E2E_DIALOG_PATH: fixture.root, RL_E2E_BACKUP_DIALOG_PATH: backups }),
      stdio: 'ignore',
    });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
      if (!browser) await sleep(500);
    }
    expect(browser, 'the app window could not be reached').toBeTruthy();
    const page = browser!.contexts()[0]!.pages()[0] ?? (await browser!.contexts()[0]!.waitForEvent('page'));
    await expect(page.getByTestId('wizard')).toBeVisible({ timeout: 60_000 });
    expect(page.url().startsWith('rl-app://')).toBe(true);

    // Memory at rest, before any library is open.
    await sleep(IDLE_MS);
    const mb = appMemoryMb();
    console.log(`PACKAGED-MEASURE ${JSON.stringify({ idleMemoryMb: mb })}`);
    const budgets = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../tools/budgets.json'), 'utf8')) as { runtime?: { idleMemoryMb?: number } };
    if (budgets.runtime?.idleMemoryMb !== undefined) expect(mb).toBeLessThanOrEqual(budgets.runtime.idleMemoryMb);

    // Scan worker and pdf.js text extraction, from the packaged files.
    await createLibraryViaWizard(page, { name: 'Packaged library' });
    await waitForScan(page, fixture.manifest.files.filter((f) => f.hasText).length);

    // pdf.js in the reader.
    await expect(page.getByTestId('section-library')).toBeVisible();
    const row = rows(page).first();
    await row.hover();
    await row.getByTestId('row-read').click();
    await expect(page.getByTestId('reader')).toBeVisible();
    await expect(page.getByTestId('reader-error')).toHaveCount(0);
    await expect(page.getByTestId('reader-pages')).toContainText(/\d/, { timeout: 60_000 });
    await page.getByTestId('reader-close').click();

    // A backup: the zip container and zlib out of the package, then a verification that finds no problem.
    const dest = await ipcData<{ destination: string }>(page, 'backup:chooseDestination', {});
    expect(dest.destination).toBe(backups);
    const made = await waitJob(page, (await ipcData<{ jobId: string }>(page, 'backup:create', { includeLocal: false })).jobId);
    expect(made.error).toBeNull();
    expect(made.state).toBe('done');
    const files = (await readdir(backups)).filter((n) => n.endsWith('.rlbackup'));
    expect(files).toHaveLength(1);
    const listed = (await ipcData<{ items: Array<{ file: string }> }>(page, 'backup:list', {})).items;
    const verified = await waitJob(page, (await ipcData<{ jobId: string }>(page, 'backup:verify', { file: listed[0]!.file })).jobId);
    expect(verified.result?.problemCount).toBe(0);

    // The AI section opens without Claude Code installed (the Agent SDK is not in the bundle).
    const status = await ipcData<{ provider: string }>(page, 'ai:status', {});
    expect(status.provider).toBeTruthy();
    // Settings are sections now (design ARCHITETTURA-UI §6): the Claude section, and the executable under Advanced.
    await openSettings(page, 'claude');
    await expect(page.getByTestId('ai-settings')).toBeVisible({ timeout: 30_000 });
    await openAdvancedGroup(page, 'claude');
    await expect(page.getByTestId('ai-exe')).toBeVisible();

    // The profile was used, the decoy folders (RL_* variables) were not.
    await browser!.close();
    child.kill();
    await sleep(1500);
    expect(existsSync(path.join(profile, 'settings.json'))).toBe(true);
    expect(existsSync(path.join(decoy, 'settings.json'))).toBe(false);
    expect(existsSync(path.join(profile, 'local', 'logs'))).toBe(true);
  } finally {
    child?.kill();
    await sleep(1000);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    await rm(decoy, { recursive: true, force: true }).catch(() => {});
    await rm(backups, { recursive: true, force: true }).catch(() => {});
    await removeTree(fixture.root).catch(() => {});
  }
});

test('a release build refuses the debugging port (D-296)', async () => {
  test.skip(!RELEASE_CHECK, 'needs a release build (npm run dist:dir) and RL_PACKAGED_RELEASE=1');
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'rl-packaged-release-'));
  try {
    // 1. The debugging port: the process ends with code 1 and nothing listens on the port.
    const refused = spawn(EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], { env: appEnv({}), stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve) => {
      refused.once('exit', (c) => resolve(c));
      setTimeout(() => resolve(null), 20_000);
    });
    refused.kill();
    expect(code).toBe(1);
    expect(await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).then(() => true, () => false)).toBe(false);
    // The profile switch is ignored too (unit-tested); it is not run here because the app would then open the real profile.
  } finally {
    await sleep(1000);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
});
