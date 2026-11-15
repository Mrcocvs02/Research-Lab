import { describe, expect, it } from 'vitest';
import { appSettingsPatchSchema, appSettingsSchema, defaultAppSettings, defaultLibraryConfig, libraryConfigSchema, libraryProfileSchema } from './settings.js';

describe('app settings', () => {
  it('produces sensible defaults from an empty object', () => {
    const s = defaultAppSettings();
    expect(s.uiLanguage).toBe('it');
    expect(s.libraries).toEqual([]);
    expect(s.activeLibraryId).toBeNull();
    expect(s.deviceId.length).toBeGreaterThanOrEqual(8);
    expect(s.user.authorVariants).toEqual([]);
  });

  it('validates ORCID, email and OpenAlex id', () => {
    expect(() => appSettingsSchema.parse({ user: { orcid: '0000-0002-1825-009X' } })).not.toThrow();
    expect(() => appSettingsSchema.parse({ user: { orcid: 'nope' } })).toThrow();
    expect(() => appSettingsSchema.parse({ user: { email: 'not-an-email' } })).toThrow();
    expect(() => appSettingsSchema.parse({ user: { openAlexId: 'A123' } })).not.toThrow();
    expect(() => appSettingsSchema.parse({ user: { openAlexId: 'W123' } })).toThrow();
  });

  it('rejects a data dir name that is a path', () => {
    const base = { id: 'p1', name: 'x', rootPath: 'C:\\x', createdAt: '2026-01-01T00:00:00Z' };
    expect(libraryProfileSchema.parse(base).dataDirName).toBe('.lab');
    expect(() => libraryProfileSchema.parse({ ...base, dataDirName: '../evil' })).toThrow();
    expect(() => libraryProfileSchema.parse({ ...base, dataDirName: '..' })).toThrow();
  });

  it('patch schema only allows language, user and firstRunDone', () => {
    expect(appSettingsPatchSchema.parse({ uiLanguage: 'en' })).toEqual({ uiLanguage: 'en' });
    expect(appSettingsPatchSchema.parse({ libraries: [] } as never)).toEqual({});
  });
});

describe('library config', () => {
  it('defaults: no AI folders, Haiku default, MCP read-only and off', () => {
    const c = defaultLibraryConfig();
    expect(c.aiEnabledFolders).toEqual([]);
    expect(c.ai.defaultModel).toBe('claude-haiku-5-5');
    expect(c.ai.models.map((m) => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(c.ai.confirmBeforeSend).toBe(true);
    expect(c.mcp).toEqual({ enabled: false, writeEnabled: false });
    expect(c.ai.usageCap.monthlyUsd).toBeNull();
  });

  it('does not share default model arrays between instances', () => {
    const a = defaultLibraryConfig();
    a.ai.models.push({ id: 'x', label: 'X' });
    expect(defaultLibraryConfig().ai.models).toHaveLength(2);
  });

  it('refuses a default model that is not in the list', () => {
    expect(() => libraryConfigSchema.parse({ ai: { defaultModel: 'ghost' } })).toThrow();
  });

  it('refuses absolute or traversing folders', () => {
    expect(() => libraryConfigSchema.parse({ excludedFolders: ['C:/x'] })).toThrow();
    expect(() => libraryConfigSchema.parse({ aiEnabledFolders: ['../x'] })).toThrow();
    expect(libraryConfigSchema.parse({ aiEnabledFolders: ['a/b'] }).aiEnabledFolders).toEqual(['a/b']);
  });

  it('has no place for an absolute root path', () => {
    const parsed = libraryConfigSchema.parse({ rootPath: 'C:\\secret' });
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });
});
