import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { libraryConfigSchema, type LibraryConfig, type ModelConfig, type ReasoningLevel } from '@rl/core';
import { FolderTree, type FolderEntry } from '../components/FolderTree';
import { CheckField, ErrorNote, SelectField, TextField } from '../components/ui';
import { errorMessage, issuesFromError } from '../lib/errors';
import { rl } from '../lib/rl';
import { validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';
import type { AiStatus } from '../views/chat/useChat';
import { AiLog } from './AiLog';

/** The secret the Claude provider reads when there is no Claude Code login. Its value never comes back here. */
const API_KEY = 'anthropic-api-key';

interface Draft {
  aiFolders: string[];
  models: ModelConfig[];
  defaultModel: string;
  defaultReasoning: ReasoningLevel;
  monthlyUsd: string;
  confirmBatchAboveUsd: string;
  confirmBeforeSend: boolean;
}

const toDraft = (c: LibraryConfig): Draft => ({
  aiFolders: c.aiEnabledFolders,
  models: c.ai.models,
  defaultModel: c.ai.defaultModel,
  defaultReasoning: c.ai.defaultReasoning,
  monthlyUsd: c.ai.usageCap.monthlyUsd === null ? '' : String(c.ai.usageCap.monthlyUsd),
  confirmBatchAboveUsd: String(c.ai.usageCap.confirmBatchAboveUsd),
  confirmBeforeSend: c.ai.confirmBeforeSend,
});

/** The full candidate config the core schema validates (the patch is taken from it). */
function toCandidate(base: LibraryConfig, d: Draft): unknown {
  const monthly = d.monthlyUsd.trim();
  return {
    ...base,
    aiEnabledFolders: d.aiFolders,
    ai: {
      ...base.ai,
      models: d.models,
      defaultModel: d.defaultModel,
      defaultReasoning: d.defaultReasoning,
      confirmBeforeSend: d.confirmBeforeSend,
      usageCap: {
        monthlyUsd: monthly === '' ? null : Number(monthly),
        confirmBatchAboveUsd: d.confirmBatchAboveUsd.trim() === '' ? Number.NaN : Number(d.confirmBatchAboveUsd),
      },
    },
  };
}

/** The Claude Code executable the provider runs: where it was found, "Choose…" (dialog of the main process) and "Automatic". */
function ExecutableRow({ info, onChanged }: { info: NonNullable<AiStatus['claudeCode']>; onChanged(): void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <>
      <dt>{t('settings.ai.exe.label')}</dt>
      <dd data-testid="ai-exe" data-source={info.source}>
        {info.path === null ? (
          <span data-testid="ai-exe-path">{t('settings.ai.exe.notFound')}</span>
        ) : (
          <>
            <code data-testid="ai-exe-path">{info.path}</code>{' '}
            <span className="hint" data-testid="ai-exe-source">
              ({t(`settings.ai.exe.source_${info.source}`)})
            </span>
          </>
        )}
        <span className="actions start">
          <button type="button" onClick={() => void run(() => rl.invoke('ai:chooseExecutable', {}))} data-testid="ai-exe-choose">
            {t('settings.ai.exe.choose')}
          </button>
          <button type="button" disabled={info.source !== 'settings'} onClick={() => void run(() => rl.invoke('ai:clearExecutable', {}))} data-testid="ai-exe-auto">
            {t('settings.ai.exe.auto')}
          </button>
        </span>
        {error ? <ErrorNote testId="ai-exe-error">{errorMessage(error, t)}</ErrorNote> : null}
      </dd>
    </>
  );
}

function StatusBlock({ onChecked }: { onChecked(): void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const check = useCallback(async () => {
    setError(null);
    try {
      setStatus(await rl.invoke('ai:status', {}));
    } catch (e) {
      setError(e);
    }
    onChecked();
  }, [onChecked]);
  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="group" data-testid="ai-status">
      <h3>{t('settings.ai.statusTitle')}</h3>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {!status && !error && <p className="hint">{t('common.loading')}</p>}
      {status && (
        <dl className="facts">
          <dt>{t('settings.ai.provider')}</dt>
          <dd data-testid="ai-provider">{t(`settings.ai.providers.${status.provider}`)}</dd>
          <dt>{t('settings.ai.access')}</dt>
          <dd data-testid="ai-access">{t(`settings.ai.auth.${status.auth}`)}</dd>
          {status.claudeCode && <ExecutableRow info={status.claudeCode} onChanged={() => void check()} />}
          <dd>
            <span className={status.available ? 'badge ok' : 'badge'} data-testid="ai-available">
              {status.available ? t('settings.ai.available') : `${t('settings.ai.notAvailable')}${status.reason ? `: ${t(`settings.ai.reason.${status.reason}`)}` : ''}`}
            </span>
          </dd>
        </dl>
      )}
      {(!status || !status.available) && <p className="hint">{t('settings.ai.help')}</p>}
      <div className="actions start">
        <button type="button" onClick={() => void check()} data-testid="ai-status-refresh">
          {t('settings.ai.refresh')}
        </button>
      </div>
    </div>
  );
}

/** The optional API key: write-only, only "stored" or "not stored" is ever shown. */
function ApiKeyBlock() {
  const { t } = useTranslation();
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const [stored, setStored] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  const scope = useMemo(() => (libraryId ? ({ kind: 'library', libraryId } as const) : null), [libraryId]);

  const reload = useCallback(async () => {
    if (!scope) return;
    try {
      setStored((await rl.invoke('secrets:has', { scope, name: API_KEY })).exists);
    } catch (e) {
      setError(e);
    }
  }, [scope]);
  useEffect(() => {
    setValue('');
    void reload();
  }, [reload]);

  if (!scope) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setValue('');
      await reload();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="group" data-testid="ai-apikey">
      <h3>{t('settings.ai.apiKey.title')}</h3>
      <p className="hint">{t('settings.ai.apiKey.hint')}</p>
      <div className="secret-head">
        <label htmlFor="ai-apikey-input">{t('settings.ai.apiKey.label')}</label>
        <span className={stored ? 'badge ok' : 'badge'} data-testid="ai-apikey-status">
          {stored ? t('settings.ai.apiKey.stored') : t('settings.ai.apiKey.notStored')}
        </span>
      </div>
      <div className="inline-form">
        <input
          id="ai-apikey-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={stored ? t('settings.ai.apiKey.replacePlaceholder') : t('settings.ai.apiKey.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          data-testid="ai-apikey-input"
        />
        <button type="button" className="primary" disabled={!value} onClick={() => void run(() => rl.invoke('secrets:set', { scope, name: API_KEY, value }))} data-testid="ai-apikey-store">
          {t('settings.ai.apiKey.store')}
        </button>
        <button type="button" disabled={!stored} onClick={() => void run(() => rl.invoke('secrets:delete', { scope, name: API_KEY }))} data-testid="ai-apikey-remove">
          {t('settings.ai.apiKey.remove')}
        </button>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
    </div>
  );
}

