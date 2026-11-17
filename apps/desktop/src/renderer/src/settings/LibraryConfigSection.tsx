import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { libraryConfigSchema, type ExportPreset, type Language, type LibraryConfig } from '@rl/core';
import { FolderTree, type FolderEntry } from '../components/FolderTree';
import { CheckField, ErrorNote, LanguageSelect, SelectField, TextField } from '../components/ui';
import { errorMessage, issuesFromError } from '../lib/errors';
import { rl } from '../lib/rl';
import { validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';

interface Draft {
  name: string;
  language: Language;
  excluded: string[];
  presets: ExportPreset[];
}

const toDraft = (c: LibraryConfig): Draft => ({
  name: c.name,
  language: c.language,
  excluded: c.excludedFolders,
  presets: c.exportPresets,
});

/** Builds the full candidate config that the core schema validates (and the patch is taken from). */
function toCandidate(base: LibraryConfig, d: Draft): unknown {
  return {
    ...base,
    name: d.name,
    language: d.language,
    excludedFolders: d.excluded,
    exportPresets: d.presets,
  };
}

let presetCounter = 0;
const newPresetId = () => `preset-${Date.now().toString(36)}-${++presetCounter}`;

/** Editor for library.json of the active library. */
export function LibraryConfigSection() {
  const { t } = useTranslation();
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const config = app.config;
  const [draft, setDraft] = useState<Draft | null>(config ? toDraft(config) : null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

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

  const loadFolders = useCallback(
    async (parent: string): Promise<FolderEntry[]> => {
      if (!libraryId) return [];
      const r = await rl.invoke('library:listFolders', { libraryId, ...(parent ? { parent } : {}) });
      return r.folders;
    },
    [libraryId],
  );

  if (!libraryId) {
    return (
      <section className="card" aria-labelledby="settings-library">
        <h2 id="settings-library">{t('settings.library.title')}</h2>
        <p className="hint">{t('settings.needsLibrary')}</p>
      </section>
    );
  }
  if (!config || !draft) {
    return (
      <section className="card" aria-labelledby="settings-library">
        <h2 id="settings-library">{t('settings.library.title')}</h2>
        <ErrorNote>{t('settings.library.unreadable')}</ErrorNote>
      </section>
    );
  }

  const err = (path: string) => (check.errors[path] || serverIssues[path] ? t(validationKey(path)) : undefined);
  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const setPreset = (i: number, patch: Partial<ExportPreset>) => edit({ presets: draft.presets.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const save = async () => {
    if (!check.data) return;
    setError(null);
    try {
      const c = check.data;
      await rl.invoke('library:setConfig', {
        libraryId,
        patch: {
          name: c.name,
          language: c.language,
          excludedFolders: c.excludedFolders,
          exportPresets: c.exportPresets,
        },
      });
      ownSave.current = true;
      await app.refresh();
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="card" aria-labelledby="settings-library" data-testid="library-config">
      <h2 id="settings-library">{t('settings.library.title', { name: app.activeProfile?.name ?? '' })}</h2>

      <div className="group">
        <h3>{t('settings.library.general')}</h3>
        <TextField label={t('library.name')} value={draft.name} maxLength={120} error={err('name')} onChange={(e) => edit({ name: e.target.value })} data-testid="config-name" />
        <LanguageSelect label={t('library.language')} hint={t('library.languageHint')} value={draft.language} onChange={(v) => edit({ language: v })} testId="config-language" />
      </div>

      <div className="group">
        <h3>{t('settings.library.excluded')}</h3>
        <p className="hint">{t('settings.library.excludedHint')}</p>
        <FolderTree load={loadFolders} value={draft.excluded} onChange={(v) => edit({ excluded: v })} ariaLabel={t('settings.library.excluded')} testId="config-excluded-tree" />
      </div>

      <div className="group">
        <h3>{t('settings.library.presets')}</h3>
        {draft.presets.length === 0 && <p className="hint">{t('settings.library.presetsEmpty')}</p>}
        <ul className="rows">
          {draft.presets.map((p, i) => (
            <li key={p.id} className="preset" data-testid="export-preset">
              <TextField label={t('settings.library.presetName')} value={p.name} error={err(`exportPresets.${i}.name`)} onChange={(e) => setPreset(i, { name: e.target.value })} />
              <div className="two-col">
                <SelectField label={t('settings.library.presetSources')} value={p.sources} onChange={(e) => setPreset(i, { sources: e.target.value as ExportPreset['sources'] })}>
                  <option value="none">{t('settings.library.sourcesNone')}</option>
                  <option value="paths">{t('settings.library.sourcesPaths')}</option>
                  <option value="copies">{t('settings.library.sourcesCopies')}</option>
                </SelectField>
                <TextField
                  label={t('settings.library.presetDepth')}
                  type="number"
                  min={0}
                  max={3}
                  value={p.citedDepth}
                  error={err(`exportPresets.${i}.citedDepth`)}
                  onChange={(e) => setPreset(i, { citedDepth: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                />
              </div>
              <CheckField label={t('settings.library.presetCited')} checked={p.includeCited} onChange={(e) => setPreset(i, { includeCited: e.target.checked })} />
              <CheckField label={t('settings.library.presetNotes')} checked={p.includeNotes} onChange={(e) => setPreset(i, { includeNotes: e.target.checked })} />
              <CheckField label={t('settings.library.presetAnnotations')} checked={p.includeAnnotations} onChange={(e) => setPreset(i, { includeAnnotations: e.target.checked })} />
              <button type="button" onClick={() => edit({ presets: draft.presets.filter((_, j) => j !== i) })}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="actions start">
          <button
            type="button"
            onClick={() =>
              edit({
                presets: [
                  ...draft.presets,
                  { id: newPresetId(), name: t('settings.library.presetDefaultName', { n: draft.presets.length + 1 }), includeCited: false, citedDepth: 1, sources: 'none', includeNotes: true, includeAnnotations: true },
                ],
              })
            }
            data-testid="add-preset"
          >
            {t('settings.library.addPreset')}
          </button>
        </div>
      </div>

      <div className="actions start sticky">
        <button type="button" className="primary" onClick={() => void save()} disabled={!check.data} data-testid="config-save">
          {t('common.save')}
        </button>
        <span className="status" role="status">
          {saved ? t('common.saved') : check.data ? '' : t('common.fixErrors')}
        </span>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
    </section>
  );
}
