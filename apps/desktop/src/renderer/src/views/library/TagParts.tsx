import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { safeText } from './safeText';
import { canCreateTag, suggestTags } from './tagSuggest';
import type { TaxonomyModel } from './taxonomyModel';

/** A tag as a coloured chip: the node's colour is the stripe and a light tint, so it works in both themes. */
export function TagChip({
  label,
  color,
  deprecated,
  excluded,
  onRemove,
  removeLabel,
  testId,
  id,
}: {
  label: string;
  color?: string | undefined;
  deprecated?: boolean | undefined;
  excluded?: boolean | undefined;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
  testId?: string | undefined;
  id?: string | undefined;
}) {
  const style = color ? ({ '--tag': color } as CSSProperties) : undefined;
  const classes = ['tag', color ? 'tag-colored' : '', deprecated ? 'tag-deprecated' : '', excluded ? 'tag-excluded' : ''].filter(Boolean).join(' ');
  return (
    <span className={classes} style={style} data-testid={testId ?? 'tag-chip'} data-tag={id}>
      <span className="tag-label">{safeText(label)}</span>
      {onRemove && (
        <button type="button" className="tag-remove" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}

interface PickerProps {
  model: TaxonomyModel;
  /** Tags not to propose (already on the document, already filtered...). */
  exclude?: ReadonlySet<string>;
  onPick(id: string): void;
  /** When given, the picker offers "Create tag ..." for a text that names no existing tag. */
  onCreate?: ((label: string) => Promise<void> | void) | undefined;
  placeholder?: string;
  ariaLabel: string;
  testId?: string;
  autoFocus?: boolean;
  /** An action is running: the input waits. */
  disabled?: boolean;
}

/**
 * Tag entry with completion from the taxonomy: matches labels and aliases (a hit on an alias says so), and can
 * create a tag on the fly. Combobox pattern: the input keeps the focus, arrows move the highlight, Enter picks.
 */
export function TagPicker({ model, exclude, onPick, onCreate, placeholder, ariaLabel, testId, autoFocus, disabled }: PickerProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => suggestTags(model, text, exclude ? { exclude } : {}), [model, text, exclude]);
  const create = onCreate !== undefined && canCreateTag(model, text);
  const options = [...suggestions.map((s) => ({ kind: 'tag' as const, s })), ...(create ? [{ kind: 'create' as const, label: text.trim() }] : [])];
  const activeIndex = Math.min(active, options.length - 1);

  const reset = () => {
    setText('');
    setActive(0);
    setOpen(false);
  };
  const choose = async (i: number) => {
    const opt = options[i];
    if (!opt || busy) return;
    if (opt.kind === 'tag') {
      onPick(opt.s.id);
      reset();
    } else {
      setBusy(true);
      try {
        await onCreate?.(opt.label);
        reset();
      } finally {
        setBusy(false);
        input.current?.focus();
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, (open ? a : -1) + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      if (open && options.length > 0) {
        e.preventDefault();
        void choose(activeIndex);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const showList = open && options.length > 0;
  return (
    <div className="tag-picker">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        disabled={busy || disabled === true}
        maxLength={200}
        data-testid={testId ?? 'tag-input'}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" className="tag-options" hidden={!showList} data-testid="tag-options">
        {showList && options.map((o, i) => (
          <li
            key={o.kind === 'tag' ? o.s.id : '__create__'}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            className={i === activeIndex ? 'active' : undefined}
            data-testid={o.kind === 'tag' ? 'tag-option' : 'tag-create'}
            data-tag={o.kind === 'tag' ? o.s.id : undefined}
            // mousedown, not click: the input must not lose the focus (and close the list) first
            onMouseDown={(e) => {
              e.preventDefault();
              void choose(i);
            }}
          >
            {o.kind === 'tag' ? (
              <>
                <span className="tag-option-main">
                  <span className="swatch" style={model.byId.get(o.s.id)?.color ? ({ background: model.byId.get(o.s.id)?.color } as CSSProperties) : undefined} aria-hidden="true" />
                  {safeText(o.s.label)}
                  {o.s.viaAlias !== undefined && <span className="tag-alias"> {t('tags.viaAlias', { alias: safeText(o.s.viaAlias) })}</span>}
                </span>
                {o.s.path && <span className="tag-path">{safeText(o.s.path)}</span>}
              </>
            ) : (
              <span className="tag-option-main">{t('tags.create', { label: safeText(o.label) })}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
