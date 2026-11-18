/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryById, HIDDEN_ROWS, PENDING_ROWS, searchSettings, SETTINGS_ENTRIES, SETTINGS_SECTIONS } from './settingsIndex';

const here = import.meta.dirname;
const locales = path.resolve(here, '../i18n/locales');
const flat = (o: Record<string, unknown>, p = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o)) typeof v === 'object' && v !== null ? flat(v as Record<string, unknown>, `${p}${k}.`, out) : (out[`${p}${k}`] = String(v));
  return out;
};
const dictionary = (lng: string) => {
  const all: Record<string, string> = {};
  const dir = path.join(locales, 'parts', lng);
  for (const f of readdirSync(dir)) Object.assign(all, flat(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))));
  return all;
};

/** The first column of the table 6.2 of the design (every setting that exists today or is new), by the names the index uses. */
const ROWS_6_2 = [
  'uiLanguage', 'appearance.theme', 'guide.welcomeSeen', 'guide.dismissedTips', 'app:info', 'firstRunDone', 'deviceId',
  'user.name', 'user.authorVariants', 'user.email', 'user.orcid', 'user.openAlexId', 'network.openAlexEmail', 'secret.openalex-api-key',
  'libraries[]', 'libraries[].rootPath', 'libraries[].dataDirName', 'activeLibraryId', 'name', 'language', 'excludedFolders',
  'scan.extensions', 'scan.nameOnlyExtensions', 'scan.pruneDeletedDays', 'scan:start', 'scan:full', 'exportPresets',
  'aiEnabledFolders', 'ai.confirmBeforeSend', 'ai.defaultModel', 'ai.defaultReasoning', 'ai.usageCap.monthlyUsd', 'ai.usageCap.confirmBatchAboveUsd',
  'ai.models', 'ai.models.prices', 'ai.provider', 'ai.claudeCodePath', 'ai.authMode', 'secret.anthropic-api-key', 'ai:status', 'ai:log', 'ai:usage', 'secret.gemini-api-key',
  'mcp.enabled', 'mcp.writeEnabled', 'mcp.port', 'mcp.copy', 'mcp.rotateToken', 'mcp.log',
  'backup.destination', 'backup.auto', 'backup.keep', 'backup.includeLocal', 'backup:create', 'restore', 'backup.list', 'shortcuts[]', 'maintenance', 'limits',
  ...HIDDEN_ROWS,
  ...PENDING_ROWS,
];

describe('settingsIndex', () => {
  it('makes every row of the map 6.2 reachable (or says why it is not)', () => {
    const covered = new Set(SETTINGS_ENTRIES.flatMap((e) => e.covers));
    const missing = ROWS_6_2.filter((r) => !covered.has(r) && !(HIDDEN_ROWS as readonly string[]).includes(r) && !(PENDING_ROWS as readonly string[]).includes(r));
    expect(missing).toEqual([]);
    // Nothing is claimed that the map does not have.
    expect([...covered].filter((c) => !ROWS_6_2.includes(c))).toEqual([]);
  });

  it('has unique ids and known sections, and puts the technical ones in Advanced under a group', () => {
    expect(new Set(SETTINGS_ENTRIES.map((e) => e.id)).size).toBe(SETTINGS_ENTRIES.length);
    for (const e of SETTINGS_ENTRIES) {
      expect(SETTINGS_SECTIONS).toContain(e.section);
      if (e.section === 'advanced' && !e.id.startsWith('secret')) expect(e.fold, e.id).toBeTruthy();
      if (e.section !== 'advanced') expect(e.fold === undefined || e.id === 'aiLog', e.id).toBe(true);
    }
  });

  it('has a control with the same id in the sections (sid, data-set or fold), so a search always lands somewhere', () => {
    const files = readdirSync(here).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
    const source = files.map((f) => readFileSync(path.join(here, f), 'utf8')).join('\n');
    const missing = SETTINGS_ENTRIES.filter((e) => !new RegExp(`(?:sid|data-set|fold)=["']${e.id}["']|sid: ['"]${e.id}['"]`).test(source)).map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it.each(['en', 'it'])('has a label, a group and a section name in %s', (lng) => {
    const d = dictionary(lng);
    for (const e of SETTINGS_ENTRIES) {
      expect(d[`settings.ix.${e.id}`], `${lng} ix.${e.id}`).toMatch(/^[^|]+\|/);
      expect(d[`settings.grp.${e.group}`], `${lng} grp.${e.group}`).toBeTruthy();
    }
    for (const s of SETTINGS_SECTIONS) expect(d[`settings.sec.${s}`], `${lng} sec.${s}`).toBeTruthy();
  });

  it('searches the labels and synonyms of the language, ignoring case and accents', () => {
    const t = (lng: string) => {
      const d = dictionary(lng);
      return (k: string) => d[k] ?? k;
    };
    expect(searchSettings('budget', t('en')).map((m) => m.entry.id)).toContain('monthlyCap');
    expect(searchSettings('MONTHLY cap', t('en'))[0]?.entry.id).toBe('monthlyCap');
    expect(searchSettings('modalità', t('it')).map((m) => m.entry.id)).toContain('authMode');
    expect(searchSettings('modalita', t('it')).map((m) => m.entry.id)).toContain('authMode');
    expect(searchSettings('zzzz', t('en'))).toEqual([]);
    expect(searchSettings('   ', t('en'))).toEqual([]);
    const hit = searchSettings('rebuild index', t('en'))[0]!;
    expect(hit.where).toBe('Developer / Advanced › Scan');
    expect(entryById(hit.entry.id)?.fold).toBe('scan');
  });
});
