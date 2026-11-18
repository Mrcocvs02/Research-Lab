import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MODELS, defaultLibraryConfig, exportPresetSchema, modelConfigSchema, type ExportPreset, type LibraryConfig, type LibraryConfigPatch, type McpStatus, type ModelConfig } from '@rl/core';
import { Button } from '../components/Button';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { lazyView, Lazy } from '../components/Lazy';
import { Fold, Group, NeedsLibrary, Row, SectionHead, TextRow, useLibraryPatch, useSettings } from './rows';
import { SavedKeys } from './SavedKeys';
import { useAutoSave } from './useAutoSave';

// The groups that are big modules of their own load only when opened (and with their own strings).
const McpSection = lazyView(() => import('./McpSection').then((m) => ({ default: m.McpSection })), ['mcp']);
const MaintenanceSection = lazyView(() => import('./MaintenanceSection').then((m) => ({ default: m.MaintenanceSection })), ['backup']);

const csv = (l: readonly string[]) => l.join(', ');
const parseCsv = (v: string) => [...new Set(v.split(/[\s,;]+/).map((x) => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean))];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Diff {
  id: string;
  label: string;
  reset(): Promise<unknown>;
}

/** The settings of Advanced that differ from the defaults (4.8, 6.2): pure comparison with the defaults, each with its own "Restore". */
export function advancedDiffs(config: LibraryConfig | null, claudeCodePath: string | null, mcp: McpStatus | null, t: (key: string, o?: Record<string, unknown>) => string, patch: (p: LibraryConfigPatch) => Promise<unknown>): Diff[] {
  const out: Diff[] = [];
  if (claudeCodePath !== null) out.push({ id: 'exe', label: t('settings.diff.exe'), reset: () => rl.invoke('ai:clearExecutable', {}) });
  if (mcp?.port != null) out.push({ id: 'port', label: t('settings.diff.port', { port: mcp.port }), reset: () => rl.invoke('mcp:setPort', { port: null }) });
  if (!config) return out;
  const d = defaultLibraryConfig();
  if (config.ai.provider !== d.ai.provider) out.push({ id: 'provider', label: t('settings.diff.provider'), reset: () => patch({ ai: { provider: d.ai.provider } }) });
  if (!same(config.ai.models, DEFAULT_MODELS)) out.push({ id: 'models', label: t('settings.diff.models'), reset: () => patch({ ai: { models: d.ai.models, defaultModel: d.ai.defaultModel } }) });
  if (config.ai.usageCap.confirmBatchAboveUsd !== d.ai.usageCap.confirmBatchAboveUsd) out.push({ id: 'batch', label: t('settings.diff.batch', { usd: config.ai.usageCap.confirmBatchAboveUsd }), reset: () => patch({ ai: { usageCap: { confirmBatchAboveUsd: d.ai.usageCap.confirmBatchAboveUsd } } }) });
  if (!same(config.scan.extensions, d.scan.extensions)) out.push({ id: 'ext', label: t('settings.diff.ext'), reset: () => patch({ scan: { extensions: d.scan.extensions } }) });
  if (config.scan.nameOnlyExtensions.length > 0) out.push({ id: 'nameOnly', label: t('settings.diff.nameOnly'), reset: () => patch({ scan: { nameOnlyExtensions: [] } }) });
  if (config.scan.pruneDeletedDays !== d.scan.pruneDeletedDays) out.push({ id: 'prune', label: t('settings.diff.prune', { days: config.scan.pruneDeletedDays }), reset: () => patch({ scan: { pruneDeletedDays: d.scan.pruneDeletedDays } }) });
  if (config.exportPresets.length > 0) out.push({ id: 'presets', label: t('settings.diff.presets', { count: config.exportPresets.length }), reset: () => patch({ exportPresets: [] }) });
  return out;
}

