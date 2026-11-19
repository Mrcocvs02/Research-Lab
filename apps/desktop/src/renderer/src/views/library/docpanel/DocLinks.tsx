import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReader } from '../../../lib/reader';
import { rl } from '../../../lib/rl';
import { reasonLine, weightBar, type LinkReasons } from '../../links/reasons';
import { safeText } from '../safeText';
import '../../links/links.css';

interface Item {
  id: string;
  docId: string;
  title: string;
  weight: number;
  reasons: LinkReasons;
}

/**
 * The "Links" section of the card (§18.2): the links found or added for this document, with a sentence for the reason, the
 * weight and a ✕ that removes the link. Without links the section is not there. `version` changes when the finder closed.
 */
export function DocLinks({ docId, version = 0 }: { docId: string; version?: number }) {
  const { t } = useTranslation();
  const { openReader } = useReader();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let live = true;
    rl.invoke('doclinks:list', { docId }).then(
      (r) => live && setItems(r.items as Item[]),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [docId, version]);

  if (items.length === 0) return null;
  const tr = (part: string, o: Record<string, unknown> = {}) => t(`links.reason.${part}`, o);
  return (
    <section className="card-section" data-testid="doc-links">
      <h3 className="card-state__label">{t('docLinks.title')}</h3>
      <ul className="lf-list">
        {items.map((l) => (
          <li key={l.id} className="lf-row" data-testid="doc-link" data-doc-id={l.docId}>
            <button type="button" className="link lf-row__title" onClick={() => openReader(l.docId)} title={safeText(l.title)}>
              {safeText(l.title)}
            </button>
            <span className="lf-row__weight">
              {weightBar(l.weight)} {l.weight.toFixed(2)}
            </span>
            <span className="hint lf-row__why">{reasonLine(l.reasons, tr, safeText)}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t('docLinks.remove', { title: safeText(l.title) })}
              onClick={() => void rl.invoke('doclinks:remove', { ids: [l.id] }).then(() => setItems((cur) => cur.filter((x) => x.id !== l.id)), () => undefined)}
              data-testid="doc-link-remove"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