/**
 * AI settings (lazy chunk): status and access, the folders whose documents may be sent (none by default), models and
 * defaults, the monthly cap, the optional API key and the log of what was sent.
 */
export function AiSection() {
  const { t } = useTranslation();
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const config = app.config;
  const [draft, setDraft] = useState<Draft | null>(config ? toDraft(config) : null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [logKey, setLogKey] = useState(0);
  // The config that our own save produced comes back through `app.refresh()`: it must not hide the "Saved" note.
  const ownSave = useRef(false);

  useEffect(() => {
    setDraft(config ? toDraft(config) : null);
    if (ownSave.current) ownSave.current = false;
    else setSaved(false);
  }, [config, libraryId]);

  const check = useMemo(() => {
    if (!config || !draft) return { data: null, errors: {} as Record<string, string> };
    return validateWith(libraryConfigSchema, toCandidate(config, draft));
  }, [config, draft]);
  const serverIssues = useMemo(() => (error ? issuesFromError(error) : {}), [error]);
  const onChecked = useCallback(() => setLogKey((k) => k + 1), []);

  const loadFolders = useCallback(
    async (parent: string): Promise<FolderEntry[]> => {
      if (!libraryId) return [];
      return (await rl.invoke('library:listFolders', { libraryId, ...(parent ? { parent } : {}) })).folders;
    },
    [libraryId],
  );

  if (!libraryId) {
    return (
      <section className="card" aria-labelledby="settings-ai">
        <h2 id="settings-ai">{t('settings.ai.title')}</h2>
        <p className="hint">{t('settings.needsLibrary')}</p>
      </section>
    );
  }
  if (!config || !draft) {
    return (
      <section className="card" aria-labelledby="settings-ai">
        <h2 id="settings-ai">{t('settings.ai.title')}</h2>
        <ErrorNote>{t('settings.library.unreadable')}</ErrorNote>
      </section>
    );
  }

  const allLibrary = draft.aiFolders.includes('');
  const err = (path: string) => (check.errors[path] || serverIssues[path] ? t(validationKey(path)) : undefined);
  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const setModel = (i: number, patch: Partial<ModelConfig>) => edit({ models: draft.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  const save = async () => {
    if (!check.data) return;
    setError(null);
    try {
      await rl.invoke('library:setConfig', { libraryId, patch: { aiEnabledFolders: check.data.aiEnabledFolders, ai: check.data.ai } });
      ownSave.current = true;
      await app.refresh();
      setSaved(true);
      setLogKey((k) => k + 1);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="card" aria-labelledby="settings-ai" data-testid="ai-settings">
      <h2 id="settings-ai">{t('settings.ai.title')}</h2>
      <p className="hint">{t('settings.ai.intro')}</p>

      <StatusBlock onChecked={onChecked} />

      <div className="group">
        <h3>{t('settings.library.aiFolders')}</h3>
        <p className="hint">{t('settings.library.aiFoldersHint')}</p>
        <p className={draft.aiFolders.length === 0 ? 'callout' : 'hint'} role="status" data-testid="ai-folders-summary">
          {draft.aiFolders.length === 0 ? t('settings.ai.nothingSent') : t('settings.ai.foldersEnabled', { count: draft.aiFolders.length })}
        </p>
        <div className="ai-roots" data-testid="ai-roots">
          <CheckField label={t('settings.ai.rootAll')} hint={t('settings.ai.rootAllHint')} checked={allLibrary} onChange={(e) => edit({ aiFolders: e.target.checked ? [''] : [] })} data-testid="ai-root-all" />
          <CheckField
            label={t('settings.ai.rootFiles')}
            hint={t('settings.ai.rootFilesHint')}
            checked={allLibrary || draft.aiFolders.includes('.')}
            disabled={allLibrary}
            onChange={(e) => edit({ aiFolders: e.target.checked ? [...draft.aiFolders, '.'].sort() : draft.aiFolders.filter((f) => f !== '.') })}
            data-testid="ai-root-files"
          />
        </div>
        <FolderTree load={loadFolders} value={draft.aiFolders} onChange={(v) => edit({ aiFolders: v })} ariaLabel={t('settings.library.aiFolders')} testId="config-ai-tree" allIncluded={allLibrary} />
        <CheckField label={t('settings.library.confirmBeforeSend')} checked={draft.confirmBeforeSend} onChange={(e) => edit({ confirmBeforeSend: e.target.checked })} />
      </div>

      <div className="group">
        <h3>{t('settings.ai.modelsTitle')}</h3>
        {err('ai.models') && <ErrorNote>{err('ai.models')}</ErrorNote>}
        <ul className="rows">
          {draft.models.map((m, i) => (
            <li key={i} className="row-fields">
              <TextField label={t('settings.library.modelId')} value={m.id} error={err(`ai.models.${i}.id`)} onChange={(e) => setModel(i, { id: e.target.value })} />
              <TextField label={t('settings.library.modelLabel')} value={m.label} error={err(`ai.models.${i}.label`)} onChange={(e) => setModel(i, { label: e.target.value })} />
              <button type="button" onClick={() => edit({ models: draft.models.filter((_, j) => j !== i) })} disabled={draft.models.length <= 1} aria-label={t('settings.library.removeModel', { name: m.label || m.id })}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="actions start">
          <button type="button" onClick={() => edit({ models: [...draft.models, { id: '', label: '' }] })}>
            {t('settings.library.addModel')}
          </button>
        </div>
        <div className="two-col">
          <SelectField label={t('settings.library.defaultModel')} value={draft.defaultModel} error={err('ai.defaultModel')} onChange={(e) => edit({ defaultModel: e.target.value })}>
            {!draft.models.some((m) => m.id === draft.defaultModel) && <option value={draft.defaultModel}>{draft.defaultModel}</option>}
            {draft.models
              .filter((m) => m.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
          </SelectField>
          <SelectField label={t('settings.library.reasoning')} value={draft.defaultReasoning} onChange={(e) => edit({ defaultReasoning: e.target.value as ReasoningLevel })}>
            <option value="low">{t('settings.library.reasoningLow')}</option>
            <option value="medium">{t('settings.library.reasoningMedium')}</option>
            <option value="high">{t('settings.library.reasoningHigh')}</option>
          </SelectField>
        </div>
        <div className="two-col">
          <TextField label={t('settings.library.monthlyCap')} hint={t('settings.library.monthlyCapHint')} inputMode="decimal" value={draft.monthlyUsd} error={err('ai.usageCap.monthlyUsd')} onChange={(e) => edit({ monthlyUsd: e.target.value })} />
          <TextField
            label={t('settings.library.batchConfirm')}
            hint={t('settings.library.batchConfirmHint')}
            inputMode="decimal"
            value={draft.confirmBatchAboveUsd}
            error={err('ai.usageCap.confirmBatchAboveUsd')}
            onChange={(e) => edit({ confirmBatchAboveUsd: e.target.value })}
          />
        </div>
      </div>

      <div className="actions start">
        <button type="button" className="primary" onClick={() => void save()} disabled={!check.data} data-testid="ai-save">
          {t('common.save')}
        </button>
        <span className="status" role="status">
          {saved ? t('common.saved') : check.data ? '' : t('common.fixErrors')}
        </span>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}

      <ApiKeyBlock />
      <AiLog reloadKey={logKey} />
    </section>
  );
}
