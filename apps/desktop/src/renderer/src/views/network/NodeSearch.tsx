import { forwardRef, useEffect, useId, useState } from 'react';
import { safeText } from '../library/safeText';

export interface SearchItem {
  id: string;
  label: string;
  hint?: string | undefined;
}

interface Props {
  label: string;
  placeholder: string;
  /** Candidates for the text (a list, or a promise for a remote search). */
  suggest(text: string): SearchItem[] | Promise<SearchItem[]>;
  /** Enter on a candidate: the camera flies to it. */
  onPick(item: SearchItem): void;
  testId: string;
}

/** "Vai a…" field of the toolbar: type, arrows choose, Enter flies to the node (the same search as the palette for documents). */
export const NodeSearch = forwardRef<HTMLInputElement, Props>(function NodeSearch({ label, placeholder, suggest, onPick, testId }, ref) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (text.trim() === '') return setItems([]);
    let live = true;
    const run = setTimeout(() => {
      Promise.resolve(suggest(text.trim())).then(
        (r) => live && (setItems(r.slice(0, 8)), setAt(0)),
        () => live && setItems([]),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const pick = (item: SearchItem | undefined) => {
    if (!item) return;
    setText('');
    setItems([]);
    setOpen(false);
    onPick(item);
  };
  return (
    <div className="nodesearch">
      <input
        ref={ref}
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setAt((a) => (items.length === 0 ? 0 : (a + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(items[at]);
          } else if (e.key === 'Escape') {
            setText('');
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      {open && items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="nodesearch-list" data-testid={`${testId}-list`}>
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === at} className={i === at ? 'on' : undefined} onMouseDown={(e) => (e.preventDefault(), pick(it))} data-testid={`${testId}-item`} data-id={it.id}>
              {safeText(it.label)}
              {it.hint && <span className="hint"> {safeText(it.hint)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
