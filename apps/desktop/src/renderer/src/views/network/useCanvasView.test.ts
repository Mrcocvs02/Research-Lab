// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasView } from './useCanvasView';

/** A canvas that draws nothing, a fixed size and a frame queue we drive by hand: what counts is when a frame is asked for. */
let queue: Array<(t: number) => void> = [];
let asked = 0;
let reduced = false;

function flush(now: number): number {
  const run = queue;
  queue = [];
  for (const cb of run) cb(now);
  return run.length;
}

beforeEach(() => {
  queue = [];
  asked = 0;
  reduced = false;
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 300, x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 300, toJSON: () => ({}) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    asked++;
    queue.push(cb);
    return asked;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(ticks: { left: number }) {
  const api: { current: ReturnType<typeof useCanvasView<number>> | null } = { current: null };
  function Probe() {
    const v = useCanvasView<number>({
      draw() {},
      hit: () => null,
      onHover() {},
      onClick() {},
      bounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
      tick: () => ticks.left-- > 0,
    });
    api.current = v;
    return createElement('canvas', { ref: v.canvas, ...v.handlers });
  }
  render(createElement(Probe));
  return api;
}

/** Runs frames (16.7 ms apart) until none is asked for; returns how many ran, or -1 when it never stops. */
function settle(limit = 600): number {
  let now = 1000;
  for (let i = 0; i < limit; i++) {
    now += 16.7;
    if (flush(now) === 0) return i;
  }
  return -1;
}

describe('the canvas hook asks for no frame at rest', () => {
  it('draws while the simulation is hot and then stops asking', () => {
    const ticks = { left: 30 };
    const api = mount(ticks);
    api.current!.requestDraw();
    const frames = settle();
    expect(frames).toBeGreaterThan(25);
    expect(frames).toBeLessThan(40);
    const after = asked;
    expect(flush(5000)).toBe(0);
    expect(asked).toBe(after);
  });

  it('a flight and a smooth zoom run for a while, then nothing is asked again', () => {
    const api = mount({ left: 0 });
    api.current!.requestDraw();
    settle();
    act(() => api.current!.flyTo(5, 5, 4));
    const flight = settle();
    expect(flight).toBeGreaterThan(30);
    expect(api.current!.view.current.k).toBeCloseTo(4, 3);
    act(() => api.current!.zoom(2));
    expect(settle()).toBeGreaterThan(5);
    expect(api.current!.view.current.k).toBeCloseTo(8, 2);
    const asking = asked;
    expect(flush(99999)).toBe(0);
    expect(asked).toBe(asking);
  });

  it('with reduced motion a flight is a single frame', () => {
    reduced = true;
    const api = mount({ left: 0 });
    api.current!.requestDraw();
    settle();
    act(() => api.current!.flyTo(2, 3, 5));
    expect(settle()).toBeLessThanOrEqual(1);
    expect(api.current!.view.current).toEqual({ cx: 2, cy: 3, k: 5 });
  });

  it('counts the frames it draws on the canvas', () => {
    const api = mount({ left: 3 });
    api.current!.requestDraw();
    settle();
    const n = Number(api.current!.canvas.current!.dataset['frames']);
    expect(n).toBeGreaterThanOrEqual(3);
  });
});
