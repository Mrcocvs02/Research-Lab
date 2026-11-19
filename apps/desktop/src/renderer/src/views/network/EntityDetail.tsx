import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { mergeAuthors, splitAuthor } from './authorAliases';
import type { EntityMode, EntityNode } from './entityTypes';
import { YearBars } from './HoverCard';
import { useOpenInLibrary } from './libraryOpen';
import { DocLink } from './SimilarPanel';

type Related = ResponseOf<Channels, 'explore:related'>['nodes'];
const PAGE = 25;

interface Props {
  mode: EntityMode;
  entity: EntityNode;
  /** The other entities of the network (candidates for "Merge with…"). */
  peers: readonly EntityNode[];
  yearRange?: [number, number] | undefined;
  onClose(): void;
  onOpenDoc(docId: string): void;
}

/** The card of an entity in the side panel (§4.21.4): counts, "Open in the Library", its documents, "Related" and, for an author, "Separate" and "Merge with…". */
export function EntityDetail({ mode, entity, peers, yearRange, onClose, onOpenDoc }: Props) {
  const { t } = useTranslation();
  const lib = useApp().activeLibraryId ?? '';
  const open = useOpenInLibrary();
  const [docs, setDocs] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [related, setRelated] = useState<Array<{ to: 'author' | 'topic'; nodes: Related }>>([]);
  const [mergeWith, setMergeWith] = useState('');
  const key = entity.id.startsWith('author:') ? entity.id.slice(7) : entity.id;

  useEffect(() => {
    let live = true;
    setDocs([]);
    setTotal(0);
    rl.invoke('explore:documents', { dimension: 'author', id: entity.id, limit: PAGE, offset: 0 }).then(
      (r) => live && (setDocs(r.docIds), setTotal(r.total)),
      () => undefined,
    );
    rl.invoke('explore:related', { from: { dimension: 'author', id: entity.id }, to: 'topic', limit: 5 }).then(
      (r) => live && setRelated(r.nodes.length > 0 ? [{ to: 'topic', nodes: r.nodes }] : []),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [entity.id]);

  const more = () => {
    rl.invoke('explore:documents', { dimension: 'author', id: entity.id, limit: PAGE, offset: docs.length }).then(
      (r) => setDocs((d) => [...d, ...r.docIds]),
      () => undefined,
    );
  };
  const forms = entity.variants ?? [];
  const candidates = peers.filter((p) => p.id !== entity.id && p.id.startsWith('author:'));

  return (
    <aside className="net-detail ent-detail" aria-label={t('network.ent.detail')} data-testid="entity-detail" data-entity-id={entity.id} data-mode={mode}>
      <header>
        <h2 data-testid="entity-detail-title">{safeText(entity.label)}</h2>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose} data-testid="entity-detail-close">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {forms.length > 1 && (
        <p className="hint" data-testid="entity-forms">
          {t('network.ent.also', { names: forms.filter((f) => f !== entity.label).map(safeText).join(', ') })}
        </p>
      )}
      <p>
        <span data-testid="entity-count">{t('network.ent.documents', { count: entity.count })}</span>
        {yearRange ? ` · ${yearRange[0]}–${yearRange[1]}` : ''} <YearBars years={entity.years} range={yearRange} />
      </p>
      <div className="net-toolbar">
        <button type="button" className="primary" onClick={() => open(entity)} data-testid="entity-open-library">
          {t('network.ent.openLibrary')}
        </button>
      </div>
      <div className="net-toolbar ent-alias" data-testid="entity-alias">
        {forms.length > 1 && (
          <button type="button" onClick={() => void splitAuthor(lib, key).catch(() => {})} data-testid="entity-split">
            {t('network.ent.split')}
          </button>
        )}
        <label className="net-field">
          <span>{t('network.ent.mergeWith')}</span>
          <select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)} data-testid="entity-merge-select">
            <option value="">{t('network.scope.pick')}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {safeText(p.label)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={mergeWith === ''} onClick={() => (void mergeAuthors(lib, key, mergeWith.slice(7)).catch(() => {}), setMergeWith(''))} data-testid="entity-merge">
          {t('network.ent.merge')}
        </button>
      </div>
      <h3>{t('network.ent.docs')}</h3>
      <ul className="sim-list" data-testid="entity-docs">
        {docs.map((d) => (
          <li key={d} className="sim-row" data-doc-id={d}>
            <DocLink docId={d} onOpen={onOpenDoc} />
          </li>
        ))}
      </ul>
      {docs.length < total && (
        <button type="button" onClick={more} data-testid="entity-docs-more">
          {t('network.explore.more', { count: total - docs.length })}
        </button>
      )}
      {related.map((r) => (
        <section key={r.to} data-testid="entity-related" data-to={r.to}>
          <h3>{t(`network.ent.related.${r.to}`)}</h3>
          <ul className="sim-list">
            {r.nodes.map((n) => (
              <li key={n.id} className="sim-row">
                {safeText(n.label)} <span className="hint">({n.count})</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
