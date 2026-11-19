import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { Kbd } from '../components/Kbd';
import { Lazy, lazyView } from '../components/Lazy';
import { Popover } from '../components/Popover';
import type { ResumeInfo } from '@rl/core';
import { looksLikeIdentifier, requestAdd } from '../lib/addRequest';
import { useAiUi } from '../lib/aiUi';
import { useEffectiveShortcuts } from '../lib/keymap';
import { setSearchText, useSearchText } from '../lib/librarySearch';
import { useNav } from '../lib/nav';
import { useReader } from '../lib/reader';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { Icon } from './shellIcons';
import './topsearch.css';

// "Search with Claude" opens its dialog from here; the code loads with the first click.
const AdvancedSearchDialog = lazyView(() => import('../views/ai/AdvancedSearchDialog').then((m) => ({ default: m.AdvancedSearchDialog })), ['advSearch']);

/**
 * The search slot of the top bar (4.1, D-441): the real library search box, the syntax help (?) and "Search with Claude"
 * (the sparkle). Typing from any view goes to the Library, which shows the results (the text lives in `lib/librarySearch`).
 */
/** "yesterday", "2 hours ago": the app language, the coarsest unit that is not zero. */
function ago(iso: string, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return rtf.format(0, 'minute');
  if (min < 60) return rtf.format(-min, 'minute');
  if (min < 1440) return rtf.format(-Math.round(min / 60), 'hour');
  return rtf.format(-Math.round(min / 1440), 'day');
}

/**
 * The menu under the search box. The top bar clips its overflow (it must never paint over the Claude panel), so the menu is
 * drawn on the body at the box's position; clipped inside the bar it showed as an empty strip (Z23).
 */
function FloatingMenu({ field, label, children }: { field: RefObject<HTMLDivElement | null>; label: string; children: ReactNode }) {
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const r = field.current?.getBoundingClientRect();
    if (r) setBox({ top: r.bottom + 4, left: r.left, width: r.width });
  }, [field]);
  if (!box) return null;
  return createPortal(
    <div className="topsearch__menu" role="menu" aria-label={label} data-testid="search-menu" style={box} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

export function TopSearch() {
  const { t, i18n } = useTranslation();
  const app = useApp();
  const nav = useNav();
  const { goTo } = useAiUi();
  const keys = useEffectiveShortcuts();
  const text = useSearchText();
  const inputId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const { openReader } = useReader();
  const [focused, setFocused] = useState(false);
  const [info, setInfo] = useState<ResumeInfo | null>(null);
  // The empty box with the focus offers where to resume and the latest documents (17.4.5); nothing is read before that.
  useEffect(() => {
    if (!focused || text !== '' || !app.activeLibraryId) return;
    let live = true;
    rl.invoke('resume:get', {}).then(
      (r) => live && setInfo(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [focused, text === '', app.activeLibraryId]);
  const rows = info ? [...(info.last ? [info.last] : []), ...info.recent] : [];
  const showResume = focused && text === '' && rows.length > 0;
  const showAdd = focused && Boolean(app.activeLibraryId) && looksLikeIdentifier(text);
  const where = (p: number | null) => (p ? t('resume.page', { page: p }) : '');
  const resumeAt = (r: { docId: string; page: number | null }) => {
    openReader(r.docId, r.page ?? undefined);
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
      {(showResume || showAdd) && (
        <FloatingMenu field={fieldRef} label={t('resume.menu')}>
          {showAdd && (
            <button type="button" role="menuitem" data-testid="search-add-id" onClick={() => (requestAdd({ kind: 'id', text: text.trim() }), setSearchText(''))}>
              {t('search.addId', { id: text.trim() })}
            </button>
          )}
          {showResume && info?.last && (
            <button type="button" role="menuitem" data-testid="search-resume" onClick={() => resumeAt(info.last!)}>
              {t('resume.row', { title: info.last.title ?? t('resume.untitled'), where: where(info.last.page), when: ago(info.last.at, i18n.language) })}
            </button>
          )}
          {showResume && info && info.recent.length > 0 && <div className="topsearch__menu-head">{t('resume.recent')}</div>}
          {showResume &&
            info?.recent.map((r) => (
              <button key={r.docId} type="button" role="menuitem" data-testid="search-recent" onClick={() => resumeAt(r)}>
                {r.title ?? t('resume.untitled')}
                {where(r.page)}
              </button>
            ))}
        </FloatingMenu>
      )}
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
