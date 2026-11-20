import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../../../components/Lazy';
import { Menu, type MenuItem } from '../../../components/Menu';
import { Popover } from '../../../components/Popover';
import { useNotify } from '../../../lib/notify';
import { rl } from '../../../lib/rl';
import { TagPicker } from '../../library/TagParts';
import { useTagActions } from '../../library/useTagActions';
import { TaxonomyProvider, useTaxonomy } from '../../library/useTaxonomy';
import type { At } from './BlockEdit';
import { menuItem } from './editModel';

const AddToProject = lazyView(() => import('../../library/AddToProject').then((m) => ({ default: m.AddToProject })), ['addToProject', 'projects']);

/** Tags of the selection (D-535): the picker of the Library; a family of one value says first that it replaces the value. */
function TagBody({ docIds, onDone }: { docIds: string[]; onDone(): void }) {
  const { t } = useTranslation();
  const { model } = useTaxonomy();
  const { tag, createAndAdd, busy } = useTagActions();
  const [ask, setAsk] = useState<string | null>(null);
  const single = (id: string): boolean => {
    let cur = model.byId.get(id);
    for (let i = 0; cur && cur.parents.length > 0 && i < 8; i++) cur = model.byId.get(cur.parents[0]!);
    return cur?.family === 'one';
  };
  const add = async (id: string) => {
    if (await tag(docIds, { add: [id] })) onDone();
  };
  return (
    <div className="map-rename" data-testid="map-sel-tag-pop">
      <TagPicker model={model} ariaLabel={t('mapSel.tagAria')} placeholder={t('mapSel.tagPlaceholder', { count: docIds.length })} onPick={(id) => (single(id) ? setAsk(id) : void add(id))} onCreate={(text) => createAndAdd(docIds, text)} pack={docIds.length <= 500 ? { docIds } : undefined} testId="map-sel-tag-input" autoFocus disabled={busy} />
      {ask && (
        <div role="alert" data-testid="map-sel-tag-confirm">
          <p>{t('mapSel.replace', { count: docIds.length })}</p>
          <div className="map-rename-actions">
            <button type="button" onClick={() => setAsk(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void add(ask)} data-testid="map-sel-tag-confirm-ok">
              {t('mapSel.replaceDo')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Item {
  id: string;
  testId: string;
  label: string;
  run(): void;
  ref?: RefObject<HTMLButtonElement | null>;
  /** Why the action is off. */
  reason?: string;
}

interface Props {
  ids: string[];
  /** The selection hit the cap and was cut (D-534). */
  capped: boolean;
  /** From 1440 px the bar sits at the top of the side column; below, it stands in for the strip and shows two actions. */
  wide: boolean;
  /** The family can be edited by hand: "Move to..." is on. */
  canMove: boolean;
  moveReason: string;
  onClear(): void;
  onMove(at: At): void;
  onLibrary(): void;
  /** "Next to read" starting from the selection (the reading section of the Map); absent: not offered. */
  onNext?: (() => void) | undefined;
}

/**
 * The bar of a multiple selection (D-524): never over the canvas. Add to project, Tags, Move to..., Show in the Library, Copy BibTeX, Next to
 * read, and the cross that clears the selection; below 1440 px what does not fit in the first two places goes in a ... menu.
 */
export default function MapSelectionBar({ ids, capped, wide, canMove, moveReason, onClear, onMove, onLibrary, onNext }: Props) {
  const { t } = useTranslation();
  const { info, reportError } = useNotify();
  const [project, setProject] = useState(false);
  const [tags, setTags] = useState(false);
  const [more, setMore] = useState(false);
  const tagBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const moveBtn = useRef<HTMLButtonElement>(null);
  const copy = async () => {
    try {
      const r = await rl.invoke('bib:copy', { docIds: ids });
      info(t('mapSel.copied', { count: r.count }));
    } catch (e) {
      reportError(e);
    }
  };
  const moveAt = (el: HTMLElement | null): At => {
    const r = el?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.bottom ?? 0 };
  };
  const items: Item[] = [
    { id: 'project', testId: 'map-sel-project', label: t('mapSel.project'), run: () => setProject(true) },
    { id: 'tag', testId: 'map-sel-tag', label: t('mapSel.tag'), run: () => setTags(true), ref: tagBtn },
    { id: 'move', testId: 'map-sel-move', label: t('mapEdit.moveTo'), run: () => onMove(moveAt(moveBtn.current ?? moreBtn.current)), ref: moveBtn, ...(canMove ? {} : { reason: moveReason }) },
    { id: 'library', testId: 'map-sel-library', label: t('mapSel.library'), run: onLibrary },
    { id: 'bibtex', testId: 'map-sel-bibtex', label: t('mapSel.bibtex'), run: () => void copy() },
    ...(onNext ? [{ id: 'next', testId: 'map-sel-next', label: t('mapSel.next'), run: onNext }] : []),
  ];
  const shown = wide ? items : items.slice(0, 2);
  const rest = wide ? [] : items.slice(2);
  const menuItems: MenuItem[] = rest.map((i) => menuItem({ id: i.id, testId: i.testId, label: i.label, onSelect: i.run }, i.reason));
  return (
    <>
      <div className="map-selbar" role="toolbar" aria-label={t('mapSel.bar')} data-testid="map-selbar" data-count={ids.length}>
        <span className="map-selbar-count" data-testid="map-sel-count">
          {t('mapSel.count', { count: ids.length })}
          {capped && <span className="hint"> · {t('mapSel.capped', { n: ids.length })}</span>}
        </span>
        <div className="map-selbar-actions">
          {shown.map((i) => (
            <button key={i.id} ref={i.ref} type="button" disabled={!!i.reason} title={i.reason} onClick={i.run} data-testid={i.testId}>
              {i.label}
            </button>
          ))}
          {rest.length > 0 && (
            <button ref={moreBtn} type="button" className="icon-button" aria-haspopup="menu" aria-label={t('mapSel.more')} title={t('mapSel.more')} onClick={() => setMore(true)} data-testid="map-sel-more">
              <span aria-hidden="true">⋯</span>
            </button>
          )}
          <button type="button" className="icon-button" aria-label={t('mapSel.clear')} title={t('mapSel.clear')} onClick={onClear} data-testid="map-sel-clear">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      {menuItems.length > 0 && <Menu anchor={moreBtn} open={more} onClose={() => setMore(false)} label={t('mapSel.more')} groups={[{ id: 'sel', items: menuItems }]} />}
      <Popover anchor={tagBtn} open={tags} onClose={() => setTags(false)} label={t('mapSel.tag')} width={320}>
        <TaxonomyProvider>
          <TagBody docIds={ids} onDone={() => setTags(false)} />
        </TaxonomyProvider>
      </Popover>
      {project && (
        <Lazy>
          <AddToProject docIds={ids} onClose={() => setProject(false)} />
        </Lazy>
      )}
    </>
  );
}
