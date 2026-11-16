import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorNote } from '../components/ui';
import { flushAll } from '../lib/dirtyEditors';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';

/** The list of library profiles: activate, rename, remove from the list (files are never deleted). */
export function LibrariesSection({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation();
  const app = useApp();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await app.refresh();
    } catch (e) {
      setError(e);
    }
  };

  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setNameDraft(name);
  };
  const submitRename = (id: string) => {
    const name = nameDraft.trim();
    if (!name) return;
    void run(async () => {
      await rl.invoke('library:rename', { libraryId: id, name });
      setRenaming(null);
    });
  };

  return (
    <section className="card" aria-labelledby="settings-libraries">
      <h2 id="settings-libraries">{t('settings.libraries.title')}</h2>
      {app.profiles.length === 0 ? <p className="hint">{t('settings.libraries.empty')}</p> : null}
      <ul className="library-list" data-testid="library-list">
        {app.profiles.map((p) => {
          const active = p.id === app.activeLibraryId;
          return (
            <li key={p.id} data-testid="library-item" data-active={active || undefined}>
              <div className="library-main">
                {renaming === p.id ? (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitRename(p.id);
                    }}
                  >
                    <input aria-label={t('library.name')} value={nameDraft} maxLength={120} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
                    <button type="submit" className="primary" disabled={!nameDraft.trim()}>
                      {t('common.save')}
                    </button>
                    <button type="button" onClick={() => setRenaming(null)}>
                      {t('common.cancel')}
                    </button>
                  </form>
                ) : (
                  <>
                    <strong>{p.name}</strong>
                    {active && <span className="badge">{t('settings.libraries.active')}</span>}
                  </>
                )}
                <span className="path">{p.rootPath}</span>
              </div>
              {renaming !== p.id && (
                <div className="row-actions">
                  {!active && (
                    <button type="button" onClick={() =>
                      void run(async () => {
                        await flushAll(); // unsaved notes belong to the library that is active now
                        await rl.invoke('library:setActive', { libraryId: p.id });
                      })
                    }>
                      {t('settings.libraries.activate')}
                    </button>
                  )}
                  <button type="button" onClick={() => startRename(p.id, p.name)}>
                    {t('settings.libraries.rename')}
                  </button>
                  <button type="button" onClick={() => setConfirmForget(p.id)}>
                    {t('settings.libraries.forget')}
                  </button>
                </div>
              )}
              {confirmForget === p.id && (
                <div className="confirm" role="alertdialog" aria-label={t('settings.libraries.forgetTitle')}>
                  <p>{t('settings.libraries.forgetBody', { name: p.name })}</p>
                  <div className="actions start">
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void run(async () => {
                          await rl.invoke('library:forget', { libraryId: p.id });
                          setConfirmForget(null);
                        })
                      }
                    >
                      {t('settings.libraries.forgetConfirm')}
                    </button>
                    <button type="button" onClick={() => setConfirmForget(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      <div className="actions start">
        <button type="button" className="primary" onClick={onNew} data-testid="settings-new-library">
          {t('library.new')}
        </button>
      </div>
    </section>
  );
}
