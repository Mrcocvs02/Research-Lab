import { useCallback, useState } from 'react';

/** Step of one arrow key on a resize handle, in px. */
export const RESIZE_STEP = 16;

export interface ResizeLimits {
  def: number;
  min: number;
  max: number;
}

export function clampWidth(w: number, { min, max }: ResizeLimits): number {
  return Number.isFinite(w) ? Math.min(max, Math.max(min, Math.round(w))) : min;
}

/** New width for a key press on the handle; `grow` is +1 when the key moves the panel edge outwards. Null when the key is not ours. */
export function keyWidth(width: number, key: string, edge: 'start' | 'end', lim: ResizeLimits): number | null {
  if (key === 'Home') return lim.min;
  if (key === 'End') return lim.max;
  // The handle on the panel's end edge (left sidebar) grows to the right; on its start edge (right panels) it grows to the left.
  const grows = edge === 'end' ? 'ArrowRight' : 'ArrowLeft';
  const shrinks = edge === 'end' ? 'ArrowLeft' : 'ArrowRight';
  if (key === grows) return clampWidth(width + RESIZE_STEP, lim);
  if (key === shrinks) return clampWidth(width - RESIZE_STEP, lim);
  return null;
}

function read(key: string, lim: ResizeLimits): number {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? lim.def : clampWidth(Number(raw), lim);
  } catch {
    return lim.def;
  }
}

function write(key: string, value: number | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // storage unavailable: keep the in-memory width
  }
}

export interface Resizable {
  width: number;
  /** Set a width (clamped); `persist` false while dragging, true on release. */
  set(w: number, persist?: boolean): void;
  /** Back to the default (double click, or `Home` on nothing else): forgets the saved width. */
  reset(): void;
  limits: ResizeLimits;
}

/** Width of a side panel, kept per viewer in localStorage under `key` (works without storage). */
export function useResizable(key: string, limits: ResizeLimits): Resizable {
  const { def, min, max } = limits;
  const [width, setWidth] = useState(() => read(key, limits));
  const set = useCallback(
    (w: number, persist = true) => {
      const v = clampWidth(w, { def, min, max });
      setWidth(v);
      if (persist) write(key, v);
    },
    [key, def, min, max],
  );
  const reset = useCallback(() => {
    setWidth(def);
    write(key, null);
  }, [key, def]);
  return { width, set, reset, limits };
}
