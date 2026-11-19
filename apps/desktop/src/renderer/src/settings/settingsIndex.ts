/**
 * The index of the settings (4.6, 6.2): every setting a user can reach, with the section it lives in, its group, the Advanced
 * group to open (`fold`) and the rows of the old-to-new map of the design (6.2) it makes reachable (`covers`). The page search
 * and the command palette read it; the texts come from the `settings` strings (`ix.<id>`: "Label|synonyms", `sec.<section>`,
 * `grp.<group>`). The rows of the page carry the same ids (`sid`), a test keeps the two in step. No React here: the palette imports it.
 */
export const SETTINGS_SECTIONS = ['general', 'profile', 'library', 'claude', 'backup', 'shortcuts', 'advanced'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsEntry {
  /** Id of the row (`data-set`) or of the group (`data-fold`) the entry points at. */
  id: string;
  section: SettingsSectionId;
  /** Group inside the section, for "Section › Group" (`settings.grp.<group>`). */
  group: string;
  /** Advanced only: the group (`<details>`) that holds the control; it is opened when the entry is chosen. */
  fold?: string;
  /** Rows of 6.2 (fields, channels, preferences) this control makes reachable. */
  covers: readonly string[];
}

const e = (id: string, section: SettingsSectionId, group: string, covers: readonly string[], fold?: string): SettingsEntry => (fold ? { id, section, group, covers, fold } : { id, section, group, covers });

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  e('uiLanguage', 'general', 'interface', ['uiLanguage']),
  e('theme', 'general', 'interface', ['appearance.theme']),
  e('tips', 'general', 'interface', ['guide.welcomeSeen', 'guide.dismissedTips']),
  e('about', 'general', 'about', ['app:info']),
  e('userName', 'profile', 'you', ['user.name']),
  e('userVariants', 'profile', 'you', ['user.authorVariants']),
  e('userEmail', 'profile', 'you', ['user.email']),
  e('userOrcid', 'profile', 'you', ['user.orcid']),
  e('userOpenAlexId', 'profile', 'you', ['user.openAlexId']),
  e('openAlexEmail', 'profile', 'online', ['network.openAlexEmail']),
  e('libraries', 'library', 'libraries', ['libraries[]', 'libraries[].rootPath', 'activeLibraryId']),
  e('libraryName', 'library', 'thisOne', ['name']),
  e('libraryLanguage', 'library', 'thisOne', ['language']),
  e('excludedFolders', 'library', 'thisOne', ['excludedFolders']),
  e('scanNow', 'library', 'thisOne', ['scan:start']),
  e('annotWrite', 'library', 'annotations', ['annotations.writeToPdf']),
  e('annotMigrate', 'library', 'annotations', []),
  e('annotAuthor', 'library', 'annotations', ['annotations.author']),
  e('annotBackupLocation', 'library', 'annotations', ['annotations.backupLocation']),
  e('annotCopies', 'library', 'annotations', ['annotations.copies', 'pdfMode']),
  e('colorMeanings', 'library', 'annotations', []),
  e('noteTemplates', 'library', 'notes', []),
  e('authMode', 'claude', 'account', ['ai.authMode']),
  e('account', 'claude', 'account', ['ai:status']),
  e('secretAnthropic', 'claude', 'account', ['secret.anthropic-api-key']),
  e('usage', 'claude', 'account', ['ai:usage']),
  e('tokenCap', 'claude', 'account', ['ai.tokenCap.monthlyTokens', 'ai:tokenUsage']),
  e('aiFolders', 'claude', 'reads', ['aiEnabledFolders']),
  e('defaultModel', 'claude', 'spend', ['ai.defaultModel']),
  e('defaultReasoning', 'claude', 'spend', ['ai.defaultReasoning']),
  e('monthlyCap', 'claude', 'spend', ['ai.usageCap.monthlyUsd']),
  e('confirmBeforeSend', 'claude', 'spend', ['ai.confirmBeforeSend']),
  e('costThreshold', 'claude', 'spend', []),
  e('dailyTokenCap', 'claude', 'spend', []),
  e('aiLog', 'claude', 'log', ['ai:log'], 'aiLog'),
  e('backupDestination', 'backup', 'destination', ['backup.destination']),
  e('backupAuto', 'backup', 'schedule', ['backup.auto']),
  e('backupNow', 'backup', 'schedule', ['backup:create']),
  e('backupList', 'backup', 'list', ['backup.list', 'restore']),
  e('backupKeep', 'backup', 'options', ['backup.keep']),
  e('backupLocal', 'backup', 'options', ['backup.includeLocal']),
  e('shortcuts', 'shortcuts', 'keys', ['shortcuts[]']),
  e('secretOpenAlex', 'advanced', 'keys', ['secret.openalex-api-key']),
  e('secretGemini', 'advanced', 'keys', ['secret.gemini-api-key']),
  e('claudeProvider', 'advanced', 'claude', ['ai.provider'], 'claude'),
  e('claudeExe', 'advanced', 'claude', ['ai.claudeCodePath'], 'claude'),
  e('claudeModels', 'advanced', 'claude', ['ai.models', 'ai.models.prices'], 'claude'),
  e('batchConfirm', 'advanced', 'claude', ['ai.usageCap.confirmBatchAboveUsd'], 'claude'),
  e('mcpEnable', 'advanced', 'mcp', ['mcp.enabled'], 'mcp'),
  e('mcpWrite', 'advanced', 'mcp', ['mcp.writeEnabled'], 'mcp'),
  e('mcpPort', 'advanced', 'mcp', ['mcp.port'], 'mcp'),
  e('mcpCopy', 'advanced', 'mcp', ['mcp.copy'], 'mcp'),
  e('mcpRotate', 'advanced', 'mcp', ['mcp.rotateToken'], 'mcp'),
  e('mcpLog', 'advanced', 'mcp', ['mcp.log'], 'mcp'),
  e('scanExtensions', 'advanced', 'scan', ['scan.extensions'], 'scan'),
  e('scanNameOnly', 'advanced', 'scan', ['scan.nameOnlyExtensions'], 'scan'),
  e('scanPrune', 'advanced', 'scan', ['scan.pruneDeletedDays'], 'scan'),
  e('dataDirName', 'advanced', 'scan', ['libraries[].dataDirName'], 'scan'),
  e('indexRebuild', 'advanced', 'scan', ['scan:full'], 'scan'),
  e('exportPresets', 'advanced', 'export', ['exportPresets'], 'export'),
  e('deviceId', 'advanced', 'maintenance', ['deviceId'], 'maintenance'),
  e('maintenance', 'advanced', 'maintenance', ['maintenance', 'limits'], 'maintenance'),
];

