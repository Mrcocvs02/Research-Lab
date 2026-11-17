import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeProvider, findClaudeExecutable } from '@rl/ai';
import { appSettingsSchema, channels, createDispatcher, createMemoryLogger, type IpcEnvelope } from '@rl/core';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';

let dir: string;
let picked: string | null;
let settings: ReturnType<typeof appSettingsSchema.parse>;

const call = async (c: string, p: unknown = {}): Promise<IpcEnvelope> => {
  const log = createMemoryLogger();
  const s = {
    log,
    pickExecutable: async () => picked,
    settings: {
      get: async () => structuredClone(settings),
      update: async (fn: (x: typeof settings) => void) => {
        const d = structuredClone(settings);
        fn(d);
        settings = d;
        return d;
      },
    },
  } as unknown as MainServices;
  return createDispatcher(channels, buildHandlers(s), log)(c, p);
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-exe-'));
  settings = appSettingsSchema.parse({});
  picked = null;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('Claude Code executable', () => {
  it('saves the file chosen in the dialog, forgets it, ignores a cancelled dialog', async () => {
    const exe = path.join(dir, 'claude-test.exe');
    await writeFile(exe, 'x');
    picked = exe;
    const r = await call('ai:chooseExecutable');
    expect(r.ok && (r.data as { path: string }).path).toBeTruthy();
    expect(settings.ai.claudeCodePath).toBeTruthy();
    picked = null;
    expect(await call('ai:chooseExecutable')).toMatchObject({ ok: true, data: { path: null } });
    expect(settings.ai.claudeCodePath).toBeTruthy();
    expect(await call('ai:clearExecutable')).toMatchObject({ ok: true });
    expect(settings.ai.claudeCodePath).toBeNull();
  });

  it('refuses a folder or a missing file', async () => {
    await mkdir(path.join(dir, 'sub'));
    picked = path.join(dir, 'sub');
    expect(await call('ai:chooseExecutable')).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    picked = path.join(dir, 'nope.exe');
    expect(await call('ai:chooseExecutable')).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(settings.ai.claudeCodePath).toBeNull();
  });

  it('the saved path wins over discovery, and the source is reported', () => {
    const exists = (p: string) => p === '/saved/claude' || p === '/bin/claude';
    expect(findClaudeExecutable({ configured: '/saved/claude', env: { PATH: '/bin' }, platform: 'linux', exists, bundled: () => null })).toEqual({ path: '/saved/claude', source: 'settings' });
    expect(findClaudeExecutable({ configured: '/gone/claude', env: { PATH: '/bin' }, platform: 'linux', exists, bundled: () => null })).toEqual({ path: '/bin/claude', source: 'path' });
    expect(findClaudeExecutable({ env: { PATH: '' }, home: '/home/u', platform: 'linux', exists: (p) => p === '/home/u/.local/bin/claude', bundled: () => null }).source).toBe('local-bin');
    expect(findClaudeExecutable({ env: { PATH: '' }, platform: 'linux', exists: () => false, bundled: () => '/sdk/claude' })).toEqual({ path: '/sdk/claude', source: 'sdk' });
    expect(findClaudeExecutable({ env: { PATH: '' }, platform: 'linux', exists: () => false, bundled: () => null })).toEqual({ path: null, source: 'none' });
    const p = createClaudeProvider({ workDir: '/w', configuredExecutable: () => '/saved/claude', env: { PATH: '' }, exists, bundled: () => null });
    expect(p.executable?.()).toEqual({ path: '/saved/claude', source: 'settings' });
  });
});
