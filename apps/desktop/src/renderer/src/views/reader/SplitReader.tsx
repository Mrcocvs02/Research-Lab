import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../../lib/notify';
import { useReader, type ReaderTarget } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { ReaderView, type SplitProps } from './ReaderView';
import { clampRatio, isNarrow, linkedTop, moveFocus, pairTitle, type Side } from './splitModel';
import './split.css';

/**
 * Two papers side by side (feature 3, §17.4.11, D-427). Each side is a whole reader (`ReaderView`) with its own pages,
 * tools and notes; the bar of the shell belongs to ONE of them, the one with the focus (2 px accent border). Below 1280 px
 * the second paper is a tab that alternates with the first (Ctrl+Tab) and a toast says why. The divider drags, and carries
 * "Swap" and the scroll link (off by default, Ctrl+Alt+L). Nothing is stored: the position of each paper is the one every
 * reading keeps.
 */
export function SplitReader({ target, onClose }: { target: ReaderTarget; onClose(): void }) {
  const { t } = useTranslation();
  const { info } = useNotify();
  const { openReader } = useReader();
  const [active, setActive] = useState<Side>(0);
  const [ratio, setRatio] = useState(0.5);
  const [swapped, setSwapped] = useState(false);
  const [linked, setLinked] = useState(false);
  const [narrow, setNarrow] = useState(() => isNarrow(window.innerWidth));
  const [titles, setTitles] = useState<readonly [string, string]>(['', '']);
  const box = useRef<HTMLDivElement>(null);
  const docs = useMemo(() => [target.docId, target.beside ?? target.docId] as const, [target.docId, target.beside]);
  const targets = useMemo<readonly [ReaderTarget, ReaderTarget]>(() => [target, { docId: docs[1], nonce: target.nonce }], [target, docs]);

  useEffect(() => {
    let alive = true;
    rl.invoke('links:titles', { docIds: [...docs], projectIds: [] }).then(
      (r) => alive && setTitles([safeText(r.docs[docs[0]] ?? ''), safeText(r.docs[docs[1]] ?? '')]),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [docs]);

  // The window narrows or widens: tabs below 1280 px, with the reason shown when it happens.
  useEffect(() => {
    const onResize = () => setNarrow(isNarrow(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const toasted = useRef(false);
  useEffect(() => {
    if (narrow && !toasted.current) {
      toasted.current = true;
      info(t('reader.split.narrow'));
    }
    if (!narrow) toasted.current = false;
  }, [narrow, info, t]);

  // The focus follows the pointer or the keyboard into a side.
  const focusSide = useCallback((side: Side) => {
    setActive(side);
    box.current?.querySelector<HTMLElement>(`[data-side="${side}"] [data-testid="reader-pages-area"]`)?.focus({ preventScroll: true });
  }, []);
  const order: readonly [Side, Side] = swapped ? [1, 0] : [0, 1];

  const onKeyDown = (e: KeyboardEvent) => {
    const alt = e.ctrlKey && e.altKey && !e.shiftKey;
    if (alt && e.key === 'ArrowLeft') return (e.preventDefault(), focusSide(moveFocus(order, 'left')));
    if (alt && e.key === 'ArrowRight') return (e.preventDefault(), focusSide(moveFocus(order, 'right')));
    if (alt && e.key.toLowerCase() === 'l') return (e.preventDefault(), setLinked((v) => !v));
    if (narrow && e.ctrlKey && !e.altKey && e.key === 'Tab') return (e.preventDefault(), focusSide(active === 0 ? 1 : 0));
  };

  // The scroll link: the side that moves drags the other to the same fraction of its length (a flag keeps it from echoing).
  const echo = useRef(false);
  const onScroll = (e: React.UIEvent) => {
    if (!linked || narrow || echo.current) {
      echo.current = false;
      return;
    }
    const from = e.target as HTMLElement;
    if (!from.matches?.('[data-testid="reader-pages-area"]')) return;
    const side = Number(from.closest<HTMLElement>('[data-side]')?.dataset['side']);
    const other = box.current?.querySelector<HTMLElement>(`[data-side="${side === 0 ? 1 : 0}"] [data-testid="reader-pages-area"]`);
    if (!other) return;
    const top = linkedTop(from, other);
    if (Math.abs(other.scrollTop - top) > 1) {
      echo.current = true;
      other.scrollTop = top;
    }
  };

  const drag = useRef(false);
  const onDivider = (e: PointerEvent) => {
    if (!drag.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    setRatio(clampRatio(swapped ? 1 - x : x));
  };

  const props = (side: Side): SplitProps => ({
    active: active === side,
    onFocus: () => setActive(side),
    title: pairTitle(titles[side] || t('reader.untitled'), titles[side === 0 ? 1 : 0] || t('reader.untitled')),
    onUnsplit: () => openReader(docs[side]),
  });
  const basis = (side: Side) => (narrow ? '100%' : `${(side === 0 ? ratio : 1 - ratio) * 100}%`);
  const tabs = narrow;

  return (
    <div ref={box} className="split" data-testid="reader-split" data-narrow={narrow ? '' : undefined} data-active={active} onKeyDown={onKeyDown} onScrollCapture={onScroll}>
      {tabs && (
        <div className="split__tabs" role="tablist" aria-label={t('reader.split.tabs')} data-testid="reader-split-tabs">
          {([0, 1] as const).map((side) => (
            <button key={side} type="button" role="tab" aria-selected={active === side} className={active === side ? 'rl-tab is-on' : 'rl-tab'} onClick={() => focusSide(side)} data-testid={`reader-split-tab-${side}`} title="Ctrl+Tab">
              {titles[side] || t('reader.untitled')}
            </button>
          ))}
        </div>
      )}
      {([0, 1] as const).map((side) => (
        <div
          key={docs[side] + side}
          className="split__pane"
          data-side={side}
          data-focus={active === side ? '' : undefined}
          data-hidden={narrow && active !== side ? '' : undefined}
          inert={narrow && active !== side ? true : undefined}
          style={{ flexBasis: basis(side), order: (order[0] === side ? 0 : 2) }}
          onPointerDownCapture={() => setActive(side)}
          onFocusCapture={() => setActive(side)}
        >
          <ReaderView target={targets[side]} onClose={onClose} split={props(side)} />
        </div>
      ))}
      {!narrow && (
        <div
          className="split__divider"
          style={{ order: 1 }}
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={25}
          aria-valuemax={75}
          aria-label={t('reader.split.divider')}
          tabIndex={0}
          data-testid="reader-split-divider"
          onPointerDown={(e) => {
            drag.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={onDivider}
          onPointerUp={() => (drag.current = false)}
          onPointerCancel={() => (drag.current = false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              setRatio((r) => clampRatio(r + (e.key === 'ArrowLeft' ? -0.02 : 0.02) * (swapped ? -1 : 1)));
            }
          }}
        >
          <button type="button" className="split__btn" onClick={() => setSwapped((v) => !v)} title={t('reader.split.swap')} aria-label={t('reader.split.swap')} data-testid="reader-split-swap">
            ⇆
          </button>
          <button type="button" className="split__btn" aria-pressed={linked} onClick={() => setLinked((v) => !v)} title={`${t('reader.split.link')} · Ctrl+Alt+L`} aria-label={t('reader.split.link')} data-testid="reader-split-link">
            ⛓
          </button>
        </div>
      )}
    </div>
  );
}
