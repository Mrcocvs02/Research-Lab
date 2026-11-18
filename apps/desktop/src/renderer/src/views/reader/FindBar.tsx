import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { Icon } from '../../shell/shellIcons';
import type { FindState } from './engine';

interface Props {
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  text: string;
  state: FindState;
  onText(v: string): void;
  /** Next or previous match (Enter, Shift+Enter, the arrows). */
  onStep(backwards: boolean): void;
  onAnnotate(kind: 'highlight' | 'underline'): void;
  onClose(): void;
}

/** The find bar under the reader bar (40 px, 4.3): field, "3 of 17", previous and next, annotate the match, close. */
export function FindBar({ inputId, inputRef, text, state, onText, onStep, onAnnotate, onClose }: Props) {
  const { t } = useTranslation();
  const label = state.state === 'notfound' ? t('reader.findNone') : state.total > 0 ? t('reader.findCount', { current: state.current, total: state.total }) : '';
  return (
    <div className="reader-find" role="search" data-testid="reader-find">
      <label className="sr-only" htmlFor={inputId}>
        {t('reader.findLabel')}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        placeholder={t('reader.findLabel')}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey);
          }
        }}
        data-testid="reader-find-input"
        autoComplete="off"
        spellCheck={false}
      />
      <span className="hint" role="status" data-testid="reader-find-count">
        {label}
      </span>
      <IconButton label={t('reader.findPrev')} size="sm" onClick={() => onStep(true)} data-testid="reader-find-prev">
        <span aria-hidden="true">↑</span>
      </IconButton>
      <IconButton label={t('reader.findNext')} size="sm" onClick={() => onStep(false)} data-testid="reader-find-next">
        <span aria-hidden="true">↓</span>
      </IconButton>
      <button type="button" disabled={state.total === 0} onClick={() => onAnnotate('highlight')} title={t('reader.findAnnotateHint')} data-testid="reader-find-highlight">
        {t('reader.findHighlight')}
      </button>
      <button type="button" disabled={state.total === 0} onClick={() => onAnnotate('underline')} title={t('reader.findAnnotateHint')} data-testid="reader-find-underline">
        {t('reader.findUnderline')}
      </button>
      <IconButton label={t('reader.findClose')} size="sm" onClick={onClose} data-testid="reader-find-close">
        <Icon name="close" size={16} />
      </IconButton>
    </div>
  );
}
