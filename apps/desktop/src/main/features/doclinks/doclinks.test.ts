import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalThreshold, passes, scorePair, thresholdFor, type DocFeatures, type ScoreContext } from './score.js';
import { mutateLinks, ordered, pairKey, readLinks } from './store.js';

const ctx: ScoreContext = { terms: ['alpha', 'beta', 'gamma'], keyCap: () => false, skipTag: (t) => t === 'root', tagLabel: (t) => t.toUpperCase() };
const vec = (...w: number[]) => ({ i: Int32Array.from(w.map((_, k) => k)), w: Float32Array.from(w) });
const doc = (id: string, over: Partial<DocFeatures> = {}): DocFeatures => ({ id, vec: null, refs: new Set(), cites: new Set(), citedBy: new Set(), tags: new Map(), authors: new Map(), ...over });

describe('threshold', () => {
  it('is the clamped median of the neighbour scores, 0.25 without a model', () => {
    expect(normalThreshold([])).toBe(0.25);
    expect(normalThreshold([0.01, 0.02, 0.03])).toBe(0.15);
    expect(normalThreshold([0.9, 0.8, 0.95])).toBe(0.4);
    expect(normalThreshold([0.2, 0.3])).toBe(0.25);
  });
  it('is stricter or wider by a fixed step inside its limits', () => {
    expect(thresholdFor(0.3, 'strict')).toBe(0.4);
    expect(thresholdFor(0.4, 'strict')).toBe(0.5);
    expect(thresholdFor(0.3, 'wide')).toBe(0.23);
    expect(thresholdFor(0.15, 'wide')).toBe(0.1);
    expect(thresholdFor(0.3, 'normal')).toBe(0.3);
  });
});

describe('evidence rule', () => {
  it('does not add a pair above the threshold that has no strong proof', () => {
    // Only a weak shared tag (w 0.3) and authors: a high-ish score is not enough without evidence.
    const s = doc('a', { tags: new Map([['x', 0.3]]), authors: new Map([['k1', 'A'], ['k2', 'B']]) });
    const t = doc('b', { tags: new Map([['x', 0.3]]), authors: new Map([['k1', 'A'], ['k2', 'B']]) });
    const r = scorePair(s, t, ctx);
    expect(r.evidence).toBe(false);
    expect(passes(r, 0.1)).toBe(false);
  });
  it('accepts text, a direct citation, enough shared references or a main tag', () => {
    const v = vec(1, 0, 0);
    expect(scorePair(doc('a', { vec: v }), doc('b', { vec: v }), ctx).evidence).toBe(true);
    const d = scorePair(doc('a', { cites: new Set(['b']) }), doc('b'), ctx);
    expect(d.evidence).toBe(true);
    expect(d.score).toBeGreaterThanOrEqual(0.5);
    expect(d.reasons.cites).toBe('to');
    expect(scorePair(doc('a'), doc('b', { cites: new Set(['a']) }), ctx).reasons.cites).toBe('from');
    const keys = new Set(['r:1', 'r:2', 'r:3']);
    expect(scorePair(doc('a', { refs: keys }), doc('b', { refs: keys }), ctx).evidence).toBe(true);
    expect(scorePair(doc('a', { refs: new Set(['r:1', 'r:2']) }), doc('b', { refs: new Set(['r:1', 'r:2']) }), ctx).evidence).toBe(false);
    const main = scorePair(doc('a', { tags: new Map([['x', 0.7]]) }), doc('b', { tags: new Map([['x', 0.9]]) }), ctx);
    expect(main.evidence).toBe(true);
    expect(main.reasons.tags).toEqual(['X']);
  });
  it('ignores root tags and shared words only count with the text signal', () => {
    const r = scorePair(doc('a', { tags: new Map([['root', 1]]) }), doc('b', { tags: new Map([['root', 1]]) }), ctx);
    expect(r.score).toBe(0);
    expect(r.evidence).toBe(false);
    const v = vec(1, 1, 0);
    expect(scorePair(doc('a', { vec: v }), doc('b', { vec: v }), ctx).reasons.terms).toContain('alpha');
  });
  it('scores the same either way round', () => {
    const a = doc('a', { vec: vec(1, 0.5, 0), tags: new Map([['x', 0.8]]), authors: new Map([['k', 'K']]) });
    const b = doc('b', { vec: vec(0.7, 1, 0), tags: new Map([['x', 0.6]]), authors: new Map([['k', 'K']]) });
    expect(scorePair(a, b, ctx).score).toBeCloseTo(scorePair(b, a, ctx).score, 10);
  });
});

describe('stored links', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });
  const tmp = async () => {
    const d = await mkdtemp(path.join(os.tmpdir(), 'rl-doclinks-'));
    dirs.push(d);
    return d;
  };

  it('treats a pair as unordered', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
    expect(ordered('b', 'a')).toEqual({ a: 'a', b: 'b' });
  });

  it('keeps the dismissed pairs and an empty file when none exists', async () => {
    const dir = await tmp();
    expect((await readLinks(dir)).links).toEqual([]);
    const d1 = '1111111111111111';
    const d2 = '2222222222222222';
    await mutateLinks(dir, (f) => {
      f.links.push({ id: 'l1', ...ordered(d2, d1), weight: 0.5, reasons: {}, origin: 'finder', runId: 'r', at: new Date().toISOString() });
      return { changed: true, value: null };
    });
    await mutateLinks(dir, (f) => {
      f.links = [];
      f.dismissed.push({ a: d1, b: d2, at: new Date().toISOString() });
      return { changed: true, value: null };
    });
    const f = await readLinks(dir);
    expect(f.links).toEqual([]);
    expect(new Set(f.dismissed.map((x) => pairKey(x.a, x.b)))).toEqual(new Set([pairKey(d2, d1)]));
  });

  it('runs concurrent changes one after the other', async () => {
    const dir = await tmp();
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        mutateLinks(dir, (f) => {
          f.dismissed.push({ a: String(n).repeat(16), b: 'f'.repeat(16), at: new Date().toISOString() });
          return { changed: true, value: null };
        }),
      ),
    );
    expect((await readLinks(dir)).dismissed).toHaveLength(5);
  });
});
