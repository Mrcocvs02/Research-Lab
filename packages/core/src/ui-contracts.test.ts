import { describe, expect, it } from 'vitest';
import { channels, events } from './ipc/channels/index.js';
import { SCAN_LIMITS } from './limits.js';
import { appSettingsSchema, defaultAppSettings } from './settings.js';
import {
  NAV_SIDEBAR_IDS,
  NAV_VIEW_OF,
  SHORTCUT_COMMANDS,
  SHORTCUT_IDS,
  effectiveShortcuts,
  findShortcutConflicts,
  normalizeReaderToolKey,
  shortcutOverrideSchema,
  shortcutOverridesSchema,
} from './shortcuts.js';

const docId = (n: number) => n.toString(16).padStart(16, '0');
const emptyReport = { finishedAt: null, summary: null, firstScan: false, added: [], changed: [], moved: [], missing: [], failed: [], truncated: false };

describe('defaultAppSettings({ locale }) (D-357)', () => {
  it('starts in Italian for an Italian system and in English otherwise', () => {
    expect(defaultAppSettings({ locale: 'it' }).uiLanguage).toBe('it');
    expect(defaultAppSettings({ locale: 'it-IT' }).uiLanguage).toBe('it');
    expect(defaultAppSettings({ locale: 'IT-ch' }).uiLanguage).toBe('it');
    expect(defaultAppSettings({ locale: 'en-US' }).uiLanguage).toBe('en');
    expect(defaultAppSettings({ locale: 'de' }).uiLanguage).toBe('en');
    expect(defaultAppSettings({ locale: 'ita' }).uiLanguage).toBe('en');
    expect(defaultAppSettings({ locale: '' }).uiLanguage).toBe('en');
  });
  it('keeps the schema default without a locale and stays a valid settings object', () => {
    expect(defaultAppSettings().uiLanguage).toBe('it');
    const s = defaultAppSettings({ locale: 'en-GB' });
    expect(appSettingsSchema.parse(s)).toEqual(s);
    expect(s.ai.authMode).toBe('auto');
  });
});

describe('ai.authMode', () => {
  it('accepts the three modes and refuses others', () => {
    for (const authMode of ['auto', 'claude-code', 'api-key']) expect(appSettingsSchema.parse({ ai: { authMode } }).ai.authMode).toBe(authMode);
    expect(appSettingsSchema.safeParse({ ai: { authMode: 'oauth' } }).success).toBe(false);
  });
});

