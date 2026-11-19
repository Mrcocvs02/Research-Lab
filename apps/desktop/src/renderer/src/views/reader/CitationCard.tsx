import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RefEntry } from '@rl/core';
import { useNotify } from '../../lib/notify';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { Floating, type Anchor } from './AnnotationPopover';
import { entryFor, mentionAt, mentionsIn, type Mention } from './citations';
import './citations.css';

/**
 * Citation cards (feature 29, D-415, §17.4.12). Nothing is drawn at rest: a reference in the text (`[12]`, "Author, 2018") is
 * underlined, with the CSS Custom Highlight API (no node in the page), only while the pointer is on it, and its card opens
 * on a click in Select (or with Ctrl held while the pointer rests on it), never while a drawing tool is active. `Alt+C` opens
 * the one nearest to the focus and Tab walks the references of the page. The list comes from `refs:get` (this machine only).
 */
const HIGHLIGHT = 'rl-ref';
const cache = new Map<string, Promise<{ found: boolean; items: RefEntry[] }>>();
const refsOf = (docId: string) => {
  let p = cache.get(docId);
  if (!p) {
    p = rl.invoke('refs:get', { docId });
    cache.set(docId, p);
    p.catch(() => cache.delete(docId));
  }
  return p;
};

interface Spot {
  mention: Mention;
  anchor: Anchor;
}

type CaretDoc = Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null; caretRangeFromPoint?(x: number, y: number): Range | null };

/** The text of the text-layer span under a point, with the neighbours (a reference can be cut across two spans) and the caret offset in it. */
function textAt(x: number, y: number): { node: Text; text: string; offset: number; shift: number } | null {
  const doc = document as CaretDoc;
  const pos = doc.caretPositionFromPoint?.(x, y) ?? ((r) => (r ? { offsetNode: r.startContainer, offset: r.startOffset } : null))(doc.caretRangeFromPoint?.(x, y) ?? null);
  const node = pos?.offsetNode;
  if (!(node instanceof Text) || !node.parentElement?.closest('.textLayer')) return null;
  const span = node.parentElement;
  const before = span.previousElementSibling?.textContent ?? '';
  const after = span.nextElementSibling?.textContent ?? '';
  const own = node.data;
  return { node, text: before.slice(-24) + own + after.slice(0, 24), offset: Math.min(pos!.offset, own.length) + Math.min(before.length, 24), shift: Math.min(before.length, 24) };
}

/** The rectangle of characters `start..end` of the text of a span (rectangle of the span itself when the range cannot be measured). */
function rectOf(node: Text, start: number, end: number): Anchor | null {
  try {
    const r = document.createRange();
    r.setStart(node, Math.max(0, Math.min(start, node.length)));
    r.setEnd(node, Math.max(0, Math.min(end, node.length)));
    const b = r.getBoundingClientRect();
    return b.width > 0 || b.height > 0 ? { left: b.left, top: b.top, bottom: b.bottom } : null;
  } catch {
    return null;
  }
}

/** Every mention drawn in the text layers that are on screen, in reading order. */
function visibleMentions(container: HTMLElement): Array<Spot & { node: Text; start: number; end: number }> {
  const box = container.getBoundingClientRect();
  const out: Array<Spot & { node: Text; start: number; end: number }> = [];
  for (const span of container.querySelectorAll<HTMLElement>('.textLayer span')) {
    const node = span.firstChild;
    if (!(node instanceof Text)) continue;
    const r = span.getBoundingClientRect();
    if (r.bottom < box.top || r.top > box.bottom) continue;
    for (const mention of mentionsIn(node.data)) {
      const anchor = rectOf(node, mention.start, mention.end);
      if (anchor) out.push({ mention, anchor, node, start: mention.start, end: mention.end });
    }
  }
  return out;
}

