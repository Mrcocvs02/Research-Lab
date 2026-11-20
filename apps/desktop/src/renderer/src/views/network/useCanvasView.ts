import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { active, makeFlight, newMotion, reducedMotion, stepMotion, zoomBy, FLIGHT_MS, type Motion } from './camera';
import { fitView, toWorldX, toWorldY, zoomAt, type Bounds, type View } from './geometry';

/**
 * What a canvas view (the map, the networks) provides; the hook owns the pointer, wheel and keyboard handling, the camera
 * (smooth zoom, drag inertia, flights, see camera.ts), the size (with the pixel ratio) and the frame loop. Frames are
 * requested only when something changed (a pointer move that matters, a camera motion, the simulation still hot): nothing
 * runs while the view is idle, and `data-frames` on the canvas counts the frames drawn so a test can check it.
 */
export interface CanvasOptions<T> {
  /** Draws one frame; the context is already scaled to CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, view: View): void;
  /** What is under the screen point (CSS pixels), or null. */
  hit(sx: number, sy: number, view: View, width: number, height: number): T | null;
  onHover(hit: T | null, sx: number, sy: number): void;
  /** A click: `mod` is the platform modifier (Ctrl, or Command on macOS), which a canvas with a selection reads as "add or remove". */
  onClick(hit: T | null, shift: boolean, mod?: boolean): void;
  /** Return true when the double click was handled (else a double click on the background zooms in by 2). */
  onDoubleClick?(hit: T | null): boolean | void;
  /** The area to show when the view is reset (null: nothing yet). */
  bounds(): Bounds | null;
  /** Largest zoom `fit` may reach (small graphs are not blown up past a node of 40 px). */
  maxFit?(): number;
  /** One simulation step per frame; return true while more steps are needed. */
  tick?(): boolean;
  /** Dragging a hit (a node) instead of the background: return true to take the drag. */
  dragStart?(hit: T, wx: number, wy: number): boolean;
  dragMove?(hit: T, wx: number, wy: number): void;
  /** `end` tells how the drag ended: with Shift held at the release, or cancelled (Esc, `cancelGesture`). */
  dragEnd?(hit: T, end?: { shift: boolean; cancelled: boolean }): void;
  /** With a hit being dragged, the view scrolls by itself while the pointer is within 24 px of an edge (8 px a frame, never with reduced motion). */
  edgeScroll?: boolean;
  /** A rectangle dragged from anywhere with the platform modifier held: its corners in screen pixels (`add`: Shift was held too). */
  rect?: { move(r: ScreenRect): void; end(r: ScreenRect, add: boolean): void; cancel(): void };
}

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The platform modifier of selection gestures: Command on macOS (Ctrl+click is the context menu there), Ctrl elsewhere. */
export function isMod(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? e.metaKey : e.ctrlKey;
}

const EDGE_PX = 24;
const EDGE_STEP = 8;

const DRAG_PX = 4;

interface Gesture<T> {
  id: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  moved: boolean;
  hit: T | null;
  dragging: boolean;
  /** A rectangle with the modifier held, and whether Esc cancelled the gesture (nothing more happens until the release). */
  rect: boolean;
  cancelled: boolean;
  lx: number;
  ly: number;
  lt: number;
  pvx: number;
  pvy: number;
  /** Last pointer position (the edge scroll moves the world under it). */
  px: number;
  py: number;
}

