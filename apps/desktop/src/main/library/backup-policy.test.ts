import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDataDir } from '@rl/data';
import { createBackupPolicy } from './backup-policy.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rl-backup-'));
  await mkdir(path.join(tmp, 'data'), { recursive: true });
  await writeFile(path.join(tmp, 'data', 'library.json'), '{}');
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('backup policy (defect 10)', () => {
  it('copies at most once a day per library and keeps the last five', async () => {
    let clock = Date.now();
    const backupsDir = path.join(tmp, 'backups');
    const policy = createBackupPolicy({ backup: async (d, r) => {
        const made = await backupDataDir(d, r, new Date(clock));
        // The policy reads the folder's modification time: make it follow the test's clock.
        if (made) await utimes(made.backupDir, new Date(clock), new Date(clock));
        return made;
      },
      backupsDir,
      now: () => clock,
    });
    const data = path.join(tmp, 'data');
    expect(await policy('lib-a', data)).not.toBeNull();
    expect(await policy('lib-a', data)).toBeNull(); // same day: skipped
    expect(await policy('lib-b', data)).not.toBeNull(); // another library has its own clock
    expect(await policy('lib-a', data, { force: true })).not.toBeNull(); // an import asks for its own

    // One backup per day, seven days: only five stay.
    for (let day = 1; day <= 7; day++) {
      clock += 25 * 60 * 60 * 1000;
      expect(await policy('lib-a', data)).not.toBeNull();
    }
    expect((await readdir(path.join(backupsDir, 'lib-a'))).length).toBe(5);
    expect((await readdir(path.join(backupsDir, 'lib-b'))).length).toBe(1);
  });

  it('does not accept a library id that would leave the backups folder', async () => {
    const policy = createBackupPolicy({ backup: (d, r) => backupDataDir(d, r), backupsDir: path.join(tmp, 'backups') });
    expect(await policy('../evil', path.join(tmp, 'data'))).toBeNull();
  });
});
