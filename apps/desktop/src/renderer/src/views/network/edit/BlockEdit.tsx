import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf, TaxonomyView } from '@rl/core';
import { Menu } from '../../../components/Menu';
import { Popover } from '../../../components/Popover';
import { useNotify } from '../../../lib/notify';
import { rl } from '../../../lib/rl';
import { safeText } from '../../library/safeText';
import type { BlockBox } from '../blocksDraw';
import { conventionLabel, editableFamily, menuItem } from './editModel';

type Scope = RequestOf<Channels, 'graph:nameFamily'>['scope'];

export interface At {
  x: number;
  y: number;
}

const token = (tint: number): string => `var(--area-${tint < 7 ? tint + 1 : 'other'})`;

/** An invisible 1 px anchor at a point of the window (a right click, the paper under the keyboard cursor): the popovers hang from it. */
function useAnchor(at: At) {
  const ref = useRef<HTMLSpanElement>(null);
  const el = <span ref={ref} className="map-edit-anchor" style={{ left: at.x, top: at.y }} aria-hidden="true" />;
  return { ref, el };
}

function Swatch({ b }: { b: BlockBox }) {
  return <span className={b.tint === 8 ? 'rl-swatch area-dot area-ring' : 'rl-swatch area-dot'} style={b.tint === 8 ? undefined : { background: token(b.tint) }} aria-hidden="true" />;
}

/**
 * "Move to..." (M, the card, the panel, the bar): the blocks of the family as a list (dot, name, count) plus "No value" and, in a family of
 * several values, the box that also takes the paper off its old value. Up and down move, Enter picks, Esc closes (D-522).
 */
export function MoveMenu({ at, blocks, current, many, count, onPick, onClose }: { at: At; blocks: readonly BlockBox[]; current: ReadonlySet<string>; many: boolean; count: number; onPick(to: string | null, removeFrom: boolean): void; onClose(): void }) {
  const { t } = useTranslation();
  const { ref, el } = useAnchor(at);
  const rows = useMemo(() => blocks.filter((b) => !b.other), [blocks]);
  const [at2, setAt] = useState(0);
  const [remove, setRemove] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.focus(), []);
  const pick = (b: BlockBox) => {
    onClose();
    onPick(b.none ? null : b.id, remove);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setAt((i) => (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % Math.max(rows.length, 1));
    else if (e.key === 'Home') setAt(0);
    else if (e.key === 'End') setAt(rows.length - 1);
    else if (e.key === 'Enter' && rows[at2]) pick(rows[at2]!);
    else return;
    e.preventDefault();
  };
  return (
    <>
      {el}
      <Popover anchor={ref} open onClose={onClose} label={t('mapEdit.moveTo')} width={280}>
        <div className="map-move" data-testid="map-move-menu" data-count={count}>
          <div className="map-move-title">{t('mapEdit.moveToCount', { count })}</div>
          <div ref={list} role="listbox" tabIndex={0} aria-label={t('mapEdit.moveTo')} aria-activedescendant={`map-move-${at2}`} className="map-move-list" onKeyDown={onKey}>
            {rows.map((b, i) => (
              <div key={b.id} id={`map-move-${i}`} role="option" aria-selected={i === at2} className={i === at2 ? 'map-move-row is-on' : 'map-move-row'} data-testid="map-move-option" data-block={b.id} onMouseEnter={() => setAt(i)} onClick={() => pick(b)}>
                <Swatch b={b} />
                <span className="map-move-name">{b.none ? t('mapEdit.noValue') : safeText(b.label)}</span>
                {current.has(b.id) && <span aria-label={t('mapEdit.here')}>✓</span>}
                <span className="hint">{b.count}</span>
              </div>
            ))}
          </div>
          {many && (
            <label className="map-move-remove">
              <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} data-testid="map-move-remove" />
              <span>{t('mapEdit.removeOld')}</span>
            </label>
          )}
        </div>
      </Popover>
    </>
  );
}

export type BlockStep = 'menu' | 'rename';

export interface BlockMenuProps {
  block: BlockBox;
  blocks: readonly BlockBox[];
  family: string;
  scope: Scope;
  at: At;
  step: BlockStep;
  /** "Select the papers of the block". */
  onSelect(): void;
  onLibrary(): void;
  onMacro(): void;
  /** A rename or a merge was written: reload the blocks, offer the undo. */
  onChanged(text: string, changeId: string | null): void;
  onClose(): void;
}

/**
 * The menu of a block (right click on its name, the ... that appears over it, F2 or the Menu key in the list): Rename, Merge with..., Select
 * its papers, Show in the Library, Suggest macro-areas (D-523). Rename and merge write one change each, undone as one.
 */
