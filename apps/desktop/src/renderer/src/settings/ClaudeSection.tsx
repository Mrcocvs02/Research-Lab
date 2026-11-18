import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReasoningLevel } from '@rl/core';
import { CheckField } from '../components/ui';
import { FolderTree, type FolderEntry } from '../components/FolderTree';
import { Switch } from '../components/Switch';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { AccountCard } from './AccountCard';
import { AiLog } from './AiLog';
import { Fold, Group, NeedsLibrary, Row, SectionHead, TextRow, useLibraryPatch } from './rows';
import { useAutoSave } from './useAutoSave';

/** A money amount typed by the user: empty (no cap) or a positive number; a comma counts as the decimal point. */
export const parseUsd = (v: string): number | null | undefined => {
  const s = v.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Claude (6.1): the account, which folders Claude may read, the default model and the spending limits, and the log of what was sent. */
export function ClaudeSection() {
  const { t } = useTranslation();
  const app = useApp();
  const config = app.config;
  const libraryId = app.activeLibraryId;
  const patch = useLibraryPatch();
  const folders = useAutoSave();
  const model = useAutoSave();
  const reasoning = useAutoSave();
  const confirm = useAutoSave();
  const loadFolders = useCallback(
    async (parent: string): Promise<FolderEntry[]> => (libraryId ? (await rl.invoke('library:listFolders', { libraryId, ...(parent ? { parent } : {}) })).folders : []),
    [libraryId],
  );
  const enabled = config?.aiEnabledFolders ?? [];
  const allLibrary = enabled.includes('');
  const setFolders = (v: string[]) => void folders.run(() => patch({ aiEnabledFolders: v }));

  return (
    <div data-testid="ai-settings">
      <SectionHead title={t('settings.claude.title')} intro={t('settings.claude.intro')} />
      <AccountCard />
      <Group title={t('settings.claude.reads')} testId="ai-folders">
        {!config ? (
          <NeedsLibrary />
        ) : (
          <Row sid="aiFolders" label={t('settings.library.aiFolders')} help={t('settings.library.aiFoldersHint')} save={folders}>
            <div className="srow__tree">
              <p className={enabled.length === 0 ? 'callout' : 'set-help'} role="status" data-testid="ai-folders-summary">
                {enabled.length === 0 ? t('settings.ai.nothingSent') : t('settings.ai.foldersEnabled', { count: enabled.length })}
              </p>
              <div data-testid="ai-roots">
                <CheckField label={t('settings.ai.rootAll')} hint={t('settings.ai.rootAllHint')} checked={allLibrary} onChange={(e) => setFolders(e.target.checked ? [''] : [])} data-testid="ai-root-all" />
                <CheckField
                  label={t('settings.ai.rootFiles')}
                  hint={t('settings.ai.rootFilesHint')}
                  checked={allLibrary || enabled.includes('.')}
                  disabled={allLibrary}
                  onChange={(e) => setFolders(e.target.checked ? [...enabled, '.'].sort() : enabled.filter((f) => f !== '.'))}
                  data-testid="ai-root-files"
                />
              </div>
              <FolderTree load={loadFolders} value={enabled} onChange={setFolders} ariaLabel={t('settings.library.aiFolders')} testId="config-ai-tree" allIncluded={allLibrary} />
            </div>
          </Row>
        )}
      </Group>
      <Group title={t('settings.claude.spend')} testId="ai-spend">
        {!config ? (
          <NeedsLibrary />
        ) : (
          <>
            <Row sid="defaultModel" label={t('settings.library.defaultModel')} htmlFor="ai-model" save={model}>
              <select id="ai-model" value={config.ai.defaultModel} onChange={(e) => void model.run(() => patch({ ai: { defaultModel: e.target.value } }))} data-testid="ai-default-model">
                {!config.ai.models.some((m) => m.id === config.ai.defaultModel) && <option value={config.ai.defaultModel}>{config.ai.defaultModel}</option>}
                {config.ai.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label || m.id}
                  </option>
                ))}
              </select>
            </Row>
            <Row sid="defaultReasoning" label={t('settings.library.reasoning')} htmlFor="ai-reasoning" save={reasoning}>
              <select id="ai-reasoning" value={config.ai.defaultReasoning} onChange={(e) => void reasoning.run(() => patch({ ai: { defaultReasoning: e.target.value as ReasoningLevel } }))} data-testid="ai-default-reasoning">
                <option value="low">{t('settings.library.reasoningLow')}</option>
                <option value="medium">{t('settings.library.reasoningMedium')}</option>
                <option value="high">{t('settings.library.reasoningHigh')}</option>
              </select>
            </Row>
            <TextRow
              sid="monthlyCap"
              label={t('settings.library.monthlyCap')}
              help={t('settings.library.monthlyCapHint')}
              short
              inputMode="decimal"
              testId="ai-monthly-cap"
              value={config.ai.usageCap.monthlyUsd === null ? '' : String(config.ai.usageCap.monthlyUsd)}
              validate={(v) => (parseUsd(v) === undefined ? t('validation.monthlyUsd') : undefined)}
              commit={(v) => patch({ ai: { usageCap: { monthlyUsd: parseUsd(v) ?? null } } })}
            />
            <Row sid="confirmBeforeSend" label={t('settings.library.confirmBeforeSend')} help={t('settings.claude.confirmHelp')} save={confirm}>
              <Switch aria-label={t('settings.library.confirmBeforeSend')} checked={config.ai.confirmBeforeSend} onChange={(v) => void confirm.run(() => patch({ ai: { confirmBeforeSend: v } }))} data-testid="ai-confirm" />
            </Row>
          </>
        )}
      </Group>
      {libraryId && (
        <Group>
          <Fold fold="aiLog" title={t('settings.ai.log.title')}>
            <AiLog reloadKey={config?.name} />
          </Fold>
        </Group>
      )}
    </div>
  );
}
