import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';

/** What the card of a hovered document shows (title, authors, year); kept for the session like the titles of chips. */
export interface DocInfo {
  title: string;
  authors: string[];
  year: number | null;
}
const infoCache = new Map<string, DocInfo | null>();

export function useDocInfo(docId: string | null): DocInfo | null {
  const lib = useApp().activeLibraryId ?? '';
  const key = docId ? `${lib}/${docId}` : null;
  const [info, setInfo] = useState<DocInfo | null>(key ? (infoCache.get(key) ?? null) : null);
  useEffect(() => {
    if (!key || !docId) return setInfo(null);
    const known = infoCache.get(key);
    if (known !== undefined) return setInfo(known);
    let live = true;
    rl.invoke('documents:get', { docId }).then(
      (d) => {
        const v = { title: d.title ?? docId.slice(0, 8), authors: d.authors, year: d.year };
        infoCache.set(key, v);
        if (live) setInfo(v);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, docId]);
  return info;
}

/** Ten bars of publication years (`--accent` at 60%), with the range under them when it is known. */
export function YearBars({ years, range }: { years: readonly number[]; range?: readonly [number, number] | undefined }) {
  const max = Math.max(1, ...years);
  return (
    <span className="yearbars" role="img" aria-label={range ? `${range[0]}–${range[1]}` : undefined} data-testid="year-bars">
      <svg viewBox="0 0 50 14" width="50" height="14" aria-hidden="true">
        {years.map((n, i) => (
          <rect key={i} x={i * 5} y={14 - (n / max) * 13 - (n > 0 ? 1 : 0)} width="4" height={(n / max) * 13 + (n > 0 ? 1 : 0)} rx="1" />
        ))}
      </svg>
    </span>
  );
}

/**
 * The card that follows a hovered node (§4.20): `--surface`, `--e-2`, `--r-md`, 280 px, kept inside the view. It does not catch
 * the pointer, unless it is `live` (a card with a menu): then it takes the pointer, and `onEnter` / `onLeave` keep it open while
 * the pointer is on it. The caller shows it after the pointer rested 150 ms (see `useRestingHover`).
 */
export function HoverCard({ x, y, width, height, testId, children, live }: { x: number; y: number; width: number; height: number; testId: string; children: ReactNode; live?: { label: string; onEnter(): void; onLeave(): void } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 280, h: 90 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || 280;
    const h = el.offsetHeight || 90;
    setSize((cur) => (cur.w === w && cur.h === h ? cur : { w, h }));
  }, [children]);
  const left = Math.max(4, Math.min(x + 14, width - size.w - 4));
  const top = Math.max(4, Math.min(y + 14, height - size.h - 4));
  return (
    <div ref={ref} className={live ? 'hovercard hc-live' : 'hovercard'} role={live ? 'group' : 'tooltip'} aria-label={live?.label} style={{ left, top }} data-testid={testId} onPointerEnter={live?.onEnter} onPointerLeave={live?.onLeave}>
      {children}
    </div>
  );
}

/**
 * Hover that settles: `set(h)` shows `h` after 150 ms of rest, and `set(null)` hides at once (after `grace` ms when a card with
 * a menu has to be reachable: `hold(true)` while the pointer is on the card cancels that, `hold(false)` hides it).
 */
export function useRestingHover<T>(ms = 150, grace = 0): [T | null, (h: T | null) => void, (on: boolean) => void] {
  const [shown, setShown] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = (h: T | null) => {
    clearTimeout(timer.current);
    if (h === null) {
      if (grace > 0) timer.current = setTimeout(() => setShown(null), grace);
      else setShown(null);
    } else timer.current = setTimeout(() => setShown(h), ms);
  };
  const hold = (on: boolean) => {
    clearTimeout(timer.current);
    if (!on) setShown(null);
  };
  return [shown, set, hold];
}

/** The card of a document: title (two lines), authors and year, the topic. */
export function DocCard({ docId, topic, area }: { docId: string; topic?: string | undefined; area?: string | undefined }) {
  const { t } = useTranslation();
  const info = useDocInfo(docId);
  return (
    <>
      <strong className="hc-title">{safeText(info?.title ?? docId.slice(0, 8))}</strong>
      {info && (
        <span className="hc-line">
          {safeText(info.authors.slice(0, 3).join(', '))}
          {info.authors.length > 3 ? ' …' : ''}
          {info.year !== null ? ` · ${info.year}` : ''}
        </span>
      )}
      {topic && <span className="hc-line hint">{t('network.card.topic', { topic: safeText(topic) })}</span>}
      {area && (
        <span className="hc-line hint" data-testid="card-areas">
          {t('network.area.areaCard', { areas: safeText(area) })}
        </span>
      )}
    </>
  );
}