/** The Claude Code program the provider runs: where it was found, "Choose…" (a dialog of the main process) and "Automatic". */
function ExecutableRow() {
  const { t } = useTranslation();
  const { account, reloadAccount } = useSettings();
  const save = useAutoSave();
  const cc = account?.claudeCode;
  return (
    <Row sid="claudeExe" label={t('settings.ai.exe.label')} save={save}>
      <span data-testid="ai-exe" data-source={cc?.source}>
        {cc?.path ? (
          <>
            <code data-testid="ai-exe-path">{cc.path}</code> <span className="muted">({t(`settings.ai.exe.source_${cc.source}`)})</span>
          </>
        ) : (
          <span data-testid="ai-exe-path">{t('settings.ai.exe.notFound')}</span>
        )}
      </span>
      <Button size="sm" onClick={() => void save.run(async () => (await rl.invoke('ai:chooseExecutable', {}), reloadAccount()))} data-testid="ai-exe-choose">
        {t('settings.ai.exe.choose')}
      </Button>
      <Button size="sm" disabled={cc?.source !== 'settings'} onClick={() => void save.run(async () => (await rl.invoke('ai:clearExecutable', {}), reloadAccount()))} data-testid="ai-exe-auto">
        {t('settings.ai.exe.auto')}
      </Button>
    </Row>
  );
}

/** Models and their prices: edited as a table; a row that is not valid yet (a new one) is kept on screen and saved once it is. */
function ModelsEditor({ config }: { config: LibraryConfig }) {
  const { t } = useTranslation();
  const patch = useLibraryPatch();
  const save = useAutoSave();
  const [rows, setRows] = useState<ModelConfig[]>(config.ai.models);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setRows(config.ai.models), [config.ai.models]);
  const commit = (next: ModelConfig[]) => {
    setRows(next);
    const ok = next.length > 0 && next.every((m) => modelConfigSchema.safeParse(m).success);
    const hasDefault = next.some((m) => m.id === config.ai.defaultModel);
    setProblem(!ok ? (next.length === 0 ? t('validation.models') : t('validation.id')) : !hasDefault ? t('validation.defaultModel') : null);
    if (ok && hasDefault && !same(next, config.ai.models)) void save.run(() => patch({ ai: { models: next } }));
  };
  const edit = (i: number, p: Partial<ModelConfig>) => setRows(rows.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const price = (i: number, k: 'inputPerMTok' | 'outputPerMTok', v: string) => {
    const { [k]: _drop, ...rest } = rows[i]!;
    const n = Number(v.replace(',', '.'));
    edit(i, v.trim() === '' || !Number.isFinite(n) || n < 0 ? (rest as ModelConfig) : { ...rest, [k]: n });
  };
  return (
    <Row sid="claudeModels" label={t('settings.ai.modelsTitle')} help={t('settings.advanced.modelsHelp')} save={save} error={problem ?? undefined}>
      <div className="srow__tree" data-testid="ai-models">
        {rows.map((m, i) => (
          <div className="set-model" key={i} data-testid="ai-model-row">
            <input aria-label={t('settings.library.modelId')} value={m.id} placeholder={t('settings.library.modelId')} onChange={(e) => edit(i, { id: e.target.value })} onBlur={() => commit(rows)} />
            <input aria-label={t('settings.library.modelLabel')} value={m.label} placeholder={t('settings.library.modelLabel')} onChange={(e) => edit(i, { label: e.target.value })} onBlur={() => commit(rows)} />
            <input className="is-short" inputMode="decimal" aria-label={t('settings.advanced.priceIn')} placeholder={t('settings.advanced.priceIn')} value={m.inputPerMTok ?? ''} onChange={(e) => price(i, 'inputPerMTok', e.target.value)} onBlur={() => commit(rows)} />
            <input className="is-short" inputMode="decimal" aria-label={t('settings.advanced.priceOut')} placeholder={t('settings.advanced.priceOut')} value={m.outputPerMTok ?? ''} onChange={(e) => price(i, 'outputPerMTok', e.target.value)} onBlur={() => commit(rows)} />
            <Button size="sm" variant="ghost" disabled={rows.length <= 1} aria-label={t('settings.library.removeModel', { name: m.label || m.id })} onClick={() => commit(rows.filter((_, j) => j !== i))}>
              {t('common.remove')}
            </Button>
          </div>
        ))}
        <Button size="sm" onClick={() => setRows([...rows, { id: '', label: '' }])} data-testid="ai-model-add">
          {t('settings.library.addModel')}
        </Button>
      </div>
    </Row>
  );
}

