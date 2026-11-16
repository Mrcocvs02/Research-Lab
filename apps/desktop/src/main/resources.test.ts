import { describe, expect, it } from 'vitest';
import { applyResourceSwitches, DISABLED_FEATURES } from './resources.js';

describe('resource switches', () => {
  it('disable only the listed features, once, and leave the security features alone', () => {
    const calls: Array<[string, string | undefined]> = [];
    applyResourceSwitches({ appendSwitch: (name, value) => void calls.push([name, value]) });
    expect(calls).toEqual([['disable-features', DISABLED_FEATURES.join(',')]]);
    for (const f of DISABLED_FEATURES) expect(f).not.toMatch(/sandbox|isolation|csp|security/i);
  });
});