export function BlockMenu(p: BlockMenuProps) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const { ref, el } = useAnchor(p.at);
  const [step, setStep] = useState<BlockStep | 'merge' | 'confirm' | null>(p.step);
  const [target, setTarget] = useState<BlockBox | null>(null);
  const [text, setText] = useState(p.block.label);
  const [tax, setTax] = useState<TaxonomyView | null>(null);
  const [busy, setBusy] = useState(false);
  const auto = p.family === 'auto';
  const tagBlock = editableFamily(p.family) && !p.block.none && !p.block.other;
  const close = () => setStep(null);
  useEffect(() => {
    if (step === null) p.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => {
    if (!tagBlock) return;
    let live = true;
    rl.invoke('taxonomy:get', {}).then((v) => live && setTax(v), () => undefined);
    return () => {
      live = false;
    };
  }, [tagBlock]);
  const node = tax?.nodes.find((n) => n.id === p.block.id);
  const named = conventionLabel(text);
  const others = p.blocks.filter((b) => b.id !== p.block.id && !b.none && !b.other);
  const noRename = p.block.none || p.block.other ? t('mapEdit.noRename') : !auto && !tagBlock ? t('mapEdit.notEditable') : undefined;
  const noMerge = !tagBlock ? t('mapEdit.noMerge') : others.length === 0 ? t('mapEdit.mergeNone') : undefined;
  const noMacro = !editableFamily(p.family) ? t('mapEdit.macroOnly') : p.blocks.filter((b) => !b.none && !b.other).length < 2 ? t('mapEdit.macroFew') : undefined;

  const run = async (go: () => Promise<{ changeId: string | null }>, done: string) => {
    setBusy(true);
    try {
      const r = await go();
      p.onChanged(done, r.changeId);
      close();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };
  const rename = () => {
    const name = named.trim();
    if (name === '' || name === p.block.label) return close();
    if (auto) void run(async () => (await rl.invoke('graph:acceptFamilyName', { cluster: p.block.id, name, scope: p.scope }), { changeId: null }), t('mapEdit.renamed', { from: p.block.label, to: name }));
    else {
      const aliases = [p.block.label, ...(node?.aliases ?? [])].filter((a, i, all) => a !== name && all.indexOf(a) === i);
      void run(async () => {
        const r = await rl.invoke('taxonomy:apply', { ops: [{ op: 'rename', id: p.block.id, label: name }, { op: 'setAliases', id: p.block.id, aliases }], ...(tax ? { expectedRevision: tax.revision } : {}) });
        return { changeId: r.changeId };
      }, t('mapEdit.renamed', { from: p.block.label, to: name }));
    }
  };
  const merge = () => {
    if (!target) return;
    void run(async () => ({ changeId: (await rl.invoke('taxonomy:apply', { ops: [{ op: 'merge', from: p.block.id, into: target.id }] })).changeId }), t('mapEdit.merged', { a: p.block.label, b: target.label }));
  };

  return (
    <>
      {el}
      <Menu
        anchor={ref}
        open={step === 'menu'}
        label={t('mapEdit.blockMenu', { name: p.block.label })}
        onClose={() => setStep((s) => (s === 'menu' ? null : s))}
        groups={[
          {
            id: 'block',
            items: [
              menuItem({ id: 'rename', testId: 'map-block-rename', label: t('mapEdit.rename'), keys: 'F2', onSelect: () => setStep('rename') }, noRename),
              menuItem({ id: 'merge', testId: 'map-block-merge', label: t('mapEdit.mergeWith'), onSelect: () => setStep('merge') }, noMerge),
              { id: 'select', testId: 'map-block-select', label: t('mapEdit.selectPapers', { count: p.block.count }), onSelect: () => (p.onSelect(), close()) },
              { id: 'library', testId: 'map-block-library', label: t('mapEdit.showInLibrary'), onSelect: () => (p.onLibrary(), close()) },
              menuItem({ id: 'macro', testId: 'map-block-macro', label: t('mapEdit.macroMore'), onSelect: () => (p.onMacro(), close()) }, noMacro),
            ],
          },
        ]}
      />
      <Popover anchor={ref} open={step === 'rename'} onClose={close} label={t('mapEdit.rename')} width={280}>
        <form
          className="map-rename"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <label htmlFor="map-rename-input">{t('mapEdit.renameLabel')}</label>
          <input id="map-rename-input" autoFocus value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.currentTarget.select()} data-testid="map-block-rename-input" />
          {named !== text && named.trim() !== '' && (
            <p className="hint" data-testid="map-block-rename-as">
              {t('mapEdit.renameAs', { name: named })}
            </p>
          )}
          {!auto && <p className="hint">{t('mapEdit.renameAlias', { name: p.block.label })}</p>}
          <div className="map-rename-actions">
            <button type="button" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="primary" disabled={busy || named.trim() === ''} data-testid="map-block-rename-ok">
              {t('mapEdit.renameDo')}
            </button>
          </div>
        </form>
      </Popover>
      <Popover anchor={ref} open={step === 'merge'} onClose={close} label={t('mapEdit.mergeWith')} width={280}>
        <ul className="map-merge" data-testid="map-block-merge-list">
          {others.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="legend-item"
                data-testid="map-block-merge-target"
                data-block={b.id}
                onClick={() => {
                  setTarget(b);
                  setStep('confirm');
                }}
              >
                <Swatch b={b} />
                <span className="legend-text">{safeText(b.label)}</span>
                <span className="hint">{b.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
      <Popover anchor={ref} open={step === 'confirm' && target !== null} onClose={close} label={t('mapEdit.mergeWith')} width={280}>
        {target && (
          <div className="map-rename" data-testid="map-block-merge-confirm">
            <p>{t('mapEdit.merge.confirm', { a: safeText(p.block.label), na: p.block.count, b: safeText(target.label), nb: target.count })}</p>
            <div className="map-rename-actions">
              <button type="button" onClick={close}>
                {t('common.cancel')}
              </button>
              <button type="button" className="primary" disabled={busy} onClick={merge} data-testid="map-block-merge-ok">
                {t('mapEdit.mergeDo')}
              </button>
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
