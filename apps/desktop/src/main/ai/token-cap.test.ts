import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appSettingsSchema, AppError, createMemoryLogger, type LibraryProfile } from '@rl/core';
import { createLibraryStore } from '@rl/data';
import type { MainServices } from '../ipc/handlers/services.js';
import { assertTokenCap, noteSend, setTokenCap, tokenUsage } from './token-cap.js';

let tmp: string;
let events: Array<{ name: string; payload: any }>;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rl-token-cap-'));
  events = [];
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const profile = (id: string, rootPath: string): LibraryProfile => ({ id, name: id, rootPath, dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' });

async function setup(sends: Array<{ lib: string; tokens: number; purpose?: string }>, cap: number | null) {
  const profiles: LibraryProfile[] = [];
  for (const lib of new Set(sends.map((x) => x.lib))) {
    const root = path.join(tmp, lib);
    await mkdir(root);
    profiles.push(profile(lib, root));
    const store = createLibraryStore({ rootPath: root, dataDir: path.join(root, '.lab'), deviceId: 'dev-test' });
    await store.init();
    for (const x of sends.filter((y) => y.lib === lib)) {
      await store.appendLog({ type: 'ai-send', at: new Date().toISOString(), deviceId: 'dev-test', provider: 'mock', model: 'claude-haiku-5-5', purpose: x.purpose ?? 'chat', docIds: [], folders: [], approxInputTokens: x.tokens, approxOutputTokens: 0, confirmed: true });
    }
  }
  const settings = appSettingsSchema.parse({});
  settings.ai.tokenCap.monthlyTokens = cap;
  const s = {
    log: createMemoryLogger(),
    emit: (name: string, payload: unknown) => events.push({ name, payload }),
    settings: {
      get: async () => structuredClone(settings),
      update: async (fn: (c: typeof settings) => void) => fn(settings),
    },
    libraries: { list: async () => ({ profiles, activeLibraryId: null }), dataDir: async (id: string) => path.join(profiles.find((p) => p.id === id)!.rootPath, '.lab') },
  } as unknown as MainServices;
  return s;
}

describe('token cap', () => {
  it('counts the month of every library, leaving tool reads out', async () => {
    const s = await setup([{ lib: 'a', tokens: 100 }, { lib: 'b', tokens: 50 }, { lib: 'a', tokens: 999, purpose: 'chat:tool:read' }], 500);
    expect(await tokenUsage(s)).toMatchObject({ monthTokens: 150, tokenCap: 500, pct: 30, warnAtPct: 80 });
  });

  it('refuses before the send when the total, or the total plus the estimate, passes the cap', async () => {
    const s = await setup([{ lib: 'a', tokens: 100 }], 120);
    await assertTokenCap(s, 20);
    await expect(assertTokenCap(s, 21)).rejects.toMatchObject({ code: 'AI_TOKEN_CAP_REACHED', details: { monthTokens: 100, tokenCap: 120, estimatedTokens: 21 } });
    await noteSend(s, 'chat', 20, 0);
    await expect(assertTokenCap(s, 0)).rejects.toBeInstanceOf(AppError);
  });

  it('never refuses without a cap', async () => {
    const s = await setup([{ lib: 'a', tokens: 100 }], null);
    await assertTokenCap(s, 1e9);
  });

  it('keeps the total up to date on each send and says once when the warning level is crossed', async () => {
    const s = await setup([{ lib: 'a', tokens: 700 }], 1000);
    await tokenUsage(s);
    await noteSend(s, 'chat', 50, 0);
    await noteSend(s, 'chat', 100, 0);
    await noteSend(s, 'chat', 10, 0);
    await noteSend(s, 'chat:tool:read', 500, 0);
    expect(events.map((e) => e.payload.crossedWarn)).toEqual([false, true, false]);
    expect(events.at(-1)!.payload).toMatchObject({ monthTokens: 860, pct: 86 });
  });

  it('raising the cap lets the same request through and tells the UI', async () => {
    const s = await setup([{ lib: 'a', tokens: 100 }], 100);
    await expect(assertTokenCap(s, 5)).rejects.toMatchObject({ code: 'AI_TOKEN_CAP_REACHED' });
    expect(await setTokenCap(s, 200)).toMatchObject({ tokenCap: 200, pct: 50 });
    await assertTokenCap(s, 5);
    expect(events.at(-1)).toMatchObject({ name: 'ai:usageChanged', payload: { tokenCap: 200 } });
  });
});
