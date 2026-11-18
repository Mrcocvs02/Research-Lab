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
 * the pointer. The caller shows it after the pointer rested 150 ms (see `useRestingHover`).
 */
export function HoverCard({ x, y, width, height, testId, children }: { x: number; y: number; width: number; height: number; testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 280, h: 90 });
  useEffect(() => {
    const el = ref.current;
    if (el) setSize({ w: el.offsetWidth || 280, h: el.offsetHeight || 90 });
  }, [children]);
  const left = Math.max(4, Math.min(x + 14, width - size.w - 4));
  const top = Math.max(4, Math.min(y + 14, height - size.h - 4));
  return (
    <div ref={ref} className="hovercard" role="tooltip" style={{ left, top }} data-testid={testId}>
      {children}
    </div>
  );
}

/** Hover that settles: `set(h)` shows `h` after 150 ms of rest, and `set(null)` hides at once. */
export function useRestingHover<T>(ms = 150): [T | null, (h: T | null) => void] {
  const [shown, setShown] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = (h: T | null) => {
    clearTimeout(timer.current);
    if (h === null) setShown(null);
    else timer.current = setTimeout(() => setShown(h), ms);
  };
  return [shown, set];
}

/** The card of a document: title (two lines), authors and year, the topic. */
export function DocCard({ docId, topic }: { docId: string; topic?: string | undefined }) {
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
    </>
  );
}
