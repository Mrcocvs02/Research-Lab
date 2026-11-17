import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { clusterText, type PreparedMap } from './mapModel';
import { groupColor, placeLabels, toScreenX, toScreenY, toWorldX, toWorldY } from './geometry';
import { useDocTitle } from '../chat/useLabels';
import { safeText } from '../library/safeText';
import { useCanvasView } from './useCanvasView';

export interface MapHandle {
  /** Centres the view on a cluster (zooming in when the view is wide). */
  focusCluster(id: string): void;
  fit(): void;
}

interface Props {
  map: PreparedMap;
  level: number;
  selected: string | null;
  onSelect(docId: string | null): void;
  aiBadge: string;
  label: string;
  /** Changes when the view must be fitted again (another scope). */
  fitKey: string;
  handle?: Ref<MapHandle>;
}

const MAX_LABELS = 80;
const GREY = '#8b93a4';

function Tooltip({ docId, x, y }: { docId: string; x: number; y: number }) {
  const title = useDocTitle(docId);
  return (
    <div className="map-tooltip" role="tooltip" style={{ left: x + 12, top: y + 12 }} data-testid="map-tooltip">
      {safeText(title ?? docId.slice(0, 8))}
    </div>
  );
}

/**
 * The 2D map on a canvas: one batched path per colour, culled to the viewport; hit testing through a grid. Pan with the
 * pointer, zoom with the wheel or +/-, arrows move, 0 resets, Escape hides the tooltip. React renders only when the
 * hovered point changes, never per frame.
 */
export function MapCanvas({ map, level, selected, onSelect, aiBadge, label, fitKey, handle }: Props) {
  const [hover, setHover] = useState<{ docId: string; x: number; y: number } | null>(null);
  const hoverIdx = useRef(-1);
  const selIdx = selected !== null ? (map.indexOf.get(selected) ?? -1) : -1;
  const selRef = useRef(selIdx);
  selRef.current = selIdx;
  const drawn = useRef(0);
  const lastLabel = useRef<string>('');
  const theme = useRef<{ dark: boolean; text: string; ai: string; surface: string } | null>(null);

  const view = useCanvasView<number>({
    draw(ctx, w, h, v) {
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      if (theme.current?.dark !== dark) {
        const css = getComputedStyle(ctx.canvas);
        theme.current = { dark, text: css.color, ai: css.getPropertyValue('--ai').trim() || '#7a3fd0', surface: css.getPropertyValue('--surface').trim() || '#ffffff' };
      }
      const th = theme.current!;
      const { text: textColor, ai: aiColor, surface } = th;
      const g = map.groups[level];
      const clusters = map.levels[level] ?? [];
      const size = Math.min(5, Math.max(2, 1.2 + Math.sqrt(v.k / Math.max(map.n, 1)) * 40));
      const half = size / 2;
      let count = 0;
      // One path per colour: culled to the viewport, drawn with a single fill.
      const groups = g ? clusters.length + 1 : 1;
      for (let s = 0; s < groups; s++) {
        const from = g ? g.starts[s]! : 0;
        const to = g ? g.starts[s + 1]! : map.n;
        if (from === to) continue;
        ctx.fillStyle = g && s < clusters.length ? groupColor(s, dark) : GREY;
        ctx.beginPath();
        for (let j = from; j < to; j++) {
          const i = g ? g.order[j]! : j;
          const sx = (map.xs[i]! - v.cx) * v.k + w / 2;
          const sy = (map.ys[i]! - v.cy) * v.k + h / 2;
          if (sx < -size || sy < -size || sx > w + size || sy > h + size) continue;
          ctx.rect(sx - half, sy - half, size, size);
          count++;
        }
        ctx.fill();
      }
      drawn.current = count;
      if (ctx.canvas.dataset['drawn'] !== String(count)) ctx.canvas.dataset['drawn'] = String(count);
      // Selected and hovered points.
      for (const [idx, width] of [[selRef.current, 2.5], [hoverIdx.current, 1.5]] as const) {
        if (idx < 0) continue;
        ctx.strokeStyle = textColor;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(toScreenX(v, map.xs[idx]!, w), toScreenY(v, map.ys[idx]!, h), size + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Cluster labels at the centroids, larger clusters first, none over another.
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
      const texts: Array<{ text: string; ai: boolean }> = [];
      const order: number[] = [];
      clusters.forEach((c, i) => {
        const cx = toScreenX(v, c.centroid.x, w);
        const cy = toScreenY(v, c.centroid.y, h);
        const t = clusterText(c);
        texts.push(t);
        const tw = t.text === '' ? 0 : ctx.measureText(t.text).width + (t.ai ? ctx.measureText(aiBadge).width + 16 : 0) + 10;
        boxes.push({ x: cx - tw / 2, y: cy - 10, w: tw, h: 20 });
        if (tw > 0 && cx > 0 && cy > 0 && cx < w && cy < h) order.push(i);
      });
      const shown = placeLabels(boxes, order).slice(0, MAX_LABELS);
      for (const i of shown) {
        const b = boxes[i]!;
        const t = texts[i]!;
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = surface;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;
        if (t.ai) {
          ctx.strokeStyle = aiColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
          ctx.fillStyle = aiColor;
          ctx.textAlign = 'left';
          ctx.fillText(aiBadge, b.x + 5, b.y + 10);
          ctx.fillStyle = textColor;
          ctx.fillText(t.text, b.x + 5 + ctx.measureText(aiBadge).width + 6, b.y + 10);
        } else {
          ctx.fillStyle = textColor;
          ctx.textAlign = 'center';
          ctx.fillText(t.text, b.x + b.w / 2, b.y + 10);
        }
      }
      ctx.textAlign = 'left';
      const sig = `${shown.length}`;
      if (lastLabel.current !== sig) {
        lastLabel.current = sig;
        ctx.canvas.dataset['labels'] = sig;
      }
    },
    hit(sx, sy, v, w, h) {
      // A point is hit within a few pixels of the pointer.
      return map.grid.nearest(toWorldX(v, sx, w), toWorldY(v, sy, h), 7 / v.k);
    },
    onHover(idx, sx, sy) {
      const i = idx ?? -1;
      if (i === hoverIdx.current) return;
      hoverIdx.current = i;
      setHover(i < 0 ? null : { docId: map.ids[i]!, x: sx, y: sy });
      view.requestDraw();
    },
    onClick(idx) {
      onSelect(idx !== null && idx >= 0 ? map.ids[idx]! : null);
    },
    bounds: () => (map.n > 0 ? map.bounds : null),
  });

  useImperativeHandle(
    handle,
    () => ({
      fit: () => view.fit(),
      focusCluster(id) {
        const c = map.clusterById.get(id);
        if (!c) return;
        const v = view.view.current;
        view.centerOn(c.centroid.x, c.centroid.y, Math.max(v.k, v.k * 1.5));
      },
    }),
    [map, view],
  );

  // Another scope shows other points: fit again. A reload of the same scope (a new document placed) keeps the view.
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) firstFit.current = false;
    else view.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useEffect(() => {
    hoverIdx.current = -1;
    setHover(null);
    view.requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, level, selIdx]);

  return (
    <div className="map-wrap">
      <canvas
        ref={view.canvas}
        className="map-canvas"
        tabIndex={0}
        role="img"
        aria-label={label}
        data-testid="map-canvas"
        data-points={map.n}
        data-level={level}
        {...view.handlers}
      />
      {hover && <Tooltip docId={hover.docId} x={hover.x} y={hover.y} />}
    </div>
  );
}
