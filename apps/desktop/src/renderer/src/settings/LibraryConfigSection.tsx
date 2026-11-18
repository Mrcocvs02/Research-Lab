import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { libraryConfigSchema, type Language, type LibraryProfile, type ScanReport } from '@rl/core';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { FolderTree, type FolderEntry } from '../components/FolderTree';
import { IconButton } from '../components/IconButton';
import { IconMore } from '../components/icons';
import { Menu } from '../components/Menu';
import { flushAll } from '../lib/dirtyEditors';
import { errorMessage } from '../lib/errors';
import { useNotify } from '../lib/notify';
import { rl } from '../lib/rl';
import { validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';
import { Group, NeedsLibrary, Row, SectionHead, TextRow, useLibraryPatch } from './rows';
import { useAutoSave } from './useAutoSave';

/** One library of the list: name, path and its actions; "Rename" turns the name into a field, "Remove from list" asks first (files are never deleted). */
function LibraryItem({ p, active, run }: { p: LibraryProfile; active: boolean; run(fn: () => Promise<unknown>): Promise<void> }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const [forget, setForget] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  const rename = () => {
    const n = name.trim();
    if (n)
      void run(async () => {
        await rl.invoke('library:rename', { libraryId: p.id, name: n });
        setRenaming(false);
      });
  };
  return (
    <li data-testid="library-item" data-active={active || undefined}>
      <div className="grow">
        {renaming ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <input aria-label={t('library.name')} value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} data-testid="library-rename-input" />
            <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
              {t('common.save')}
            </Button>
            <Button size="sm" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </Button>
          </form>
        ) : (
          <>
            <strong>{p.name}</strong>
            {active && <span className="badge ok">{t('settings.libraries.active')}</span>}
          </>
        )}
        <span className="path">{p.rootPath}</span>
      </div>
      {!active && !renaming && (
        <Button
          size="sm"
          onClick={() =>
            void run(async () => {
              await flushAll(); // unsaved notes belong to the library that is active now
              await rl.invoke('library:setActive', { libraryId: p.id });
            })
          }
          data-testid="library-activate"
        >
          {t('settings.libraries.activate')}
        </Button>
      )}
      <span ref={more}>
        <IconButton label={t('settings.libraries.more', { name: p.name })} onClick={() => setMenu(true)} data-testid="library-more">
          <IconMore size={16} />
        </IconButton>
      </span>
      <Menu
        anchor={more}
        open={menu}
        onClose={() => setMenu(false)}
        label={t('settings.libraries.more', { name: p.name })}
        groups={[
          {
            id: 'lib',
            items: [
              {
                id: 'rename',
                label: t('settings.libraries.rename'),
                onSelect: () => {
                  setName(p.name);
                  setRenaming(true);
                },
              },
              { id: 'forget', label: t('settings.libraries.forget'), danger: true, onSelect: () => setForget(true) },
            ],
          },
        ]}
      />
      {forget && (
        <Dialog title={t('settings.libraries.forgetTitle')} onClose={() => setForget(false)} testId="library-forget-dialog">
          <p>{t('settings.libraries.forgetBody', { name: p.name })}</p>
          <div className="actions">
            <Button onClick={() => setForget(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() =>
                void run(async () => {
                  await rl.invoke('library:forget', { libraryId: p.id });
                  setForget(false);
                })
              }
              data-testid="library-forget-yes"
            >
              {t('settings.libraries.forgetConfirm')}
            </Button>
          </div>
        </Dialog>
      )}
    </li>
  );
}

/** The last scan: when, what it found, and "Scan now". */
function ScanRow() {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<ScanReport | null>(null);
  const save = useAutoSave();
  useEffect(() => {
    rl.invoke('scan:report', {}).then(setReport, () => {});
  }, []);
  const last = report?.finishedAt ? t('settings.scan.last', { when: new Date(report.finishedAt).toLocaleString(i18n.language), added: report.summary?.added ?? 0 }) : t('settings.scan.never');
  return (
    <Row sid="scanNow" label={t('settings.scan.title')} help={last} save={save} savedText={t('settings.scan.started')}>
      <Button size="sm" onClick={() => void save.run(() => rl.invoke('scan:start', {}))} data-testid="settings-scan-now">
        {t('settings.scan.now')}
      </Button>
    </Row>
  );
}