export function CitationLayer({ docId, container, enabled, isMark, request }: { docId: string; container: HTMLElement | null; enabled: boolean; isMark(x: number, y: number): boolean; request: number }) {
  const { t } = useTranslation();
  const [card, setCard] = useState<{ spot: Spot; list: Spot[]; at: number } | null>(null);
  const [data, setData] = useState<{ found: boolean; items: RefEntry[] } | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef<{ x: number; y: number; ctrl: boolean }>({ x: 0, y: 0, ctrl: false });
  const frame = useRef(0);

  const open = useCallback(
    async (spot: Spot, list: Spot[] = [], at = 0) => {
      const r = await refsOf(docId).catch(() => null);
      setData(r);
      // No bibliography, or the mention names no entry of it: the click does nothing special.
      if (r && r.found && entryFor(spot.mention, r.items)) setCard({ spot, list, at });
    },
    [docId],
  );

  const clearHover = useCallback(() => {
    clearTimeout(hover.current);
    (CSS as { highlights?: Map<string, unknown> }).highlights?.delete(HIGHLIGHT);
    container?.removeAttribute('data-ref-hover');
  }, [container]);

  // Pointer: the underline and the hand under it; Ctrl + rest opens the card; a click in Select opens it too.
  useEffect(() => {
    if (!container) return;
    if (!enabled) {
      clearHover();
      setCard(null);
      return;
    }
    const probe = (x: number, y: number) => {
      const at = textAt(x, y);
      const m = at ? mentionAt(at.text, at.offset) : null;
      if (!at || !m) return null;
      const start = m.start - at.shift;
      const end = m.end - at.shift;
      return { at, m, start, end, anchor: rectOf(at.node, start, end) };
    };
    const onMove = (e: PointerEvent) => {
      last.current = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey || e.metaKey };
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const { x, y, ctrl } = last.current;
        const hit = (e.target as Element | null)?.closest?.('.textLayer') && !isMark(x, y) ? probe(x, y) : null;
        const hl = (CSS as { highlights?: Map<string, unknown> }).highlights;
        clearTimeout(hover.current);
        if (!hit || !hit.anchor) {
          hl?.delete(HIGHLIGHT);
          container.removeAttribute('data-ref-hover');
          return;
        }
        container.setAttribute('data-ref-hover', '');
        if (hl && typeof Highlight === 'function') {
          const r = document.createRange();
          r.setStart(hit.at.node, Math.max(0, Math.min(hit.start, hit.at.node.length)));
          r.setEnd(hit.at.node, Math.max(0, Math.min(hit.end, hit.at.node.length)));
          hl.set(HIGHLIGHT, new Highlight(r));
        }
        if (ctrl) hover.current = setTimeout(() => void open({ mention: hit.m, anchor: hit.anchor! }), 250);
      });
    };
    const onClick = (e: MouseEvent) => {
      const sel = window.getSelection();
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || (sel && !sel.isCollapsed) || (e.target as Element).closest('a') || isMark(e.clientX, e.clientY)) return;
      const hit = probe(e.clientX, e.clientY);
      if (hit?.anchor) void open({ mention: hit.m, anchor: hit.anchor });
    };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', clearHover);
    container.addEventListener('click', onClick);
    return () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', clearHover);
      container.removeEventListener('click', onClick);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      clearHover();
    };
  }, [container, enabled, clearHover, isMark, open]);

  // Alt+C: the reference nearest to the text selection or, without one, to the middle of the window.
  const seen = useRef(0);
  useEffect(() => {
    if (request === seen.current || !container || !enabled) return;
    seen.current = request;
    const list = visibleMentions(container).filter((s) => entryFor(s.mention, data?.items ?? []) !== null || data === null);
    if (list.length === 0) return;
    const sel = window.getSelection();
    const focus = sel && sel.rangeCount > 0 && container.contains(sel.anchorNode) ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const box = container.getBoundingClientRect();
    const cy = focus ? focus.top : box.top + box.height / 2;
    let best = 0;
    list.forEach((s, i) => Math.abs(s.anchor.top - cy) < Math.abs(list[best]!.anchor.top - cy) && (best = i));
    void open(list[best]!, list, best);
  }, [request, container, enabled, data, open]);

  if (!card) return null;
  const entry = entryFor(card.spot.mention, data?.items ?? []);
  if (!entry) return null;
  const step = (d: 1 | -1) => {
    if (card.list.length < 2) return;
    const at = (card.at + d + card.list.length) % card.list.length;
    void open(card.list[at]!, card.list, at);
  };
  return <Card key={`${entry.n}-${card.spot.anchor.top}`} entry={entry} anchor={card.spot.anchor} onClose={() => setCard(null)} onStep={step} label={t('reader.cite.label')} />;
}

function Card({ entry, anchor, onClose, onStep, label }: { entry: RefEntry; anchor: Anchor; onClose(): void; onStep(d: 1 | -1): void; label: string }) {
  const { t } = useTranslation();
  const { info, reportError } = useNotify();
  const { openReader } = useReader();
  const box = useRef<HTMLDivElement>(null);
  const w = entry.work;
  const kind = w?.doi ? ('doi' as const) : w?.arxivId ? ('arxiv' as const) : null;
  const id = w?.doi ?? w?.arxivId ?? null;

  useEffect(() => {
    box.current?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const add = (download: boolean) =>
    kind && id
      ? void rl.invoke('importId:add', { entries: [{ kind, id }], downloadPdf: download }).then((r) => info(r.added > 0 ? t('reader.cite.added') : t('reader.cite.skipped')), reportError)
      : undefined;
  const authors = w?.authors.length ? w.authors.join(', ') : null;
  const meta = [authors, w?.year ?? entry.year, w?.venue].filter(Boolean).join(' · ');

  return (
    <Floating anchor={() => anchor} label={label} testId="citation-card" mode="cite" className="cite-card">
      <div
        ref={box}
        tabIndex={-1}
        className="cite-card__body"
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose());
          else if (e.key === 'Tab' && !(e.target instanceof HTMLButtonElement)) (e.preventDefault(), onStep(e.shiftKey ? -1 : 1));
        }}
      >
        {meta && <p className="cite-card__meta">{safeText(meta)}</p>}
        <p className="cite-card__title" data-testid="citation-title">
          {safeText(w?.title ?? entry.text)}
        </p>
        <div className="cite-card__row">
          {entry.docId ? (
            <>
              <span data-testid="citation-in-library">✓ {t('reader.cite.inLibrary')}</span>
              <button type="button" onClick={() => (onClose(), openReader(entry.docId!))} data-testid="citation-open">
                {t('reader.cite.open')}
              </button>
            </>
          ) : kind ? (
            <>
              <button type="button" onClick={() => add(false)} data-testid="citation-later">
                {t('reader.cite.later')}
              </button>
              {kind === 'arxiv' && (
                <button type="button" onClick={() => add(true)} data-testid="citation-import">
                  {t('reader.cite.import')}
                </button>
              )}
            </>
          ) : (
            <span className="hint">{t('reader.cite.textOnly')}</span>
          )}
        </div>
      </div>
    </Floating>
  );
}
