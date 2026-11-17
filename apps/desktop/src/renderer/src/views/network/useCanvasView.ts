import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { fitView, toWorldX, toWorldY, zoomAt, type Bounds, type View } from './geometry';

/**
 * What a canvas view (the map, the network) provides; the hook owns the pointer, wheel and keyboard handling, the pan and
 * zoom, the size (with the pixel ratio) and the frame loop. Frames are requested only when something changed (a pointer
 * move that matters, a zoom, the simulation still moving): nothing runs while the view is idle.
 */
export interface CanvasOptions<T> {
  /** Draws one frame; the context is already scaled to CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, view: View): void;
  /** What is under the screen point (CSS pixels), or null. */
  hit(sx: number, sy: number, view: View, width: number, height: number): T | null;
  onHover(hit: T | null, sx: number, sy: number): void;
  onClick(hit: T | null): void;
  onDoubleClick?(hit: T | null): void;
  /** The area to show when the view is reset (null: nothing yet). */
  bounds(): Bounds | null;
  /** One simulation step per frame; return true while more steps are needed. */
  tick?(): boolean;
  /** Dragging a hit (a node) instead of the background: return true to take the drag. */
  dragStart?(hit: T, wx: number, wy: number): boolean;
  dragMove?(hit: T, wx: number, wy: number): void;
  dragEnd?(hit: T): void;
}

const DRAG_PX = 4;

export function useCanvasView<T>(opts: CanvasOptions<T>) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const o = useRef(opts);
  o.current = opts;
  const view = useRef<View>({ cx: 0, cy: 0, k: 1 });
  const base = useRef(1);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);
  const fitted = useRef(false);

  const frame = useCallback(() => {
    raf.current = 0;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const { w, h, dpr } = size.current;
    if (w === 0 || h === 0) return;
    const more = o.current.tick?.() ?? false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    o.current.draw(ctx, w, h, view.current);
    if (more) requestDraw();
  }, []);
  const requestDraw = useCallback((): void => {
    if (raf.current === 0) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  /** Shows the whole content (the first time there is some, or when asked). */
  const fit = useCallback(() => {
    const b = o.current.bounds();
    const { w, h } = size.current;
    if (!b || w === 0) return;
    const v = fitView(b, w, h);
    base.current = v.k;
    view.current = v;
    fitted.current = true;
    requestDraw();
  }, [requestDraw]);

  const centerOn = useCallback(
    (x: number, y: number, k?: number) => {
      view.current = { cx: x, cy: y, k: k ?? view.current.k };
      requestDraw();
    },
    [requestDraw],
  );

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w === size.current.w && h === size.current.h && dpr === size.current.dpr) return;
      size.current = { w, h, dpr };
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
      if (!fitted.current) fit();
      else requestDraw();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The wheel needs a non-passive listener to stop the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const { w, h } = size.current;
      view.current = zoomAt(view.current, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015), w, h, base.current);
      requestDraw();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onTheme = () => requestDraw();
    dark?.addEventListener?.('change', onTheme);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      dark?.removeEventListener?.('change', onTheme);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [fit, requestDraw]);

  // Pointer state of the current gesture.
  const gesture = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean; hit: T | null; dragging: boolean } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      if (e.button !== 0) return;
      const { sx, sy } = local(e);
      const { w, h } = size.current;
      const hit = o.current.hit(sx, sy, view.current, w, h);
      gesture.current = { id: e.pointerId, sx, sy, vx: view.current.cx, vy: view.current.cy, moved: false, hit, dragging: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      const { sx, sy } = local(e);
      const { w, h } = size.current;
      const g = gesture.current;
      if (g && g.id === e.pointerId) {
        if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) > DRAG_PX) {
          g.moved = true;
          if (g.hit !== null && o.current.dragStart?.(g.hit, toWorldX(view.current, sx, w), toWorldY(view.current, sy, h))) g.dragging = true;
          o.current.onHover(null, sx, sy);
        }
        if (g.moved) {
          if (g.dragging && g.hit !== null) o.current.dragMove?.(g.hit, toWorldX(view.current, sx, w), toWorldY(view.current, sy, h));
          else view.current = { ...view.current, cx: g.vx - (sx - g.sx) / view.current.k, cy: g.vy - (sy - g.sy) / view.current.k };
          requestDraw();
        }
        return;
      }
      o.current.onHover(o.current.hit(sx, sy, view.current, w, h), sx, sy);
    },
    onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      gesture.current = null;
      if (g.dragging && g.hit !== null) o.current.dragEnd?.(g.hit);
      else if (!g.moved) o.current.onClick(g.hit);
      requestDraw();
    },
    onPointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
      const g = gesture.current;
      if (g && g.id === e.pointerId && g.dragging && g.hit !== null) o.current.dragEnd?.(g.hit);
      gesture.current = null;
    },
    onPointerLeave() {
      if (!gesture.current) o.current.onHover(null, 0, 0);
    },
    onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
      const { sx, sy } = local(e);
      const { w, h } = size.current;
      o.current.onDoubleClick?.(o.current.hit(sx, sy, view.current, w, h));
    },
    onKeyDown(e: ReactKeyboardEvent<HTMLCanvasElement>) {
      const { w, h } = size.current;
      const v = view.current;
      const step = 0.15 * Math.min(w, h);
      let next: View | null = null;
      switch (e.key) {
        case 'ArrowLeft':
          next = { ...v, cx: v.cx - step / v.k };
          break;
        case 'ArrowRight':
          next = { ...v, cx: v.cx + step / v.k };
          break;
        case 'ArrowUp':
          next = { ...v, cy: v.cy - step / v.k };
          break;
        case 'ArrowDown':
          next = { ...v, cy: v.cy + step / v.k };
          break;
        case '+':
        case '=':
          next = zoomAt(v, w / 2, h / 2, 1.25, w, h, base.current);
          break;
        case '-':
        case '_':
          next = zoomAt(v, w / 2, h / 2, 0.8, w, h, base.current);
          break;
        case '0':
        case 'Home':
          fit();
          e.preventDefault();
          return;
        case 'Escape':
          o.current.onHover(null, 0, 0);
          return;
        default:
          return;
      }
      e.preventDefault();
      view.current = next;
      requestDraw();
    },
  };

  return { canvas, view, size, requestDraw, fit, centerOn, handlers };
}