function ClaudeGroup({ config }: { config: LibraryConfig }) {
  const { t } = useTranslation();
  const patch = useLibraryPatch();
  return (
    <>
      <Row sid="claudeProvider" label={t('settings.ai.provider')} help={t('settings.advanced.geminiOff')}>
        <span data-testid="ai-provider">{t(`settings.ai.providers.${config.ai.provider}`)}</span>
      </Row>
      <ExecutableRow />
      <ModelsEditor config={config} />
      <TextRow
        sid="batchConfirm"
        label={t('settings.library.batchConfirm')}
        help={t('settings.library.batchConfirmHint')}
        short
        inputMode="decimal"
        testId="ai-batch-confirm"
        value={String(config.ai.usageCap.confirmBatchAboveUsd)}
        validate={(v) => (v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) && Number(v.replace(',', '.')) >= 0 ? undefined : t('validation.confirmBatchAboveUsd'))}
        commit={(v) => patch({ ai: { usageCap: { confirmBatchAboveUsd: Number(v.replace(',', '.')) } } })}
      />
    </>
  );
}

function ScanGroup({ config, dataDirName }: { config: LibraryConfig; dataDirName: string }) {
  const { t } = useTranslation();
  const patch = useLibraryPatch();
  const rebuild = useAutoSave();
  const okExt = (v: string) => (parseCsv(v).every((x) => /^[a-z0-9]{1,10}$/.test(x)) ? undefined : t('validation.invalid'));
  return (
    <>
      <TextRow sid="scanExtensions" label={t('settings.advanced.extensions')} help={t('settings.advanced.extensionsHelp')} value={csv(config.scan.extensions)} validate={okExt} commit={(v) => patch({ scan: { extensions: parseCsv(v) } })} testId="scan-extensions" />
      <TextRow sid="scanNameOnly" label={t('settings.advanced.nameOnly')} help={t('settings.advanced.nameOnlyHelp')} value={csv(config.scan.nameOnlyExtensions)} validate={okExt} commit={(v) => patch({ scan: { nameOnlyExtensions: parseCsv(v) } })} testId="scan-name-only" />
      <TextRow
        sid="scanPrune"
        label={t('settings.advanced.prune')}
        help={t('settings.advanced.pruneHelp')}
        short
        inputMode="numeric"
        value={String(config.scan.pruneDeletedDays)}
        validate={(v) => (/^\d{1,4}$/.test(v.trim()) ? undefined : t('validation.invalid'))}
        commit={(v) => patch({ scan: { pruneDeletedDays: Number(v.trim()) } })}
        testId="scan-prune"
      />
      <Row sid="dataDirName" label={t('settings.advanced.dataDir')} help={t('settings.advanced.dataDirHelp')}>
        <code data-testid="data-dir-name">{dataDirName}</code>
      </Row>
      <Row sid="indexRebuild" label={t('settings.advanced.rebuild')} help={t('settings.advanced.rebuildHelp')} save={rebuild} savedText={t('settings.advanced.rebuildStarted')}>
        <Button size="sm" onClick={() => void rebuild.run(() => rl.invoke('scan:start', { full: true }))} data-testid="index-rebuild">
          {t('settings.advanced.rebuildButton')}
        </Button>
      </Row>
    </>
  );
}

let presetCounter = 0;
const newPresetId = () => `preset-${Date.now().toString(36)}-${++presetCounter}`;

