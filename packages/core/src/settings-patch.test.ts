import { describe, expect, it } from 'vitest';
import { itemIdSchema } from './common.js';
import {
  appSettingsPatchSchema,
  appSettingsSchema,
  applyPatch,
  dataDirNameSchema,
  libraryConfigPatchSchema,
  libraryConfigSchema,
  libraryProfileSchema,
} from './settings.js';

/** A library.json where every field differs from its default, so a reset to default is visible. */
const customConfig = () =>
  libraryConfigSchema.parse({
    name: 'Custom',
    language: 'en',
    excludedFolders: ['skip'],
    aiEnabledFolders: ['papers'],
    ai: {
      provider: 'anthropic-api',
      models: [
        { id: 'm-small', label: 'Small' },
        { id: 'm-big', label: 'Big' },
      ],
      defaultModel: 'm-big',
      defaultReasoning: 'medium',
      usageCap: { monthlyUsd: 20, confirmBatchAboveUsd: 2 },
      confirmBeforeSend: false,
    },
    scan: { extensions: ['pdf', 'epub'], nameOnlyExtensions: ['doc'], pruneDeletedDays: 7 },
    mcp: { enabled: true, writeEnabled: false },
  });

const patchConfig = (patch: unknown) => libraryConfigSchema.parse(applyPatch(customConfig(), libraryConfigPatchSchema.parse(patch)));

describe('patch schemas carry no defaults', () => {
  it('parses to exactly what was sent', () => {
    expect(libraryConfigPatchSchema.parse({})).toEqual({});
    expect(libraryConfigPatchSchema.parse({ ai: {} })).toEqual({ ai: {} });
    expect(libraryConfigPatchSchema.parse({ ai: { usageCap: {} }, scan: {}, mcp: {} })).toEqual({ ai: { usageCap: {} }, scan: {}, mcp: {} });
    expect(appSettingsPatchSchema.parse({})).toEqual({});
    expect(appSettingsPatchSchema.parse({ user: {} })).toEqual({ user: {} });
  });
});

describe('library.json patches keep the fields they do not mention', () => {
  it('{ai:{defaultReasoning}} keeps provider, models, defaultModel, usageCap and the rest of ai', () => {
    const before = customConfig();
    const after = patchConfig({ ai: { defaultReasoning: 'high' } });
    expect(after.ai.defaultReasoning).toBe('high');
    expect(after.ai).toEqual({ ...before.ai, defaultReasoning: 'high' });
    expect(after.ai.provider).toBe('anthropic-api');
    expect(after.ai.models.map((m) => m.id)).toEqual(['m-small', 'm-big']);
    expect(after.ai.defaultModel).toBe('m-big');
    expect(after.ai.usageCap).toEqual({ monthlyUsd: 20, confirmBatchAboveUsd: 2 });
    expect(after.ai.confirmBeforeSend).toBe(false);
    expect({ ...after, ai: before.ai }).toEqual({ ...before, ai: before.ai });
  });

  it('{mcp:{writeEnabled}} keeps mcp.enabled', () => {
    expect(patchConfig({ mcp: { writeEnabled: true } }).mcp).toEqual({ enabled: true, writeEnabled: true });
  });

  it('{ai:{usageCap:{monthlyUsd}}} keeps confirmBatchAboveUsd', () => {
    expect(patchConfig({ ai: { usageCap: { monthlyUsd: 5 } } }).ai.usageCap).toEqual({ monthlyUsd: 5, confirmBatchAboveUsd: 2 });
  });

  it('{ai:{usageCap:{confirmBatchAboveUsd}}} keeps monthlyUsd, and null clears the cap on purpose', () => {
    expect(patchConfig({ ai: { usageCap: { confirmBatchAboveUsd: 9 } } }).ai.usageCap).toEqual({ monthlyUsd: 20, confirmBatchAboveUsd: 9 });
    expect(patchConfig({ ai: { usageCap: { monthlyUsd: null } } }).ai.usageCap).toEqual({ monthlyUsd: null, confirmBatchAboveUsd: 2 });
  });

  it('{scan:{pruneDeletedDays}} keeps the extensions', () => {
    expect(patchConfig({ scan: { pruneDeletedDays: 1 } }).scan).toEqual({ extensions: ['pdf', 'epub'], nameOnlyExtensions: ['doc'], pruneDeletedDays: 1 });
  });

  it('arrays are replaced as a whole, not merged', () => {
    const after = patchConfig({
      excludedFolders: ['other'],
      ai: { models: [{ id: 'only', label: 'Only' }], defaultModel: 'only' },
      scan: { extensions: ['txt'] },
    });
    expect(after.excludedFolders).toEqual(['other']);
    expect(after.ai.models).toEqual([{ id: 'only', label: 'Only' }]);
    expect(after.scan.extensions).toEqual(['txt']);
    expect(after.scan.nameOnlyExtensions).toEqual(['doc']);
    expect(after.aiEnabledFolders).toEqual(['papers']);
  });

  it('an empty patch changes nothing and top-level scalars apply', () => {
    expect(patchConfig({})).toEqual(customConfig());
    expect(patchConfig({ name: 'Renamed', language: 'it' })).toEqual({ ...customConfig(), name: 'Renamed', language: 'it' });
  });

  it('does not modify its inputs', () => {
    const base = customConfig();
    const copy = structuredClone(base);
    applyPatch(base, { ai: { usageCap: { monthlyUsd: 1 } } });
    expect(base).toEqual(copy);
  });
});

