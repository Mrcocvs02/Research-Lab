import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Menu, type MenuGroup, type MenuGroups } from '../../components/Menu';
import { Popover } from '../../components/Popover';

/**
 * The shared chrome of the Map (§4.22): the header holds ONE `⋯` and the row ONE line of chips; each panel (kept mounted, hidden)
 * puts its own into those slots while it is the visible one, so the header and the row look the same in every tab.
 */
export interface Chrome {
  head: HTMLElement | null;
  row: HTMLElement | null;
  /** "Model options…" and "Rebuild the map": in the `⋯` of every tab. */
  model: MenuGroup;
}
export const ChromeCtx = createContext<Chrome>({ head: null, row: null, model: { id: 'model', items: [] } });

/** The `⋯` of the header with the menu of the tab and mode shown (≤ 7 entries, ≤ 3 groups). */
export function HeadMore({ active, testId, groups }: { active: boolean; testId: string; groups: readonly MenuGroup[] }) {
  const { t } = useTranslation();
  const c = useContext(ChromeCtx);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!active || !c.head) return null;
  return createPortal(
    <>
      <button ref={btn} type="button" className="icon-button net-more" aria-haspopup="menu" aria-expanded={open} aria-label={t('network.more')} title={t('network.more')} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        <span aria-hidden="true">⋯</span>
      </button>
      <Menu anchor={btn} open={open} onClose={() => setOpen(false)} groups={groups as MenuGroups} label={t('network.more')} width={260} />
    </>,
    c.head,
  );
}

/** Puts its children in the row under the header while the panel is the visible one. */
export function RowPortal({ active, children }: { active: boolean; children: ReactNode }) {
  const c = useContext(ChromeCtx);
  return active && c.row ? createPortal(children, c.row) : null;
}

/** A chip of the row that opens a popover: "Filters ▾", "Start ▾". `count` says how many of its settings are not the default. */
export function ChipPop({ label, prefix, testId, count = 0, width = 340, children }: { label: string; prefix?: string; testId: string; count?: number; width?: number; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={btn} type="button" className={count > 0 ? 'net-chip is-active' : 'net-chip'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {prefix && <span className="chip-prefix">{prefix} </span>}
        <span>{label}</span>
        {count > 0 && <span className="chip-count"> · {count}</span>}
        <span aria-hidden="true" className="chip-caret"> ▾</span>
      </button>
      <Popover anchor={btn} open={open} onClose={close} label={label} width={width} className="net-pop">
        {typeof children === 'function' ? children(close) : children}
      </Popover>
    </>
  );
}

/** One status pill over the canvas, top left (never a paragraph that pushes the canvas down). Optional link and ✕. */
export function Pill({ children, testId, onClose }: { children: ReactNode; testId: string; onClose?: (() => void) | undefined }) {
  const { t } = useTranslation();
  return (
    <p className="map-pill" role="status" data-testid={testId}>
      <span className="pill-text">{children}</span>
      {onClose && (
        <button type="button" className="link pill-x" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </p>
  );
}

let hintSeen = false;
/** The first-use hint of the canvas, once per installation (localStorage in try/catch). No button: it goes away by itself or at the first touch. */
export function useHint(enabled: boolean): [boolean, () => void] {
  const [seen, setSeen] = useState(() => {
    if (hintSeen) return true;
    try {
      return window.localStorage.getItem('rl.mapHint') === '1';
    } catch {
      return true;
    }
  });
  const dismiss = useCallback(() => {
    hintSeen = true;
    setSeen(true);
    try {
      window.localStorage.setItem('rl.mapHint', '1');
    } catch {
      /* storage unavailable: the hint shows again next time */
    }
  }, []);
  useEffect(() => {
    if (seen || !enabled) return;
    const id = setTimeout(dismiss, 9000);
    return () => clearTimeout(id);
  }, [seen, enabled, dismiss]);
  return [!seen && enabled, dismiss];
}

/** "Map to build" illustration of every empty state (one drawing, tokens only). */
export function MapIllustration() {
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="14" r="3.5" strokeDasharray="2 3" />
      <circle cx="35" cy="12" r="3.5" strokeDasharray="2 3" />
      <circle cx="24" cy="33" r="3.5" strokeDasharray="2 3" />
      <circle cx="39" cy="35" r="2.5" strokeDasharray="2 3" />
      <path d="M15 16l6 14M32 15l-6 15M27 34h9" strokeDasharray="1 4" />
    </svg>
  );
}

/** Copies the canvas as an image to the clipboard (downloads are blocked by the app, so there is no file to save). */
export async function copyCanvasImage(canvas: HTMLCanvasElement | null): Promise<boolean> {
  if (!canvas || typeof ClipboardItem === 'undefined') return false;
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
