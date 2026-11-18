import { useCallback, useEffect, useRef } from 'react';
import { isDarkTheme } from '../../lib/theme';
import type { Bounds, View } from './geometry';

export const MINI_W = 160;
export const MINI_H = 120;

/** World to minimap pixels for `bounds` (uniform scale, centred, 8 px margin). */
export function miniTransform(b: Bounds, w = MINI_W, h = MINI_H, pad = 8): { k: number; ox: number; oy: number } {
  const bw = Math.max(b.maxX - b.minX, 1e-9);
  const bh = Math.max(b.maxY - b.minY, 1e-9);
  const k = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  return { k, ox: w / 2 - ((b.minX + b.maxX) / 2) * k, oy: h / 2 - ((b.minY + b.maxY) / 2) * k };
}

interface Props {
  bounds: Bounds | null;
  view: { current: View };
  size: { current: { w: number; h: number } };
  /** Registers a function called after every frame of the main canvas. */
  hooks: { current: Set<() => void> };
  /** Paints the content (blobs of topics, dots of nodes) with the world-to-minimap mapping. */
  paint(ctx: CanvasRenderingContext2D, to: (x: number, y: number) => [number, number], dark: boolean): void;
  /** Moves the main view to a world point (the rectangle was dragged). */
  onMove(cx: number, cy: number): void;
  label: string;
  /** Changes when the content changes: the minimap draws again. */
  version: unknown;
}

/** 160x120 minimap in a corner: the topics as patches of colour and the view as a rectangle that can be dragged (§4.20). */
export function MiniMap({ bounds, view, size, hooks, paint, onMove, label, version }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);
  const draw = useCallback(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !bounds) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== MINI_W * dpr) {
      el.width = MINI_W * dpr;
      el.height = MINI_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINI_W, MINI_H);
    const { k, ox, oy } = miniTransform(bounds);
    paint(ctx, (x, y) => [x * k + ox, y * k + oy], isDarkTheme());
    const v = view.current;
    const { w, h } = size.current;
    const rw = (w / v.k) * k;
    const rh = (h / v.k) * k;
    const rx = v.cx * k + ox - rw / 2;
    const ry = v.cy * k + oy - rh / 2;
    ctx.strokeStyle = getComputedStyle(el).getPropertyValue('--accent').trim() || '#0f6e78';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.max(0.5, rx), Math.max(0.5, ry), Math.min(rw, MINI_W - 1), Math.min(rh, MINI_H - 1));
  }, [bounds, paint, size, view]);

  useEffect(() => {
    draw();
    const h = hooks.current;
    h.add(draw);
    return () => void h.delete(draw);
  }, [draw, hooks, version]);

  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bounds) return;
    const r = e.currentTarget.getBoundingClientRect();
    const { k, ox, oy } = miniTransform(bounds);
    onMove((e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k);
  };
  return (
    <canvas
      ref={ref}
      className="minimap"
      width={MINI_W}
      height={MINI_H}
      aria-label={label}
      data-testid="minimap"
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => drag.current && moveTo(e)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
    />
  );
}