describe('scope reader-tool and nav.* ids', () => {
  it('defines the tool keys of §8.2.6 in their own scope', () => {
    const keys = Object.fromEntries(SHORTCUT_IDS.filter((id) => SHORTCUT_COMMANDS[id].scope === 'reader-tool').map((id) => [id, SHORTCUT_COMMANDS[id].default]));
    expect(keys).toEqual({
      'reader.tool.select': 'V',
      'reader.tool.highlight': 'H',
      'reader.tool.underline': 'U',
      'reader.tool.crop': 'R',
      'reader.tool.eraser': 'E',
      'reader.tool.swap': 'Space',
      'reader.color.1': '1',
      'reader.color.2': '2',
      'reader.color.3': '3',
      'reader.color.4': '4',
      'reader.color.5': '5',
      'reader.comment': 'C',
      'reader.annotation.delete': 'Delete',
    });
    expect(SHORTCUT_COMMANDS['reader.close']).toEqual({ scope: 'reader', default: 'Ctrl+W' });
  });
  it('has no conflict among the defaults', () => {
    expect(findShortcutConflicts(effectiveShortcuts([]))).toEqual([]);
  });
  it('numbers the sidebar in order with Alt+1..5 and maps every nav id to a view', () => {
    expect(NAV_SIDEBAR_IDS.map((id) => SHORTCUT_COMMANDS[id].default)).toEqual(['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5']);
    expect(NAV_SIDEBAR_IDS.map((id) => NAV_VIEW_OF[id])).toEqual(['library', 'review', 'projects', 'discover', 'map']);
    expect(Object.keys(NAV_VIEW_OF).sort()).toEqual(SHORTCUT_IDS.filter((id) => id.startsWith('nav.')).sort());
  });
  it('takes a bare key for a tool and refuses it elsewhere', () => {
    expect(shortcutOverrideSchema.parse({ id: 'reader.tool.eraser', accelerator: 'x' })).toEqual({ id: 'reader.tool.eraser', accelerator: 'X' });
    expect(shortcutOverrideSchema.parse({ id: 'reader.tool.swap', accelerator: 'space' }).accelerator).toBe('Space');
    expect(shortcutOverrideSchema.parse({ id: 'reader.comment', accelerator: null }).accelerator).toBeNull();
    expect(shortcutOverrideSchema.safeParse({ id: 'reader.tool.eraser', accelerator: 'Ctrl+X' }).success).toBe(false);
    expect(shortcutOverrideSchema.safeParse({ id: 'reader.tool.eraser', accelerator: 'F5' }).success).toBe(false);
    expect(shortcutOverrideSchema.safeParse({ id: 'palette.open', accelerator: 'K' }).success).toBe(false);
    expect(shortcutOverrideSchema.parse({ id: 'palette.open', accelerator: 'ctrl+p' }).accelerator).toBe('Ctrl+P');
    expect(normalizeReaderToolKey('delete')).toBe('Delete');
    expect(normalizeReaderToolKey('Enter')).toBeNull();
    expect(normalizeReaderToolKey('ab')).toBeNull();
  });
  it('detects a clash inside the scope', () => {
    const eff = effectiveShortcuts([{ id: 'reader.tool.eraser', accelerator: 'H' }]);
    expect(findShortcutConflicts(eff)).toEqual([['reader.tool.highlight', 'reader.tool.eraser']]);
  });
  it('moves the overrides of the renamed nav ids when the settings file is read', () => {
    const s = appSettingsSchema.parse({
      shortcuts: [
        { id: 'nav.network', accelerator: 'Ctrl+M' },
        { id: 'nav.inbox', accelerator: null },
        { id: 'nav.review', accelerator: 'Alt+9' },
        { id: 'gone.command', accelerator: 'Ctrl+Q' },
      ],
    });
    expect(s.shortcuts).toEqual([
      { id: 'nav.map', accelerator: 'Ctrl+M' },
      { id: 'nav.review', accelerator: null },
    ]);
  });
  it('still refuses an unknown id in a patch (only the settings file is migrated)', () => {
    expect(shortcutOverridesSchema.safeParse([{ id: 'nav.network', accelerator: null }]).success).toBe(false);
  });
});

describe('scan:report (§9)', () => {
  const def = channels['scan:report'];
  it('accepts the empty report and a full one', () => {
    expect(def.response.parse(emptyReport)).toEqual(emptyReport);
    const full = {
      finishedAt: '2026-11-18T10:00:00.000Z',
      summary: { added: 2, changed: 1, moved: 0, missing: 1, unchanged: 10, extracted: 3, failed: 1 },
      firstScan: true,
      added: [docId(1), docId(2)],
      changed: [docId(3)],
      moved: [],
      missing: [docId(4)],
      failed: [docId(5)],
      truncated: false,
    };
    expect(def.response.parse(full)).toEqual(full);
  });
  it('caps every list at SCAN_LIMITS.reportIds', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => docId(i));
    expect(def.response.safeParse({ ...emptyReport, added: ids(SCAN_LIMITS.reportIds) }).success).toBe(true);
    expect(def.response.safeParse({ ...emptyReport, added: ids(SCAN_LIMITS.reportIds + 1) }).success).toBe(false);
  });
  it('lets the library filter on an explicit set, within the same cap', () => {
    const filters = channels['search:query'].request.shape.filters.unwrap();
    expect(filters.safeParse({ docIds: [docId(1)] }).success).toBe(true);
    expect(filters.safeParse({ docIds: Array.from({ length: SCAN_LIMITS.reportIds + 1 }, (_, i) => docId(i)) }).success).toBe(false);
  });
});

