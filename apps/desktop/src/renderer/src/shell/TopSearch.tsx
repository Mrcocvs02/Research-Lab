import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { Kbd } from '../components/Kbd';
import { Lazy, lazyView } from '../components/Lazy';
import { Popover } from '../components/Popover';
import { useAiUi } from '../lib/aiUi';
import { useEffectiveShortcuts } from '../lib/keymap';
import { setSearchText, useSearchText } from '../lib/librarySearch';
import { useNav } from '../lib/nav';
import { useApp } from '../state/app-context';
import { Icon } from './shellIcons';
import './topsearch.css';

// "Search with Claude" opens its dialog from here; the code loads with the first click.
const AdvancedSearchDialog = lazyView(() => import('../views/ai/AdvancedSearchDialog').then((m) => ({ default: m.AdvancedSearchDialog })), ['advSearch']);

/**
 * The search slot of the top bar (4.1, D-441): the real library search box, the syntax help (?) and "Search with Claude"
 * (the sparkle). Typing from any view goes to the Library, which shows the results (the text lives in `lib/librarySearch`).
 */
export function TopSearch() {
  const { t } = useTranslation();
  const app = useApp();
  const nav = useNav();
  const { goTo } = useAiUi();
  const keys = useEffectiveShortcuts();
  const text = useSearchText();
  const inputId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const shortcut = keys['search.focus'];
  const enabled = Boolean(app.activeLibraryId);
  const onLibrary = nav.view === 'library';

  return (
    <div className="topsearch" role="search">
      <label htmlFor={inputId} className="topsearch__label">
        {t('search.label')}
      </label>
      <div ref={fieldRef} className="topsearch__field">
        <Icon name="search" size={16} />
        <input
          id={inputId}
          type="search"
          value={text}
          maxLength={500}
          disabled={!enabled}
          title={enabled ? undefined : t('shell.noLibrary')}
          placeholder={t('shell.searchLibrary')}
          autoComplete="off"
          spellCheck={false}
          aria-keyshortcuts={shortcut ?? undefined}
          data-testid="search-input"
          onChange={(e) => {
            setSearchText(e.target.value);
            // The results live in the Library: typing from another view takes you there.
            if (!onLibrary && e.target.value !== '') goTo('library');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (text !== '') setSearchText('');
              else e.currentTarget.blur();
            }
          }}
        />
        {shortcut && text === '' && <Kbd className="topsearch__kbd">{shortcut}</Kbd>}
      </div>
      <IconButton label={t('shell.searchSyntax')} size="sm" pressed={helpOpen} aria-expanded={helpOpen} data-testid="search-syntax" className="topsearch__help" onClick={() => setHelpOpen(!helpOpen)} disabled={!enabled}>
        <span aria-hidden="true">?</span>
      </IconButton>
      <IconButton label={t('shell.searchWithClaude')} size="sm" className="topsearch__ai" title={t('advSearch.buttonHint')} onClick={() => setAdvOpen(true)} disabled={!enabled} data-testid="adv-search">
        <Icon name="claude" size={16} />
      </IconButton>
      <Popover anchor={fieldRef} open={helpOpen} onClose={() => setHelpOpen(false)} label={t('shell.searchSyntax')} width={360}>
        <div className="topsearch__syntax" data-testid="search-syntax-help">
          <h2>{t('shell.searchSyntax')}</h2>
          <ul>
            {t('search.help')
              .split(', ')
              .map((s) => (
                <li key={s}>
                  <code>{s}</code>
                </li>
              ))}
          </ul>
        </div>
      </Popover>
      {advOpen && (
        <Lazy>
          <AdvancedSearchDialog initialText={text} onClose={() => setAdvOpen(false)} />
        </Lazy>
      )}
    </div>
  );
}
