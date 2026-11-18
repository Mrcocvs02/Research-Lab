import { useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from '../components/Popover';
import { useAiUi } from '../lib/aiUi';
import { useNotify } from '../lib/notify';
import { useApp } from '../state/app-context';
import { libraryTint, shortPath } from './libraryModel';

/** The libraries as a popover under the switcher (300 px): the active one ticked, then New library and Manage libraries. */
export function LibraryPopover({ anchor, onClose, onNewLibrary }: { anchor: RefObject<HTMLElement | null>; onClose(): void; onNewLibrary(): void }) {
  const { t } = useTranslation();
  const app = useApp();
  const { goTo } = useAiUi();
  const { reportError } = useNotify();
  const first = useRef<HTMLButtonElement>(null);
  const done = (then?: () => void) => {
    onClose();
    anchor.current?.focus();
    then?.();
  };
  return (
    <Popover anchor={anchor} open onClose={onClose} label={t('shell.activeLibrary')} width={300} className="lib-pop">
      <ul className="lib-list" data-testid="library-switcher-list">
        {app.profiles.map((p) => (
          <li key={p.id}>
            <button
              ref={p.id === app.activeLibraryId ? first : undefined}
              type="button"
              className="lib-item"
              aria-current={p.id === app.activeLibraryId ? 'true' : undefined}
              autoFocus={p.id === app.activeLibraryId}
              onClick={() => done(() => p.id !== app.activeLibraryId && void app.setActiveLibrary(p.id).catch(reportError))}
              data-testid="library-switcher-item"
              data-library-id={p.id}
            >
              <span className="lib-switch__sq" style={{ background: `var(--lib-${libraryTint(p.name)})` }} aria-hidden="true" />
              <span className="lib-switch__text">
                <b>{p.name}</b>
                <small title={p.rootPath}>{shortPath(p.rootPath)}</small>
              </span>
              {p.id === app.activeLibraryId && (
                <span className="lib-item__check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="lib-pop__foot">
        <button type="button" className="lib-item lib-item--plain" onClick={() => done(onNewLibrary)} data-testid="library-new">
          {t('library.new')}
        </button>
        <button type="button" className="lib-item lib-item--plain" onClick={() => done(() => goTo('settings'))} data-testid="library-manage">
          {t('shell.manageLibraries')}
        </button>
      </div>
    </Popover>
  );
}