/** Export presets: each field saves as it changes (the list is replaced as a whole, like the rest of library.json). */
function PresetsGroup({ config }: { config: LibraryConfig }) {
  const { t } = useTranslation();
  const patch = useLibraryPatch();
  const save = useAutoSave();
  const put = (next: ExportPreset[]) => void save.run(() => patch({ exportPresets: next }));
  const set = (i: number, p: Partial<ExportPreset>) => put(config.exportPresets.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Row sid="exportPresets" label={t('settings.library.presets')} help={config.exportPresets.length === 0 ? t('settings.library.presetsEmpty') : undefined} save={save}>
      <div className="srow__tree">
        {config.exportPresets.map((p, i) => (
          <div className="set-preset" key={p.id} data-testid="export-preset">
            <input aria-label={t('settings.library.presetName')} defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && set(i, { name: e.target.value.trim() })} />
            <select aria-label={t('settings.library.presetSources')} value={p.sources} onChange={(e) => set(i, { sources: e.target.value as ExportPreset['sources'] })}>
              <option value="none">{t('settings.library.sourcesNone')}</option>
              <option value="paths">{t('settings.library.sourcesPaths')}</option>
              <option value="copies">{t('settings.library.sourcesCopies')}</option>
            </select>
            <label>
              <input type="checkbox" checked={p.includeCited} onChange={(e) => set(i, { includeCited: e.target.checked })} /> {t('settings.library.presetCited')}
            </label>
            <label>
              <input type="checkbox" checked={p.includeNotes} onChange={(e) => set(i, { includeNotes: e.target.checked })} /> {t('settings.library.presetNotes')}
            </label>
            <label>
              <input type="checkbox" checked={p.includeAnnotations} onChange={(e) => set(i, { includeAnnotations: e.target.checked })} /> {t('settings.library.presetAnnotations')}
            </label>
            <Button size="sm" variant="ghost" onClick={() => put(config.exportPresets.filter((_, j) => j !== i))}>
              {t('common.remove')}
            </Button>
          </div>
        ))}
        <Button size="sm" onClick={() => put([...config.exportPresets, exportPresetSchema.parse({ id: newPresetId(), name: t('settings.library.presetDefaultName', { n: config.exportPresets.length + 1 }) })])} data-testid="add-preset">
          {t('settings.library.addPreset')}
        </Button>
      </div>
    </Row>
  );
}

/**
 * Developer / Advanced (4.8): options that are not needed for normal use. Above the groups, what differs from the defaults (each
 * with "Restore") and the saved keys; the groups are closed and build their content when opened.
 */
export function AdvancedSection() {
  const { t } = useTranslation();
  const app = useApp();
  const config = app.config;
  const patch = useLibraryPatch();
  const { account, reloadAccount } = useSettings();
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const libraryId = app.activeLibraryId;
  useEffect(() => {
    setMcp(null);
    if (libraryId) rl.invoke('mcp:status', {}).then(setMcp, () => {});
    return libraryId ? rl.on('mcp:changed', setMcp) : undefined;
  }, [libraryId]);
  const exe = account?.claudeCode.source === 'settings' ? account.claudeCode.path : null;
  const diffs = useMemo(() => advancedDiffs(config, exe, mcp, t as never, patch), [config, exe, mcp, t, patch]);
  const [error, setError] = useState(false);
  const dataDir = app.activeProfile?.dataDirName ?? '.lab';

  return (
    <div data-testid="advanced-settings">
      <SectionHead title={t('settings.advanced.title')} intro={t('settings.advanced.intro')} />
      {diffs.length > 0 && (
        <Group title={t('settings.diff.title', { count: diffs.length })} testId="settings-diffs">
          <div className="set-diff">
            {diffs.map((d) => (
              <span key={d.id} data-testid={`settings-diff-${d.id}`}>
                {d.label}
                <button type="button" className="link" onClick={() => void d.reset().then(() => (d.id === 'exe' ? reloadAccount() : app.refresh())).catch(() => setError(true))}>
                  {t('settings.diff.restore')}
                </button>
              </span>
            ))}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {t('errors.INTERNAL')}
            </p>
          )}
        </Group>
      )}
      <SavedKeys />
      <Group testId="advanced-groups">
        <Fold fold="claude" title={t('settings.advanced.claude')}>
          {config ? <ClaudeGroup config={config} /> : <NeedsLibrary />}
        </Fold>
        <Fold fold="mcp" title={t('settings.advanced.mcp')}>
          <Lazy>
            <McpSection embedded />
          </Lazy>
        </Fold>
        <Fold fold="scan" title={t('settings.advanced.scan')}>
          {config ? <ScanGroup config={config} dataDirName={dataDir} /> : <NeedsLibrary />}
        </Fold>
        <Fold fold="export" title={t('settings.advanced.export')}>
          {config ? <PresetsGroup config={config} /> : <NeedsLibrary />}
        </Fold>
        <Fold fold="maintenance" title={t('settings.advanced.maintenance')}>
          <Row sid="deviceId" label={t('settings.advanced.deviceId')} help={t('settings.advanced.deviceIdHelp')}>
            <code data-testid="device-id">{app.settings?.deviceId ?? ''}</code>
          </Row>
          <Lazy>
            <MaintenanceSection embedded />
          </Lazy>
        </Fold>
      </Group>
    </div>
  );
}
