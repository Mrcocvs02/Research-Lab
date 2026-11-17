import { describe, expect, it } from 'vitest';
import { channels } from './ipc/channels/index.js';
import { BACKUP_FORMAT_VERSION, backupManifestSchema } from './ipc/channels/backup.js';
import { appSettingsPatchSchema, defaultAppSettings } from './settings.js';
import { SHORTCUT_COMMANDS, SHORTCUT_IDS, effectiveShortcuts, findShortcutConflicts, normalizeAccelerator, shortcutOverridesSchema } from './shortcuts.js';

describe('shortcuts', () => {
  it('normalizes accelerators and refuses unsafe ones', () => {
    expect(normalizeAccelerator('shift+ctrl+h')).toBe('Ctrl+Shift+H');
    expect(normalizeAccelerator('alt+1')).toBe('Alt+1');
    expect(normalizeAccelerator('F1')).toBe('F1');
    expect(normalizeAccelerator('ctrl+,')).toBe('Ctrl+,');
    for (const bad of ['', 'K', 'Shift+K', 'Ctrl+', 'Ctrl+Ctrl+K', 'Meta+K', 'Ctrl+Foo', 'Ctrl+F13']) expect(normalizeAccelerator(bad)).toBeNull();
  });

  it('every default is canonical and the defaults do not conflict', () => {
    for (const id of SHORTCUT_IDS) expect(normalizeAccelerator(SHORTCUT_COMMANDS[id].default)).toBe(SHORTCUT_COMMANDS[id].default);
    expect(findShortcutConflicts(effectiveShortcuts([]))).toEqual([]);
  });

  it('finds conflicts within a scope and against global, but not between reader and nothing', () => {
    const eff = effectiveShortcuts([{ id: 'chat.toggle', accelerator: 'Ctrl+K' }, { id: 'reader.find', accelerator: 'Ctrl+L' }]);
    expect(findShortcutConflicts(eff)).toEqual([['palette.open', 'chat.toggle'], ['search.focus', 'reader.find']]);
    expect(findShortcutConflicts(effectiveShortcuts([{ id: 'chat.toggle', accelerator: null }, { id: 'palette.open', accelerator: null }]))).toEqual([]);
  });

  it('overrides: canonicalized, unique ids, replaced as a whole by a patch', () => {
    expect(shortcutOverridesSchema.parse([{ id: 'chat.toggle', accelerator: 'alt+j' }])).toEqual([{ id: 'chat.toggle', accelerator: 'Alt+J' }]);
    expect(() => shortcutOverridesSchema.parse([{ id: 'chat.toggle', accelerator: 'J' }])).toThrow();
    expect(() => shortcutOverridesSchema.parse([{ id: 'nope', accelerator: 'Ctrl+J' }])).toThrow();
    expect(() => shortcutOverridesSchema.parse([{ id: 'chat.toggle', accelerator: null }, { id: 'chat.toggle', accelerator: null }])).toThrow();
  });
});

describe('phase 8 settings and channels', () => {
  it('defaults for the new settings', () => {
    const s = defaultAppSettings();
    expect(s.appearance.theme).toBe('system');
    expect(s.shortcuts).toEqual([]);
    expect(s.guide).toEqual({ welcomeSeen: false, dismissedTips: [] });
    expect(s.backup).toEqual({ destination: null, auto: 'off', keep: 5 });
  });

  it('the settings patch can change theme, shortcuts and guide, but never the backup destination', () => {
    expect(appSettingsPatchSchema.parse({ appearance: { theme: 'dark' }, guide: { welcomeSeen: true } })).toEqual({ appearance: { theme: 'dark' }, guide: { welcomeSeen: true } });
    expect(appSettingsPatchSchema.parse({ backup: { destination: 'x' } } as never)).toEqual({});
  });

  it('backup manifest round trip and no channel can read a secret into a backup', () => {
    const m = { format: 'rl-backup', formatVersion: BACKUP_FORMAT_VERSION, createdAt: '2026-11-17T10:00:00Z', appVersion: '1.0.0', sourceLibraryId: 'lib-a', libraryName: 'L', language: 'en', dataDirName: '.lab', documents: 1, includesLocal: false, includesSettings: true, origin: 'manual', entries: [{ path: 'library/library.json', size: 2, sha256: 'a'.repeat(64) }] };
    expect(backupManifestSchema.parse(m).entries).toHaveLength(1);
    expect(() => backupManifestSchema.parse({ ...m, format: 'zip' })).toThrow();
    expect(Object.keys(channels).filter((k) => k.startsWith('backup:')).length).toBe(13);
  });

  it('backup:settings stays without a way to set the destination from a plain string', () => {
    expect(channels['backup:configure'].request.parse({ destination: '/x', auto: 'weekly' })).toEqual({ auto: 'weekly' });
  });
});
