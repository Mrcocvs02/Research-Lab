import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THUMB_LIMITS } from '@rl/core';
import { createThumbStore, THUMB_TIMING, type ThumbDeps, type ThumbItem } from './thumbs';

const HASH = 'ab'.repeat(32);
const id = (n: number) => n.toString(16).padStart(16, '0');
const url = (n: number, h = HASH) => `rl-thumb://thumb/${id(n)}?v=${h.slice(0, 8)}`;
const bytes = new Uint8Array([1, 2, 3]);

/** Deferred promise, to hold a drawing in flight. */
const gate = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

let cached: Map<string, string>;
let broken: Set<string>;
let active: number;
let maxActive: number;
let changed: Array<() => void>;
let deps: ThumbDeps & { list: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; draw: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
let drawGate: ReturnType<typeof gate<Uint8Array>> | null;

const tick = async (ms = THUMB_TIMING.debounceMs + 1) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  cached = new Map();
  broken = new Set();
  active = 0;
  maxActive = 0;
  changed = [];
  drawGate = null;
  deps = {
    list: vi.fn(async (ids: string[]): Promise<ThumbItem[]> => ids.map((d) => ({ docId: d, url: cached.get(d) ?? null, drawable: !cached.has(d), hash: HASH }))),
    open: vi.fn(async (d: string) => ({ url: `rl-doc://doc/${d}?v=abababab`, hash: HASH })),
    draw: vi.fn(async (u: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (drawGate) return await drawGate.promise;
        if ([...broken].some((d) => u.includes(d))) throw new Error('encrypted');
        return bytes;
      } finally {
        active--;
      }
    }),
    put: vi.fn(async (d: string, h: string) => {
      cached.set(d, url(Number.parseInt(d, 16), h));
      return cached.get(d)!;
    }),
    release: vi.fn(),
    onDocumentsChanged: (l: () => void) => {
      changed.push(l);
      return () => void changed.splice(changed.indexOf(l), 1);
    },
  };
});
afterEach(() => vi.useRealTimers());

