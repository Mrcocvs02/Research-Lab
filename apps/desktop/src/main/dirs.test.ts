import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppDirs } from './dirs.js';

const ABS = (...p: string[]) => path.resolve(path.sep, 'test-root', ...p);

describe('resolveAppDirs and --user-data-dir', () => {
  const defaults = { userData: ABS('default') };
  const env = { LOCALAPPDATA: ABS('la') };

  it('without the switch the machine-local folder is the standard one', () => {
    expect(resolveAppDirs(env, defaults, true, [])).toEqual({ userData: ABS('default'), localData: path.join(ABS('la'), 'ResearchLab') });
  });

  it('an installed app takes one profile folder from the switch and keeps its local data inside it', () => {
    const dirs = resolveAppDirs(env, defaults, true, ['app.exe', `--user-data-dir=${ABS('profile')}`]);
    expect(dirs).toEqual({ userData: ABS('profile'), localData: path.join(ABS('profile'), 'local') });
  });

  it('a relative path is ignored, and RL_* variables stay ignored in an installed app', () => {
    const hostile = { ...env, RL_USER_DATA_DIR: ABS('evil'), RL_LOCAL_DATA_DIR: ABS('evil-local') };
    expect(resolveAppDirs(hostile, defaults, true, ['--user-data-dir=relative/path']).userData).toBe(ABS('default'));
    expect(resolveAppDirs(hostile, defaults, true, [`--user-data-dir=${ABS('profile')}`]).userData).toBe(ABS('profile'));
  });
});
