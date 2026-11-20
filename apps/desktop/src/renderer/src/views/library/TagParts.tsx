import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackSearchItem } from '@rl/core';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from './safeText';
import { canCreateTag, similarTag, suggestTags } from './tagSuggest';
import type { TaxonomyModel } from './taxonomyModel';
import './library.css';

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
  origin,
  originTitle,
  onConfirm,
}: {
  label: string;
  color?: string | undefined;
  deprecated?: boolean | undefined;
  excluded?: boolean | undefined;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
  testId?: string | undefined;
  id?: string | undefined;
  /** Provenance (D-494): a tag the AI proposed and the user accepted, or one that came from an import; none for a tag set by hand. */
  origin?: 'ai' | 'import' | undefined;
  originTitle?: string | undefined;
  /** "Confirm": the user vouches for the tag, which then loses the mark. */
  onConfirm?: (() => void) | undefined;
}) {
  const style = color ? ({ '--tag': color } as CSSProperties) : undefined;
  const classes = ['tag', color ? 'tag-colored' : '', deprecated ? 'tag-deprecated' : '', excluded ? 'tag-excluded' : ''].filter(Boolean).join(' ');
  return (
    <span className={classes} style={style} data-testid={testId ?? 'tag-chip'} data-tag={id}>
      <span className="tag-label">{safeText(label)}</span>
      {origin && (
        <span className="tag-origin" data-testid="tag-origin" data-origin={origin} title={originTitle} onClick={onConfirm} role={onConfirm ? 'button' : undefined}>
          {origin === 'ai' ? '✦' : '⇣'}
        </span>
      )}
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
  /** The papers a concept of the field vocabulary is put on when picked (D-518): with it the picker offers "From the field vocabulary" after the tags. */
  pack?: { docIds: readonly string[] } | undefined;
}

/**
 * Tag entry with completion from the taxonomy: matches labels and aliases (a hit on an alias says so), and can
 * create a tag on the fly. Combobox pattern: the input keeps the focus, arrows move the highlight, Enter picks.
 */
export function TagPicker({ model, exclude, onPick, onCreate, placeholder, ariaLabel, testId, autoFocus, disabled, pack }: PickerProps) {
  const { t } = useTranslation();
  const { invalidate } = useLibraryEvents();
  const { info, reportError } = useNotify();
  const taxVersion = useChangeVersion('taxonomy');
  const [fromField, setFromField] = useState<PackSearchItem[]>([]);
  const [noPack, setNoPack] = useState(false);
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => suggestTags(model, text, exclude ? { exclude } : {}), [model, text, exclude]);
  const create = onCreate !== undefined && canCreateTag(model, text);
  // Before a new tag: a tag that is the same name written differently is offered instead (D-497).
  const similar = create ? similarTag(model, text) : null;
  // Concepts of the field vocabulary no tag stands for yet (at most 6, after the tags); asked of main only while a pack is in use.
  const wantPack = pack !== undefined && !noPack && text.trim().length >= 2;
  useEffect(() => setNoPack(false), [taxVersion]);
  useEffect(() => {
    if (!wantPack) {
      setFromField([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      rl.invoke('vocabPack:search', { q: text.trim(), limit: 6 }).then(
        (r) => live && setFromField(r.items),
        (e: unknown) => {
          if (!live) return;
          setFromField([]);
          if ((e as { code?: string }).code === 'INVALID_REQUEST') setNoPack(true);
        },
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wantPack, text]);
  const options = [
    ...suggestions.map((s) => ({ kind: 'tag' as const, s })),
    ...(wantPack ? fromField.map((f) => ({ kind: 'pack' as const, f })) : []),
    ...(create ? [{ kind: 'create' as const, label: text.trim() }] : []),
  ];
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
    } else if (opt.kind === 'pack') {
      // One change: the concept (and the ancestors it lacks) becomes a tag and goes on the papers.
      setBusy(true);
      try {
        await rl.invoke('vocabPack:materialize', { conceptId: opt.f.conceptId, docIds: [...(pack?.docIds ?? [])] });
        invalidate('taxonomy');
        invalidate('documents');
        info(t('tags.changed', { count: pack?.docIds.length ?? 0 }));
        reset();
      } catch (e) {
        reportError(e);
      } finally {
        setBusy(false);
        input.current?.focus();
      }
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
      {similar && open && !exclude?.has(similar.id) && (
        <p className="tag-similar hint" data-testid="tag-picker-similar">
          {t('tags.similar', { name: safeText(similar.label), defaultValue: 'Similar to: {{name}}' })}{' '}
          <button type="button" className="link" onMouseDown={(e) => { e.preventDefault(); onPick(similar.id); reset(); }}>
            {t('tags.useSimilar', { name: safeText(similar.label), defaultValue: 'Use {{name}}' })}
          </button>
        </p>
      )}
      <ul id={listId} role="listbox" className="tag-options" hidden={!showList} data-testid="tag-options">
        {showList && options.map((o, i) => (
          <Fragment key={o.kind === 'tag' ? o.s.id : o.kind === 'pack' ? `pack:${o.f.conceptId}` : '__create__'}>
            {o.kind === 'pack' && options[i - 1]?.kind !== 'pack' && (
              <li role="presentation" className="tag-alias" data-testid="tag-picker-pack">
                {t('tagPicker.pack')}
              </li>
            )}
          <li
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            className={i === activeIndex ? 'active' : undefined}
            data-testid={o.kind === 'tag' ? 'tag-option' : o.kind === 'pack' ? 'tag-picker-pack-option' : 'tag-create'}
            data-tag={o.kind === 'tag' ? o.s.id : undefined}
            data-concept={o.kind === 'pack' ? o.f.conceptId : undefined}
            // mousedown, not click: the input must not lose the focus (and close the list) first
            onMouseDown={(e) => {
              e.preventDefault();
              void choose(i);
            }}
          >
            {o.kind === 'tag' ? (
              <>
                <span className="tag-option-main">
                  <span className="rl-swatch" style={model.byId.get(o.s.id)?.color ? ({ background: model.byId.get(o.s.id)?.color } as CSSProperties) : undefined} aria-hidden="true" />
                  {safeText(o.s.label)}
                  {o.s.viaAlias !== undefined && <span className="tag-alias"> {t('tags.viaAlias', { alias: safeText(o.s.viaAlias) })}</span>}
                </span>
                {o.s.path && <span className="tag-path">{safeText(o.s.path)}</span>}
              </>
            ) : o.kind === 'pack' ? (
              <>
                <span className="tag-option-main">{safeText(o.f.label)}</span>
                {o.f.path && <span className="tag-path">{safeText(o.f.path)}</span>}
              </>
            ) : (
              <span className="tag-option-main">{t('tags.create', { label: safeText(o.label) })}</span>
            )}
          </li>
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