export function useCanvasView<T>(opts: CanvasOptions<T>) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const o = useRef(opts);
  o.current = opts;
  const view = useRef<View>({ cx: 0, cy: 0, k: 1 });
  const base = useRef(1);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);
  const fitted = useRef(false);
  const motion = useRef<Motion>(newMotion());
  const last = useRef(0);
  const frames = useRef(0);
  /** Called after each frame (the minimap draws itself from here). */
  const hooks = useRef(new Set<() => void>());
  const gesture = useRef<Gesture<T> | null>(null);
  /** Direction of the edge scroll of a drag in progress (px per frame), or null. */
  const edge = useRef<{ dx: number; dy: number } | null>(null);

  const frame = useCallback((now: number) => {
    raf.current = 0;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const { w, h, dpr } = size.current;
    if (w === 0 || h === 0) return;
    const dt = last.current === 0 ? 16.7 : Math.min(now - last.current, 50);
    last.current = now;
    const m = motion.current;
    if (active(m)) view.current = stepMotion(m, view.current, dt, w, h);
    let more = o.current.tick?.() ?? false;
    const es = edge.current;
    const g = gesture.current;
    if (es && g && g.dragging && g.hit !== null) {
      view.current = { ...view.current, cx: view.current.cx + es.dx / view.current.k, cy: view.current.cy + es.dy / view.current.k };
      o.current.dragMove?.(g.hit, toWorldX(view.current, g.px, w), toWorldY(view.current, g.py, h));
      more = true;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    o.current.draw(ctx, w, h, view.current);
    frames.current++;
    el.dataset['frames'] = String(frames.current);
    for (const hook of hooks.current) hook();
    if (more || active(m)) requestDraw();
    else last.current = 0;
  }, []);
  const requestDraw = useCallback((): void => {
    if (raf.current === 0) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  /** Stops every camera motion (a drag, a new command). */
  const stop = useCallback(() => {
    const m = motion.current;
    m.vx = 0;
    m.vy = 0;
    m.zoom = null;
    m.flight = null;
  }, []);

  /** Flies to a view (centre and zoom): 700 ms, zooming out and in for a long way; at once with reduced motion. */
  const flyTo = useCallback(
    (x: number, y: number, k?: number, ms = FLIGHT_MS) => {
      const to = { cx: x, cy: y, k: k ?? view.current.k };
      stop();
      if (reducedMotion()) view.current = to;
      else motion.current.flight = makeFlight(view.current, to, ms, size.current.w, size.current.h);
      requestDraw();
    },
    [requestDraw, stop],
  );

  /** Shows the whole content (the first time there is some, or when asked: then in 600 ms). */
  const fit = useCallback(
    (animate = false) => {
      const b = o.current.bounds();
      const { w, h } = size.current;
      if (!b || w === 0) return;
      const v = fitView(b, w, h);
      const cap = o.current.maxFit?.();
      if (cap !== undefined && v.k > cap) v.k = cap;
      base.current = v.k;
      if (animate && fitted.current && !reducedMotion()) {
        stop();
        motion.current.flight = makeFlight(view.current, v, 600, w, h);
      } else view.current = v;
      fitted.current = true;
      requestDraw();
    },
    [requestDraw, stop],
  );

  const centerOn = useCallback(
    (x: number, y: number, k?: number) => {
      stop();
      view.current = { cx: x, cy: y, k: k ?? view.current.k };
      requestDraw();
    },
    [requestDraw, stop],
  );

  /** Sets the view at once (the minimap drags the rectangle). */
  const jump = useCallback(
    (v: View) => {
      stop();
      view.current = v;
      requestDraw();
    },
    [requestDraw, stop],
  );

  const zoom = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      const { w, h } = size.current;
      const x = sx ?? w / 2;
      const y = sy ?? h / 2;
      motion.current.flight = null;
      if (reducedMotion()) view.current = zoomAt(view.current, x, y, factor, w, h, base.current);
      else zoomBy(motion.current, view.current, x, y, factor, base.current);
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
      zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onTheme = () => requestDraw();
    dark?.addEventListener?.('change', onTheme);
    window.addEventListener('rl:theme', onTheme);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      dark?.removeEventListener?.('change', onTheme);
      window.removeEventListener('rl:theme', onTheme);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [fit, requestDraw, zoom]);

  /** Ends a drag or a rectangle in progress without committing it (Esc); true when there was one. */
  const cancelGesture = useCallback((): boolean => {
    const g = gesture.current;
    if (!g || !g.moved || !(g.dragging || g.rect)) return false;
    if (g.dragging && g.hit !== null) o.current.dragEnd?.(g.hit, { shift: false, cancelled: true });
    if (g.rect) o.current.rect?.cancel();
    g.dragging = false;
    g.rect = false;
    g.cancelled = true;
    edge.current = null;
    requestDraw();
    return true;
  }, [requestDraw]);

  // What the last press hit: the first click of a double click may select a paper, the detail opens beside the canvas and the view moves,
  // so the second click is resolved against the first (same spot, a short time), not against the moved view.
  const lastPress = useRef<{ sx: number; sy: number; at: number; hit: T | null } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      if (e.button !== 0) return;
      const { sx, sy } = local(e);
      const { w, h } = size.current;
      stop();
      const hit = o.current.hit(sx, sy, view.current, w, h);
      const prev = lastPress.current;
      const now = performance.now();
      if (!(prev !== null && prev.hit !== null && now - prev.at < 800 && Math.hypot(sx - prev.sx, sy - prev.sy) <= DRAG_PX)) lastPress.current = { sx, sy, at: now, hit };
      gesture.current = { id: e.pointerId, sx, sy, vx: view.current.cx, vy: view.current.cy, moved: false, hit, dragging: false, rect: !!o.current.rect && isMod(e), cancelled: false, lx: sx, ly: sy, lt: performance.now(), pvx: 0, pvy: 0, px: sx, py: sy };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      const { sx, sy } = local(e);
      const { w, h } = size.current;
      const g = gesture.current;
      if (g && g.id === e.pointerId) {
        if (g.cancelled) return;
        g.px = sx;
        g.py = sy;
        if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) > DRAG_PX) {
          g.moved = true;
          if (!g.rect && g.hit !== null && o.current.dragStart?.(g.hit, toWorldX(view.current, sx, w), toWorldY(view.current, sy, h))) g.dragging = true;
          o.current.onHover(null, sx, sy);
        }
        if (g.moved) {
          if (g.rect) o.current.rect?.move({ x0: g.sx, y0: g.sy, x1: sx, y1: sy });
          else if (g.dragging && g.hit !== null) {
            o.current.dragMove?.(g.hit, toWorldX(view.current, sx, w), toWorldY(view.current, sy, h));
            const dx = sx < EDGE_PX ? -EDGE_STEP : sx > w - EDGE_PX ? EDGE_STEP : 0;
            const dy = sy < EDGE_PX ? -EDGE_STEP : sy > h - EDGE_PX ? EDGE_STEP : 0;
            edge.current = o.current.edgeScroll && !reducedMotion() && (dx !== 0 || dy !== 0) ? { dx, dy } : null;
          } else {
            view.current = { ...view.current, cx: g.vx - (sx - g.sx) / view.current.k, cy: g.vy - (sy - g.sy) / view.current.k };
            // Velocity in px per 60 Hz frame, smoothed, for the inertia at release.
            const now = performance.now();
            const dt = Math.max(now - g.lt, 1);
            g.pvx = g.pvx * 0.5 + ((sx - g.lx) / dt) * (1000 / 60) * 0.5;
            g.pvy = g.pvy * 0.5 + ((sy - g.ly) / dt) * (1000 / 60) * 0.5;
            g.lx = sx;
            g.ly = sy;
            g.lt = now;
          }
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
      edge.current = null;
      if (g.cancelled) return;
      if (g.rect && g.moved) {
        const { sx, sy } = local(e);
        o.current.rect?.end({ x0: g.sx, y0: g.sy, x1: sx, y1: sy }, e.shiftKey);
      } else if (g.dragging && g.hit !== null) o.current.dragEnd?.(g.hit, { shift: e.shiftKey, cancelled: false });
      else if (!g.moved) o.current.onClick(g.hit, e.shiftKey, isMod(e));
      else if (!reducedMotion() && performance.now() - g.lt < 80 && Math.hypot(g.pvx, g.pvy) > 1) {
        motion.current.vx = g.pvx;
        motion.current.vy = g.pvy;
      }
      requestDraw();
    },
    onPointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
      const g = gesture.current;
      if (g && g.id === e.pointerId && !g.cancelled) {
        if (g.dragging && g.hit !== null) o.current.dragEnd?.(g.hit, { shift: false, cancelled: true });
        if (g.rect && g.moved) o.current.rect?.cancel();
      }
      gesture.current = null;
      edge.current = null;
    },
    onPointerLeave() {
      if (!gesture.current) o.current.onHover(null, 0, 0);
    },
    onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
      const { sx, sy } = local(e);
      const { w, h } = size.current;
      const lp = lastPress.current;
      const same = lp !== null && lp.hit !== null && performance.now() - lp.at < 800 && Math.hypot(sx - lp.sx, sy - lp.sy) <= DRAG_PX;
      const hit = same ? lp.hit : o.current.hit(sx, sy, view.current, w, h);
      if (o.current.onDoubleClick?.(hit) === true) return;
      if (hit === null) zoom(2, sx, sy);
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
          e.preventDefault();
          zoom(1.25);
          return;
        case '-':
        case '_':
          e.preventDefault();
          zoom(0.8);
          return;
        case '0':
        case 'Home':
          fit(true);
          e.preventDefault();
          return;
        case 'Escape':
          o.current.onHover(null, 0, 0);
          return;
        default:
          return;
      }
      e.preventDefault();
      stop();
      view.current = next;
      requestDraw();
    },
  };

  return { canvas, view, size, requestDraw, fit, centerOn, flyTo, jump, zoom, stop, hooks, handlers, cancelGesture };
}