describe('badge counts (§7.1)', () => {
  it('inbox:count answers with the parts of the number', () => {
    expect(channels['inbox:count'].response.parse({ count: 3, dropped: 1, library: 2 })).toEqual({ count: 3, dropped: 1, library: 2 });
    expect(channels['inbox:count'].response.safeParse({ count: 3 }).success).toBe(false);
  });
  it('review:stats carries pendingDocs', () => {
    const pending = { tags: 0, newTags: 0, description: 0, summary: 0, keywords: 0, synonyms: 0, relations: 0 };
    const base = { pending, tags: { proposed: 0, accepted: 0, rate: null }, newTags: { proposed: 0, accepted: 0 } };
    expect(channels['review:stats'].response.safeParse({ ...base, pendingDocs: 12 }).success).toBe(true);
    expect(channels['review:stats'].response.safeParse({ ...base, pendingDocs: -1 }).success).toBe(false);
    expect(channels['review:stats'].response.safeParse(base).success).toBe(false);
  });
});

describe('Claude account channels (§10.3, §10.4)', () => {
  const account = {
    authMode: 'auto',
    effective: 'claude-code',
    apiKey: { stored: false, envVar: false },
    claudeCode: { path: '/bin/tool', source: 'path', version: '2.1.326', loggedIn: true, account: { email: 'a@example.test', plan: 'max' }, supportsAuthCommands: true },
  };
  it('describes the account and refuses a malformed one', () => {
    expect(channels['ai:account'].response.parse(account)).toEqual(account);
    const unknown = { ...account, claudeCode: { ...account.claudeCode, loggedIn: null, account: null, version: null } };
    expect(channels['ai:account'].response.safeParse(unknown).success).toBe(true);
    expect(channels['ai:account'].response.safeParse({ ...account, effective: 'oauth' }).success).toBe(false);
    expect(channels['ai:account'].response.safeParse({ ...account, apiKey: { stored: true } }).success).toBe(false);
  });
  it('takes no argument from the renderer except the auth mode', () => {
    expect(channels['ai:setAuthMode'].request.safeParse({ mode: 'api-key' }).success).toBe(true);
    expect(channels['ai:setAuthMode'].request.safeParse({ mode: 'other' }).success).toBe(false);
    for (const c of ['ai:login', 'ai:loginDone', 'ai:logout', 'ai:test', 'ai:usageAll', 'ai:account'] as const) {
      expect(channels[c].request.parse({})).toEqual({});
    }
    expect(channels['ai:login'].response.parse({ started: true })).toEqual({ started: true });
    expect(channels['ai:login'].response.safeParse({ started: false }).success).toBe(false);
  });
  it('answers a connection test with a result, not an error', () => {
    const r = channels['ai:test'].response;
    expect(r.parse({ ok: true, ms: 1200, model: 'claude-haiku-5-5', usd: 0.0004 }).ok).toBe(true);
    expect(r.parse({ ok: false, ms: 10, model: 'claude-haiku-5-5', usd: null, error: { code: 'offline' } }).error).toEqual({ code: 'offline' });
  });
  it('sums the libraries and marks the unreachable ones', () => {
    const r = channels['ai:usageAll'].response.parse({ totalUsd: 0.61, sends: 12, libraries: [{ libraryId: 'lib-00000001', usd: 0.61, reachable: true }, { libraryId: 'lib-00000002', usd: null, reachable: false }] });
    expect(r.libraries[1]?.reachable).toBe(false);
  });
  it('emits accountChanged with the account', () => {
    expect(events['ai:accountChanged'].parse(account)).toEqual(account);
  });
});