/** 6.2 rows with no control by design (internal or environment): they are not in the index. */
export const HIDDEN_ROWS = ['firstRunDone', 'RL_* variables', 'rl.libraryView', 'rl.libraryTab', 'rl.chatOpen', 'rl.readerSide', 'rl.paletteRecent', 'rl.detailOpen', 'rl.readerTool'] as const;

/** 6.2 rows whose controls belong to a later task: none left (the PDF annotations group of the library section, G4a). */
export const PENDING_ROWS: readonly string[] = [];

export const entryById = (id: string): SettingsEntry | undefined => SETTINGS_ENTRIES.find((x) => x.id === id);

type T = (key: string) => string;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface SettingsMatch {
  entry: SettingsEntry;
  label: string;
  /** "Section › Group". */
  where: string;
}

/** The text of an entry: its label and its synonyms (`ix.<id>` is "Label|synonyms"). */
export function entryText(entry: SettingsEntry, t: T): { label: string; synonyms: string } {
  const [label = '', synonyms = ''] = t(`settings.ix.${entry.id}`).split('|');
  return { label, synonyms };
}

/** Entries matching every word of `query` in the label, the synonyms, the section or the group; label matches first. */
export function searchSettings(query: string, t: T, limit = 8): SettingsMatch[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: Array<SettingsMatch & { score: number }> = [];
  for (const entry of SETTINGS_ENTRIES) {
    const { label, synonyms } = entryText(entry, t);
    const section = t(`settings.sec.${entry.section}`);
    const group = t(`settings.grp.${entry.group}`);
    const hay = fold(`${label} ${synonyms} ${section} ${group}`);
    if (!words.every((w) => hay.includes(w))) continue;
    const l = fold(label);
    const score = words.every((w) => l.startsWith(w) || l.includes(` ${w}`)) ? 0 : words.every((w) => l.includes(w)) ? 1 : 2;
    scored.push({ entry, label, where: `${section} › ${group}`, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(({ score: _s, ...m }) => m);
}
