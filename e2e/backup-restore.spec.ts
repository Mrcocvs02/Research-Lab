import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, waitForScan } from './helpers/phase1';

/**
 * Phase 8 criterion, written for the final run (NOT run while writing it): a second library with another language and
 * another taxonomy is created, backed up and restored as a NEW library, and nothing else changes.
 *
 * 1. App 1: the first library (English papers) through the wizard.
 * 2. App 2, same profile: a second library (Italian papers) in its own root, language `it`, with its own taxonomy
 *    (`taxonomy:apply`), scanned; the backup destination is a folder outside every library (RL_E2E_BACKUP_DIALOG_PATH);
 *    `backup:create` then `backup:verify`: no problem, one `.rlbackup` file, no temporary file.
 * 3. App 3, same profile: `backup:list`, `backup:restore` into a new empty root (the folder dialog override returns it).
 *    The restored library has a new id, language `it`, the same taxonomy labels and the same number of documents; the
 *    other two libraries are untouched and nothing was written into the new root except the data folder.
 *
 * Run it alone, after `npm run build`. All folders are temporary; the dialog overrides only work with RL_E2E=1.
 */

interface JobStatus {
  state: 'running' | 'done' | 'cancelled' | 'failed';
  result: { problemCount: number; restoredLibraryId: string | null; secretsToEnter: string[] } | null;
  error: { code: string; message: string; reason?: string } | null;
}

async function waitJob(window: Page, jobId: string): Promise<JobStatus> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const st = await ipcData<JobStatus>(window, 'backup:status', { jobId });
    if (st.state !== 'running') return st;
    if (Date.now() > deadline) throw new Error('the backup job did not finish');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('a second library (other language, other taxonomy) is backed up and restored as a new library', async () => {
  test.setTimeout(480_000);
  const extra = await mkdtemp(path.join(os.tmpdir(), 'rl-e2e-backup-'));
  const backupDir = path.join(extra, 'backups');
  const restoreRoot = path.join(extra, 'restored-root');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(backupDir);
  await mkdir(restoreRoot);
  const apps: LaunchedApp[] = [];
  try {
    // 1. First library.
    const one = await launchApp({ library: 'en', dialogPath: true });
    apps.push(one);
    await createLibraryViaWizard(one.window, { name: 'First library' });
    await waitForScan(one.window, one.library!.manifest!.files.filter((f) => f.hasText).length);
    await one.app.close();
    const profile = { RL_USER_DATA_DIR: one.userDataDir, RL_LOCAL_DATA_DIR: one.localDataDir };

    // 2. Second library, backup and verify.
    const two = await launchApp({ library: 'it', dialogPath: true, env: { ...profile, RL_E2E_BACKUP_DIALOG_PATH: backupDir } });
    apps.push(two);
    const root2 = two.library!.root;
    await ipcData(two.window, 'dialog:chooseFolder', { purpose: 'library-root' });
    const created = await ipcData<{ id: string }>(two.window, 'library:create', { name: 'Second library', rootPath: root2, language: 'it' });
    await ipcData(two.window, 'library:setActive', { libraryId: created.id });
    await ipcData(two.window, 'taxonomy:apply', { ops: [{ op: 'create', id: 'tema-uno', label: 'Primo tema' }, { op: 'create', id: 'tema-due', label: 'Secondo tema', parents: ['tema-uno'] }] });
    // The number of documents is known from the fixture: wait for exactly that many, not for a moment when the scan looks idle.
    await waitForScan(two.window, two.library!.manifest!.files.filter((f) => f.hasText).length);
    const before = await ipcData<{ documents: number }>(two.window, 'maintenance:report', {});
    expect(before.documents).toBeGreaterThan(0);

    const dest = await ipcData<{ destination: string }>(two.window, 'backup:chooseDestination', {});
    expect(dest.destination).toBe(backupDir);
    const job = await ipcData<{ jobId: string }>(two.window, 'backup:create', { includeLocal: true });
    const made = await waitJob(two.window, job.jobId);
    expect(made.error).toBeNull();
    expect(made.state).toBe('done');
    const names = await readdir(backupDir);
    expect(names.filter((n) => n.endsWith('.rlbackup'))).toHaveLength(1);
    expect(names.some((n) => n.endsWith('.part'))).toBe(false);

    const items = (await ipcData<{ items: Array<{ file: string; documents: number; language: string }> }>(two.window, 'backup:list', {})).items;
    expect(items[0]).toMatchObject({ documents: before.documents, language: 'it' });
    const verify = await ipcData<{ jobId: string }>(two.window, 'backup:verify', { file: items[0]!.file });
    const verified = await waitJob(two.window, verify.jobId);
    expect(verified.result?.problemCount).toBe(0);
    await two.verifyLibraryUntouched();
    await two.app.close();

    // 3. Restore as a new library in an empty root.
    const three = await launchApp({ dialogPath: restoreRoot, env: { ...profile, RL_E2E_BACKUP_DIALOG_PATH: backupDir } });
    apps.push(three);
    const listed = (await ipcData<{ items: Array<{ file: string }> }>(three.window, 'backup:list', {})).items;
    expect(listed).toHaveLength(1);
    await ipcData(three.window, 'dialog:chooseFolder', { purpose: 'library-root' });
    const librariesBefore = (await ipcData<{ profiles: Array<{ id: string }> }>(three.window, 'library:list', {})).profiles;
    const restore = await ipcData<{ jobId: string }>(three.window, 'backup:restore', { file: listed[0]!.file, rootPath: restoreRoot, restoreLocal: true, restoreSettings: false });
    const restored = await waitJob(three.window, restore.jobId);
    expect(restored.error).toBeNull();
    expect(restored.state).toBe('done');
    const newId = restored.result!.restoredLibraryId!;
    expect(librariesBefore.map((l) => l.id)).not.toContain(newId);
    const profiles = (await ipcData<{ profiles: Array<{ id: string }> }>(three.window, 'library:list', {})).profiles;
    expect(profiles).toHaveLength(librariesBefore.length + 1);
    expect((await readdir(restoreRoot)).sort()).toEqual(['.lab']);

    const config = await ipcData<{ language: string }>(three.window, 'library:getConfig', { libraryId: newId });
    expect(config.language).toBe('it');
    await ipcData(three.window, 'library:setActive', { libraryId: newId });
    const taxonomy = await ipcData<{ nodes: Array<{ id: string; label: string }> }>(three.window, 'taxonomy:get', {});
    expect(taxonomy.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Primo tema', 'Secondo tema']));
    const after = await ipcData<{ documents: number }>(three.window, 'maintenance:report', { libraryId: newId });
    expect(after.documents).toBe(before.documents);
    await three.app.close();
  } finally {
    for (const a of apps) await a.close().catch(() => {});
    await rm(extra, { recursive: true, force: true }).catch(() => {});
  }
});
