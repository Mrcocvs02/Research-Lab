import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { canRead } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';

interface Hit {
  docId: string;
  title: string;
}

/**
 * "Open another paper beside this one…" (feature 3): the search of the palette, narrowed to the papers the reader can open.
 * Local search only; nothing is sent anywhere.
 */
export function PartnerPicker({ current, onPick, onClose }: { current: string; onPick(docId: string): void; onClose(): void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [at, setAt] = useState(0);
  const listId = useId();

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return setHits([]);
    let live = true;
    const timer = setTimeout(() => {
      rl.invoke('search:query', { text, limit: 12 }).then(
        (r) => live && setHits(r.hits.filter((h) => h.docId !== current && canRead(h.path, false)).map((h) => ({ docId: h.docId, title: safeText(h.title ?? h.path.split('/').pop() ?? h.docId) }))),
        () => live && setHits([]),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, current]);
  useEffect(() => setAt(0), [hits]);

  return (
    <Dialog title={t('reader.split.pickTitle')} onClose={onClose} testId="reader-split-picker">
      <div className="split-picker">
        <input
          type="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-label={t('reader.split.pickSearch')}
          placeholder={t('reader.split.pickSearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setAt((i) => Math.min(hits.length - 1, i + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setAt((i) => Math.max(0, i - 1)));
            else if (e.key === 'Enter' && hits[at]) (e.preventDefault(), onPick(hits[at]!.docId));
          }}
          data-testid="reader-split-search"
        />
        <ul id={listId} role="listbox" className="split-picker__list">
          {hits.map((h, i) => (
            <li key={h.docId} role="option" aria-selected={i === at} className={i === at ? 'is-on' : undefined} onMouseEnter={() => setAt(i)} onClick={() => onPick(h.docId)} data-testid="reader-split-hit">
              {h.title}
            </li>
          ))}
        </ul>
        {query.trim().length >= 2 && hits.length === 0 && <p className="hint">{t('reader.split.pickNone')}</p>}
      </div>
    </Dialog>
  );
}
