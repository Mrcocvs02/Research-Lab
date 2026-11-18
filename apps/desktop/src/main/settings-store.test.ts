import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLogger } from '@rl/core';
import { SettingsStore } from './settings-store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-settings-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('language of a first run (D-357)', () => {
  const first = async (locale?: string) => {
    const s = (await SettingsStore.forDir(dir, createMemoryLogger(), locale).get()).uiLanguage;
    // The choice is written: a later start with another system language keeps it.
    expect(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).uiLanguage).toBe(s);
    return s;
  };
  it('an English system starts in English', async () => expect(await first('en-US')).toBe('en'));
  it('an Italian system starts in Italian', async () => expect(await first('it-IT')).toBe('it'));
  it('any other system starts in English', async () => expect(await first('de')).toBe('en'));
  it('without a locale the schema default stays', async () => expect(await first()).toBe('it'));
  it('an existing file is not touched by the system language', async () => {
    await first('it-IT');
    expect((await SettingsStore.forDir(dir, createMemoryLogger(), 'en-US').get()).uiLanguage).toBe('it');
  });
});