describe('settings patches keep the profile they do not mention', () => {
  const current = appSettingsSchema.parse({
    uiLanguage: 'en',
    user: { name: 'Test User', email: 'test@example.com', orcid: '0000-0002-1825-0097', openAlexId: 'A123', authorVariants: ['T. User', 'Test U.'] },
    firstRunDone: true,
  });
  const apply = (patch: unknown) => appSettingsSchema.parse(applyPatch(current, appSettingsPatchSchema.parse(patch)));

  it('{user:{name}} keeps email, orcid, openAlexId and authorVariants', () => {
    const next = apply({ user: { name: 'New Name' } });
    expect(next.user).toEqual({ ...current.user, name: 'New Name' });
  });

  it('{user:{authorVariants}} replaces the list and keeps the rest', () => {
    const next = apply({ user: { authorVariants: ['X'] } });
    expect(next.user).toEqual({ ...current.user, authorVariants: ['X'] });
  });

  it('{uiLanguage} and {firstRunDone} touch nothing else; libraries cannot be patched', () => {
    expect(apply({ uiLanguage: 'it' })).toEqual({ ...current, uiLanguage: 'it' });
    expect(apply({ firstRunDone: false })).toEqual({ ...current, firstRunDone: false });
    expect(apply({ libraries: [{ id: 'x' }] })).toEqual(current);
  });
});

describe('ids and folder names are safe file names', () => {
  it('item ids are normalised to lower case so Foo and foo are one id', () => {
    expect(itemIdSchema.parse('Foo')).toBe('foo');
    expect(itemIdSchema.parse('Foo')).toBe(itemIdSchema.parse('foo'));
    expect(itemIdSchema.parse('0F3A-Bb.9')).toBe('0f3a-bb.9');
  });

  it.each(['con', 'CON', 'Nul', 'aux', 'prn', 'com1', 'COM9', 'lpt1', 'com¹', 'LPT²', 'conin$', 'nul.txt', 'a.', 'a..', '.hidden', '-x', 'a b', 'a/b', 'a\\b', 'a:b', ''])(
    'rejects the id %j',
    (id) => expect(itemIdSchema.safeParse(id).success).toBe(false),
  );

  it.each(['console', 'com10', 'lpt-1', 'topic.sub', 'a_b-c', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'])('accepts the id %j', (id) =>
    expect(itemIdSchema.safeParse(id).success).toBe(true),
  );

  it('profile ids are normalised too', () => {
    const p = libraryProfileSchema.parse({ id: 'Lib-ABCD', name: 'x', rootPath: '/r', createdAt: '2026-01-01T00:00:00Z' });
    expect(p.id).toBe('lib-abcd');
  });

  it.each(['CON', 'nul', 'Aux.d', 'COM1', 'com²', 'LPT³', 'CONIN$', 'CONOUT$', 'lab.', 'lab ', 'a:b', 'a/b', 'a\\b', '..', '.', '', 'a\u0001b'])(
    'rejects the data folder name %j',
    (n) => expect(dataDirNameSchema.safeParse(n).success).toBe(false),
  );

  it.each(['.lab', '_data', 'Research Lab', 'lab.v2', 'console'])('accepts the data folder name %j', (n) => expect(dataDirNameSchema.safeParse(n).success).toBe(true));
});