describe('thumbnail store', () => {
  it('asks for the documents on screen in one debounced batch, then draws them one at a time', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    const seen: string[] = [];
    s.subscribe(id(1), () => seen.push(id(1)));
    s.want([id(1), id(2), id(3)]);
    s.want([id(1), id(2), id(3)]); // scrolling: the second call replaces the first, still one question
    expect(deps.list).not.toHaveBeenCalled();
    await tick();
    expect(deps.list).toHaveBeenCalledTimes(1);
    expect(deps.list).toHaveBeenCalledWith([id(1), id(2), id(3)]);
    await vi.runAllTimersAsync();
    expect(deps.draw).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    expect(deps.put).toHaveBeenCalledWith(id(1), HASH, bytes);
    expect(s.urlOf(id(1))).toBe(url(1));
    expect(s.urlOf(id(3))).toBe(url(3));
    expect(seen).toEqual([id(1)]); // told once, when the image appeared
  });

  it('a cached thumbnail is shown without opening or drawing anything', async () => {
    cached.set(id(1), url(1));
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1)]);
    await tick();
    expect(s.urlOf(id(1))).toBe(url(1));
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.draw).not.toHaveBeenCalled();
  });

  it('splits a long list into batches of at most the contract size', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    const ids = Array.from({ length: THUMB_LIMITS.batch + 5 }, (_, i) => id(i));
    s.want(ids);
    await tick();
    expect(deps.list.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([THUMB_LIMITS.batch, 5]);
    s.setActive(false);
  });

  it('does nothing before the grid is shown and nothing more after it is left', async () => {
    const s = createThumbStore(deps);
    s.want([id(1)]);
    await tick();
    expect(deps.list).not.toHaveBeenCalled();
    s.setActive(true);
    drawGate = gate();
    s.want([id(1), id(2), id(3)]);
    await tick();
    expect(deps.draw).toHaveBeenCalledTimes(1);
    s.setActive(false); // leaves the grid while the first is being drawn
    drawGate.resolve(bytes);
    await vi.runAllTimersAsync();
    expect(deps.draw).toHaveBeenCalledTimes(1); // the queue stopped
    expect(deps.put).not.toHaveBeenCalled(); // and the late image is dropped
    expect(changed).toHaveLength(0); // no event listener left
    expect(s.stats().queued).toBe(0);
  });

  it('an item that scrolled away before its turn is not drawn', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    drawGate = gate();
    s.want([id(1), id(2)]);
    await tick();
    expect(deps.draw).toHaveBeenCalledTimes(1);
    s.want([id(1)]); // 2 is no longer on screen
    drawGate.resolve(bytes);
    drawGate = null;
    await vi.runAllTimersAsync();
    expect(deps.draw).toHaveBeenCalledTimes(1);
    expect(s.urlOf(id(2))).toBeNull();
  });

  it('a failed drawing is marked and not tried again in a loop', async () => {
    broken.add(id(2));
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1), id(2), id(3)]);
    await vi.runAllTimersAsync();
    expect(s.urlOf(id(1))).toBe(url(1));
    expect(s.urlOf(id(2))).toBeNull();
    expect(s.urlOf(id(3))).toBe(url(3)); // the next one went on
    expect(s.stats().failed).toBe(1);
    const before = deps.draw.mock.calls.length;
    s.want([id(2)]); // back on screen
    s.want([id(1), id(2), id(3)]);
    await vi.runAllTimersAsync();
    expect(deps.draw.mock.calls.length).toBe(before);
  });

  it('a failure on a file that then changes is tried again once', async () => {
    broken.add(id(2));
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(2)]);
    await vi.runAllTimersAsync();
    expect(deps.draw).toHaveBeenCalledTimes(1);
    const other = 'cd'.repeat(32);
    deps.list.mockImplementation(async (ids: string[]) => ids.map((d) => ({ docId: d, url: null, drawable: true, hash: other })));
    broken.clear();
    changed.forEach((l) => l());
    await vi.runAllTimersAsync();
    expect(deps.draw).toHaveBeenCalledTimes(2);
    expect(s.urlOf(id(2))).not.toBeNull();
  });

  it('a library event refreshes the URLs of what is on screen; the new version busts the cache', async () => {
    cached.set(id(1), url(1));
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1)]);
    await tick();
    expect(s.urlOf(id(1))).toBe(url(1));
    const seen = vi.fn();
    s.subscribe(id(1), seen);
    const other = 'cd'.repeat(32);
    cached.set(id(1), url(1, other));
    changed.forEach((l) => l());
    expect(s.urlOf(id(1))).toBe(url(1)); // the old image stays until main answers
    await tick();
    expect(deps.list).toHaveBeenCalledTimes(2);
    expect(s.urlOf(id(1))).toBe(url(1, other));
    expect(seen).toHaveBeenCalled();
  });

  it('a stale put (the file changed meanwhile) asks again once, then gives up', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    deps.put.mockResolvedValue(null);
    s.want([id(1)]);
    await vi.runAllTimersAsync();
    expect(deps.draw.mock.calls.length).toBeLessThanOrEqual(2);
    expect(s.urlOf(id(1))).toBeNull();
    const n = deps.draw.mock.calls.length;
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.idleMs * 2);
    expect(deps.draw.mock.calls.length).toBe(n);
  });

  it('a list that fails leaves the icons and does not throw', async () => {
    deps.list.mockRejectedValueOnce(new Error('down'));
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1)]);
    await tick();
    expect(s.urlOf(id(1))).toBeNull();
    expect(deps.draw).not.toHaveBeenCalled();
  });

  it('releases the pdf.js worker after the idle time, only if something was drawn, and not while drawing', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1)]);
    await tick();
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.idleMs - 100);
    expect(deps.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(deps.release).toHaveBeenCalledTimes(1);

    const release = vi.fn();
    const idle = createThumbStore({ ...deps, release });
    idle.setActive(true);
    cached.set(id(9), url(9));
    idle.want([id(9)]); // only a cached image: pdf.js was never loaded, nothing to release
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.idleMs * 2);
    expect(release).not.toHaveBeenCalled();
  });

  it('the idle timer starts again when new work comes and does not fire in the middle of it', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1)]);
    await tick();
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.idleMs - 1000);
    s.want([id(1), id(2)]);
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.debounceMs + 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.idleMs);
    expect(deps.release).toHaveBeenCalledTimes(1);
  });

  it('leaving the grid still releases the worker after the idle time', async () => {
    const s = createThumbStore(deps);
    s.setActive(true);
    s.want([id(1)]);
    await tick();
    s.setActive(false);
    await vi.advanceTimersByTimeAsync(THUMB_TIMING.idleMs + 10);
    expect(deps.release).toHaveBeenCalledTimes(1);
  });
});
