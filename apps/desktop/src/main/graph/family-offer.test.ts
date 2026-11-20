import { describe, expect, it } from 'vitest';
import { isSourceFamily } from './family-offer.js';

describe('isSourceFamily', () => {
  it('flags provenance names, whatever the case or the punctuation', () => {
    for (const n of ['manual', 'Manual tags', 'Files (sidecar)', 'imported-2020', 'legacy']) expect(isSourceFamily(n)).toBe(true);
  });
  it('keeps real classifications', () => {
    for (const n of ['Method', 'Research group', 'Topic', 'Evidence level', '']) expect(isSourceFamily(n)).toBe(false);
  });
});