/** Library (6.1): your libraries, and for the active one its name, language, excluded folders and scan. Every control saves by itself. */
export function LibraryConfigSection({ onNewLibrary }: { onNewLibrary(): void }) {
  const { t } = useTranslation();
  const app = useApp();
  const notify = useNotify();
  const config = app.config;
  const libraryId = app.activeLibraryId;
  const patch = useLibraryPatch();
  const lang = useAutoSave();
  const excl = useAutoSave();
  const [error, setError] = useState<unknown>(null);

  const { refresh } = app;
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e);
      }
    },
    [refresh],
  );
  const loadFolders = useCallback(
    async (parent: string): Promise<FolderEntry[]> => (libraryId ? (await rl.invoke('library:listFolders', { libraryId, ...(parent ? { parent } : {}) })).folders : []),
    [libraryId],
  );
  /** A change with a wide effect: saved at once, with "Saved · Undo" (6.4). */
  const undoable = (save: ReturnType<typeof useAutoSave>, apply: () => Promise<void>, undo: () => Promise<void>) =>
    void save.run(async () => {
      await apply();
      notify.info(t('settings.savedUndo'), { label: t('settings.undo'), run: () => void undo().catch(() => {}) });
    });

  return (
    <>
      <SectionHead title={t('settings.sec.library')} intro={app.activeProfile ? t('settings.intro.library', { name: app.activeProfile.name }) : undefined} />
      <Group title={t('settings.libraries.title')} testId="library-list" sid="libraries">
        {app.profiles.length === 0 && <p className="set-help">{t('settings.libraries.empty')}</p>}
        <ul className="set-libs">
          {app.profiles.map((p) => (
            <LibraryItem key={p.id} p={p} active={p.id === libraryId} run={run} />
          ))}
        </ul>
        {error ? (
          <p className="field-error" role="alert">
            {errorMessage(error, t)}
          </p>
        ) : null}
        <div className="actions start">
          <Button onClick={onNewLibrary} data-testid="settings-new-library">
            {t('library.new')}
          </Button>
        </div>
      </Group>
      <Group title={t('settings.library.thisOne')} testId="library-config">
        {!libraryId ? (
          <NeedsLibrary />
        ) : !config ? (
          <p className="field-error">{t('settings.library.unreadable')}</p>
        ) : (
          <>
            <TextRow
              sid="libraryName"
              label={t('library.name')}
              value={config.name}
              maxLength={120}
              testId="config-name"
              validate={(v) => (validateWith(libraryConfigSchema, { ...config, name: v }).errors.name ? t(validationKey('name')) : undefined)}
              commit={(v) => patch({ name: v.trim() })}
            />
            <Row sid="libraryLanguage" label={t('library.language')} help={t('library.languageHint')} htmlFor="config-language" save={lang}>
              <select
                id="config-language"
                value={config.language}
                onChange={(e) => {
                  const before = config.language;
                  const next = e.target.value as Language;
                  undoable(lang, () => patch({ language: next }), () => patch({ language: before }));
                }}
                data-testid="config-language"
              >
                <option value="it">{t('languages.it')}</option>
                <option value="en">{t('languages.en')}</option>
              </select>
            </Row>
            <Row sid="excludedFolders" label={t('settings.library.excluded')} help={t('settings.library.excludedHint')} save={excl}>
              <div className="srow__tree">
                <FolderTree
                  load={loadFolders}
                  value={config.excludedFolders}
                  onChange={(v) => {
                    const before = config.excludedFolders;
                    undoable(excl, () => patch({ excludedFolders: v }), () => patch({ excludedFolders: before }));
                  }}
                  ariaLabel={t('settings.library.excluded')}
                  testId="config-excluded-tree"
                />
              </div>
            </Row>
            <ScanRow />
          </>
        )}
      </Group>
    </>
  );
}
