import { clampK, type View } from './geometry';

/**
 * The motion of the camera, as pure steps (no DOM, no timers): smooth zoom towards a target, drag inertia and the flight to
 * a point. `useCanvasView` calls them once per frame while `active(motion)` is true and asks for no frame otherwise, so a
 * resting view draws nothing. With reduced motion every move is immediate (no inertia, no interpolation).
 */
export interface ZoomTarget {
  k: number;
  /** Screen point the zoom keeps in place. */
  sx: number;
  sy: number;
}

export interface Flight {
  from: View;
  to: View;
  ms: number;
  /** Elapsed milliseconds. */
  t: number;
  /** How far (in screen units at the lower zoom) the flight goes: a long one dips out and in again. */
  dip: number;
}

export interface Motion {
  /** Inertia in screen pixels per 60 Hz frame. */
  vx: number;
  vy: number;
  zoom: ZoomTarget | null;
  flight: Flight | null;
}

export const newMotion = (): Motion => ({ vx: 0, vy: 0, zoom: null, flight: null });
export const active = (m: Motion): boolean => m.zoom !== null || m.flight !== null || m.vx !== 0 || m.vy !== 0;

export const INERTIA_DECAY = 0.92;
export const INERTIA_STOP = 0.05;
export const ZOOM_EASE = 0.25;
export const FLIGHT_MS = 700;
const FRAME = 1000 / 60;

export const reducedMotion = (): boolean => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Zoom by `factor` (relative to the target in progress), keeping the screen point still. */
export function zoomBy(m: Motion, v: View, sx: number, sy: number, factor: number, base: number): void {
  const k = clampK((m.zoom?.k ?? v.k) * factor, base);
  m.zoom = { k, sx, sy };
}

/** One step of the zoom: `k += (target - k) * 0.25` per frame, anchored at the screen point. */
export function stepZoom(v: View, z: ZoomTarget, dt: number, w: number, h: number): { view: View; done: boolean } {
  const e = 1 - Math.pow(1 - ZOOM_EASE, dt / FRAME);
  let k = v.k + (z.k - v.k) * e;
  const done = Math.abs(Math.log(z.k / k)) < 0.002;
  if (done) k = z.k;
  const wx = v.cx + (z.sx - w / 2) / v.k;
  const wy = v.cy + (z.sy - h / 2) / v.k;
  return { view: { k, cx: wx - (z.sx - w / 2) / k, cy: wy - (z.sy - h / 2) / k }, done };
}

/** One step of the drag inertia: velocity decays by 0.92 per frame and stops under 0.05 px. */
export function stepInertia(m: Motion, v: View, dt: number): View {
  const steps = dt / FRAME;
  const f = Math.pow(INERTIA_DECAY, steps);
  const dx = m.vx * ((1 - f) / (1 - INERTIA_DECAY));
  const dy = m.vy * ((1 - f) / (1 - INERTIA_DECAY));
  m.vx *= f;
  m.vy *= f;
  if (Math.hypot(m.vx, m.vy) < INERTIA_STOP) {
    m.vx = 0;
    m.vy = 0;
  }
  return { ...v, cx: v.cx - dx / v.k, cy: v.cy - dy / v.k };
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A flight from one view to another; when the distance is large the camera zooms out and in again. */
export function makeFlight(from: View, to: View, ms = FLIGHT_MS, w = 800, h = 600): Flight {
  const kmin = Math.min(from.k, to.k);
  const dist = Math.hypot(to.cx - from.cx, to.cy - from.cy) * kmin;
  const dip = dist > Math.min(w, h) * 0.6 ? Math.log(dist / (Math.min(w, h) * 0.6)) * 0.5 : 0;
  return { from, to, ms, t: 0, dip };
}

/** The view at the elapsed time of a flight (interpolating centre and log-zoom, with the dip in the middle). */
export function flightAt(f: Flight, t: number): View {
  const u = Math.min(Math.max(t / f.ms, 0), 1);
  const s = ease(u);
  const lk = Math.log(f.from.k) + (Math.log(f.to.k) - Math.log(f.from.k)) * s - f.dip * 4 * s * (1 - s);
  return { cx: f.from.cx + (f.to.cx - f.from.cx) * s, cy: f.from.cy + (f.to.cy - f.from.cy) * s, k: Math.exp(lk) };
}

/**
 * Advances every motion by `dt` ms and returns the new view; the motion state is updated (finished parts are cleared).
 * A drag or a new command cancels the others: the caller clears `zoom`, `flight` and the velocity.
 */
export function stepMotion(m: Motion, v: View, dt: number, w: number, h: number): View {
  let view = v;
  if (m.flight) {
    m.flight.t += dt;
    view = flightAt(m.flight, m.flight.t);
    if (m.flight.t >= m.flight.ms) {
      view = m.flight.to;
      m.flight = null;
    }
    return view;
  }
  if (m.zoom) {
    const r = stepZoom(view, m.zoom, dt, w, h);
    view = r.view;
    if (r.done) m.zoom = null;
  }
  if (m.vx !== 0 || m.vy !== 0) view = stepInertia(m, view, dt);
  return view;
}
