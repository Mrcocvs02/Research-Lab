import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, cacheHash, chunk, costDecision, planBatch } from './batch.js';

const base = { approxTokens: 900, cached: false, firstFolderSend: false, thresholdTokens: 5000, todayTokens: 0, dailyCap: null, outTokens: 400 };

describe('ai batch', () => {
  it('splits into blocks of at most 10', () => {
    const blocks = chunk(Array.from({ length: 23 }, (_, i) => i));
    expect(BATCH_SIZE).toBe(10);
    expect(blocks.map((b) => b.length)).toEqual([10, 10, 3]);
    expect(chunk([])).toEqual([]);
  });
  it('caches by content, model and prompt version: same request, same key', () => {
    expect(cacheHash(['v1', 'haiku', 'text'])).toBe(cacheHash(['v1', 'haiku', 'text']));
    expect(cacheHash(['v1', 'haiku', 'text'])).not.toBe(cacheHash(['v1', 'sonnet', 'text']));
    expect(cacheHash(['v1', 'haiku', 'text'])).not.toBe(cacheHash(['v2', 'haiku', 'text']));
    expect(cacheHash(['v1', 'haiku', 'text'])).not.toBe(cacheHash(['v1', 'haiku', 'other']));
  });
  it('estimate under the threshold: no dialog', () => {
    expect(costDecision(base)).toEqual({ needsDialog: false, overDailyCap: false, todayPct: null });
  });
  it('over the threshold, or the first send for a folder: dialog', () => {
    expect(costDecision({ ...base, approxTokens: 5001 }).needsDialog).toBe(true);
    expect(costDecision({ ...base, firstFolderSend: true }).needsDialog).toBe(true);
  });
  it('a cached request never asks and never counts', () => {
    const d = costDecision({ ...base, cached: true, approxTokens: 9000, firstFolderSend: true, todayTokens: 100, dailyCap: 1000 });
    expect(d).toEqual({ needsDialog: false, overDailyCap: false, todayPct: 10 });
  });
  it("the cap of the day: share used with this send, refused past it", () => {
    expect(costDecision({ ...base, todayTokens: 100, dailyCap: 2600 }).todayPct).toBe(54);
    expect(costDecision({ ...base, todayTokens: 100, dailyCap: 1000 }).overDailyCap).toBe(true);
    expect(costDecision({ ...base, todayTokens: 100, dailyCap: 1400 }).overDailyCap).toBe(false);
  });
  it('plans blocks without the cached items', () => {
    const p = planBatch(Array.from({ length: 25 }, (_, i) => i), (i) => i % 5 === 0);
    expect(p.cached).toBe(5);
    expect(p.toSend).toBe(20);
    expect(p.blocks.map((b) => b.length)).toEqual([10, 10]);
  });
});
