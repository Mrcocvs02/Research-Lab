import { describe, expect, it } from 'vitest';
import { laterApplied } from './state.js';

describe('laterApplied (D-504)', () => {
  const run = [{ step: 1 }, { step: 2 }, { step: 4 }, { step: 5 }];
  it('counts the steps applied after the one to undo', () => {
    expect(laterApplied(run, 2)).toBe(2);
    expect(laterApplied(run, 1)).toBe(3);
  });
  it('the last step, or a step not in the run, has none after it', () => {
    expect(laterApplied(run, 5)).toBe(0);
    expect(laterApplied(run, 3)).toBe(0);
  });
});
