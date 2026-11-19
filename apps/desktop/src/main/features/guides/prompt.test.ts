import { describe, expect, it } from 'vitest';
import { cleanGuide, guideFromNote } from './prompt';

const page = { page: 2, text: 'We introduce a method that halves the training cost on every benchmark we tried.' };

describe('guide passages', () => {
  it('keeps only quotes that are on the named page, once each', () => {
    const q = 'a method that halves the training cost on every benchmark';
    const out = cleanGuide(
      { passages: [{ kind: 'C', page: 2, quote: q, reason: 'r' }, { kind: 'M', page: 2, quote: q, reason: 'dup' }, { kind: 'R', page: 2, quote: 'invented sentence that is not there at all', reason: 'x' }, { kind: 'L', page: 3, quote: q, reason: 'wrong page' }] },
      [page],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'C', page: 2 });
  });
  it('reads a literature note without any request', () => {
    const out = guideFromNote('## Contribution\nA new idea [p. 3](lab://doc/x)\n## Limits\nOnly small data [p. 9](lab://doc/x)');
    expect(out.map((p) => [p.kind, p.page, p.quote])).toEqual([['C', 3, null], ['L', 9, null]]);
  });
});
