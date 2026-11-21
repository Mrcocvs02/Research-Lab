// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('../../lib/rl', () => ({ rl: { invoke } }));

const FAMILIES = (pack: boolean) => ({ families: [{ id: 'topic', label: 'Topic', count: 30, eligible: true, reason: { coverage: 0.81, clarity: 0.42, values: 5 }, ...(pack ? { pack: true } : {}) }, { id: 'auto', label: 'Automatic', count: 0, eligible: true }] });

/** A fresh copy of the module (the default it learnt is module state) shown through a probe component. */
async function mount(pack: boolean, stored?: string) {
  vi.resetModules();
  window.localStorage.clear();
  if (stored) window.localStorage.setItem('rl.map.family', stored);
  invoke.mockResolvedValue(FAMILIES(pack));
  const g = await import('./grouping');
  const seen: Array<[string, boolean]> = [];
  const Probe = () => {
    const [family, , settled] = g.useFamily();
    g.useFamilies(undefined, true);
    seen.push([family, settled]);
    return null;
  };
  await act(async () => {
    render(createElement(Probe));
  });
  return seen;
}

beforeEach(() => invoke.mockReset());
afterEach(cleanup);

describe('the family the Map opens with (D-574)', () => {
  it('is Topic when a field vocabulary is active and Topic is eligible, and it is not written down', async () => {
    const seen = await mount(true);
    expect(seen[0]).toEqual(['auto', false]);
    expect(seen.at(-1)).toEqual(['topic', true]);
    expect(window.localStorage.getItem('rl.map.family')).toBeNull();
  });
  it('is Automatic without a vocabulary (D-510)', async () => {
    expect((await mount(false)).at(-1)).toEqual(['auto', true]);
  });
  it('keeps the last explicit choice, from the first render', async () => {
    const seen = await mount(true, 'auto');
    expect(seen[0]).toEqual(['auto', true]);
    expect(seen.at(-1)).toEqual(['auto', true]);
    const seen2 = await mount(true, 'level:method');
    expect(seen2.at(-1)).toEqual(['level:method', true]);
  });
});
