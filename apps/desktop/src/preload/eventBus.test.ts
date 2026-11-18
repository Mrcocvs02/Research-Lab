import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createEventBus } from './eventBus';

describe('createEventBus (W8)', () => {
  it('keeps one listener on the channel however many subscribers there are, so 20 opens never warn', () => {
    const ipc = new EventEmitter();
    const warnings: unknown[] = [];
    process.on('warning', (w) => warnings.push(w));
    let current: ((name: string, payload: unknown) => void) | null = null;
    const bus = createEventBus(
      (d) => {
        current = d;
        ipc.on('rl:event', (_e: unknown, n: string, p: unknown) => d(n, p));
      },
      () => ipc.removeAllListeners('rl:event'),
    );
    const got: unknown[] = [];
    const offs = Array.from({ length: 25 }, (_, i) => bus.subscribe(i % 2 ? 'a' : 'b', (p) => got.push(p)));
    expect(ipc.listenerCount('rl:event')).toBe(1);
    expect(current).not.toBeNull();
    ipc.emit('rl:event', {}, 'a', 1);
    expect(got).toHaveLength(12);
    offs.forEach((off) => off());
    expect(bus.size()).toBe(0);
    expect(ipc.listenerCount('rl:event')).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('unsubscribing twice is harmless and the same function can be subscribed twice', () => {
    let attached = 0;
    const bus = createEventBus(
      () => attached++,
      () => attached--,
    );
    const f = () => {};
    const a = bus.subscribe('x', f);
    const b = bus.subscribe('x', f);
    a();
    a();
    expect(bus.size()).toBe(1);
    b();
    expect(attached).toBe(0);
  });
});
