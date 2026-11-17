import { describe, expect, it } from 'vitest';
import { createCitationSources } from './service.js';

/**
 * The online sources against the REAL network (only with `RL_LIVE_NET=1`, never in the normal suite), on a famous public
 * paper (no data of the user): the parsers must understand today's OpenAlex answers.
 */
describe.skipIf(process.env.RL_LIVE_NET !== '1')('live OpenAlex (RL_LIVE_NET=1)', () => {
  it('resolves a public DOI, lists its references and finds cited-by works', async () => {
    const [openAlex] = createCitationSources({ fetch: globalThis.fetch.bind(globalThis) });
    const ref = { doi: '10.1038/nature14539', title: 'Deep learning', year: 2015, authors: ['Yann LeCun'] };
    const meta = await openAlex!.lookup(ref);
    expect(meta?.title?.toLowerCase()).toContain('deep learning');
    const refs = await openAlex!.fetchReferences(ref);
    expect(refs.length).toBeGreaterThan(20);
    expect(refs.filter((r) => r.title).length).toBeGreaterThan(10);
    const citedBy = await openAlex!.fetchCitedBy(ref);
    expect(citedBy.length).toBeGreaterThan(0);
  }, 120_000);
});
