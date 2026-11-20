import { describe, expect, it } from 'vitest';
import type { TaxonomyFile } from '@rl/core';
import { candidateBlock, pickLatent, type CandidateNode } from './candidates.js';
import { cleanAnalysis, type AnalysisRaw } from './prompts.js';
import { cleanSuggestion, LATENT_MAX, LATENT_RULE, latentLines, suggestPrompt, taxonomyBlock, type LatentConcept, type LatentLookup, type TagNodeView } from '../suggest.js';

/** Latent concepts of the field vocabulary in the tagging prompts (D-519): synthetic names only. */
const node = (id: string, label: string, parents: string[] = [], extra: Partial<CandidateNode> = {}): CandidateNode => ({ id, label, aliases: [], parents, ...extra });
const NODES: CandidateNode[] = [node('topic', 'Topic', [], { family: 'many' }), node('alpha', 'Alpha theory', ['topic']), node('beta', 'Beta states', ['topic'])];
const tax = {
  schemaVersion: 1,
  revision: 1,
  nodes: NODES.map((n) => ({ ...n, parents: [...n.parents], aliases: [], implies: [], status: 'active', origin: 'user' })),
  documentTypes: [],
  venues: [],
} as unknown as TaxonomyFile;

const latent = (n: number, label = `Concept ${n}`, path = 'Topic › Area'): LatentConcept => ({ short: `f${n}`, label, aliases: [], path });
const views: TagNodeView[] = [{ id: 'alpha', label: 'Alpha theory', path: 'Topic', aliases: [], family: 'Topic', one: false }];

describe('the prompt without a field vocabulary', () => {
  it('is exactly what it always was', () => {
    // The block as it was written before the latent concepts existed.
    const before = '<<<TAXONOMY\n- alpha | Alpha theory | Topic | aliases: \nTAXONOMY>>>';
    expect(taxonomyBlock(views)).toBe(before);
    expect(taxonomyBlock(views, [])).toBe(before);
    expect(suggestPrompt(['tags'], '<<<DATA\nx\nDATA>>>', views)).toBe(`${before}\n<<<DATA\nx\nDATA>>>\nFill: tags.`);
    const cands = [{ id: 'alpha', score: 1, via: 'text' as const }];
    expect(candidateBlock(cands, NODES)).toBe(candidateBlock(cands, NODES, []));
    expect(candidateBlock(cands, NODES)).not.toContain(LATENT_RULE);
  });
});

describe('latent lines', () => {
  it('come after every line of the library, with the rule once, and only when there is a latent concept', () => {
    const block = taxonomyBlock(views, [latent(3), latent(4)]);
    const lines = block.split('\n');
    expect(lines.filter((l) => l === LATENT_RULE)).toHaveLength(1);
    expect(lines.indexOf(LATENT_RULE)).toBeGreaterThan(lines.indexOf('- alpha | Alpha theory | Topic | aliases: '));
    // The closing delimiter stays the last line; the latent lines sit right before it.
    expect(lines.at(-1)).toBe('TAXONOMY>>>');
    expect(lines.slice(-3, -1)).toEqual(['- f3 | Concept 3 | Topic › Area', '- f4 | Concept 4 | Topic › Area']);
    // The text before the latent part is the block of a library without a pack.
    expect(block.startsWith(taxonomyBlock(views).replace('\nTAXONOMY>>>', ''))).toBe(true);
    expect(latentLines([])).toEqual([]);
  });

  it('leave the path out when the concept sits right under the family', () => {
    expect(latentLines([latent(7, 'Top concept', 'Topic')])).toEqual([LATENT_RULE, '- f7 | Top concept |']);
  });

  it('are at most 15 per work and the best ones for the text', () => {
    const pool = Array.from({ length: 40 }, (_, i) => latent(i, `Theme ${i} entanglement-like`));
    const text = `${pool.map((p) => p.label).join(' ')} entanglement`;
    const picked = pickLatent(text, pool);
    expect(picked.length).toBeLessThanOrEqual(LATENT_MAX);
    expect(picked.length).toBe(15);
    expect(new Set(picked.map((p) => p.short)).size).toBe(15);
    expect(pickLatent(text, pool)).toEqual(picked);
  });

  it('offer only what the text is about', () => {
    const pool = [latent(1, 'Gamma flow'), latent(2, 'Delta chains'), latent(3, 'Epsilon maps')];
    expect(pickLatent('We study delta chains and gamma flow.', pool).map((p) => p.short).sort()).toEqual(['f1', 'f2']);
    expect(pickLatent('Nothing in common here.', pool)).toEqual([]);
  });
});

describe('answers that use a latent concept', () => {
  const lookup: LatentLookup = {
    byShort: (id) => (id === 'f3' ? { label: 'Gamma flow', parentId: 'alpha', pack: 'test-pack/topic.gamma-flow' } : null),
    byLabel: (label) => (label.toLowerCase() === 'gamma flow' ? { label: 'Gamma flow', parentId: 'alpha', pack: 'test-pack/topic.gamma-flow' } : null),
  };

  it('an `f…` id becomes a proposal "from the field", not a tag of the library', () => {
    const c = cleanSuggestion({ tagIds: ['alpha', 'f3', 'f9'], newTags: [] }, ['tags'], tax, { latent: lookup });
    expect(c.tags).toEqual(['alpha']);
    expect(c.newTags).toEqual([{ label: 'Gamma flow', parentId: 'alpha', aliases: [], pack: 'test-pack/topic.gamma-flow' }]);
  });

  it('a free new tag that names a concept becomes the same proposal (once), with the reason of the model', () => {
    const c = cleanSuggestion(
      { tagIds: ['f3'], newTags: [{ label: 'gamma flow', parentId: null, aliases: [], reason: 'the paper is about it' }, { label: 'Zeta solver', parentId: 'alpha', aliases: [], reason: '' }] },
      ['tags'],
      tax,
      { latent: lookup },
    );
    expect(c.newTags?.map((t) => [t.label, t.pack])).toEqual([
      ['Zeta solver', undefined],
      ['Gamma flow', 'test-pack/topic.gamma-flow'],
    ]);
  });

  it('without a lookup an `f…` id is dropped like any unknown id', () => {
    expect(cleanSuggestion({ tagIds: ['alpha', 'f3'], newTags: [] }, ['tags'], tax).newTags).toEqual([]);
  });

  it('the analysis answer works the same way, with a weight', () => {
    const raw: AnalysisRaw = { tags: [{ id: 'f3', weight: 0.8, reason: 'main subject' }, { id: 'alpha', weight: 0.9, reason: '' }, { id: 'f3', weight: 0.1, reason: '' }], newTags: [] };
    const c = cleanAnalysis(raw, ['tags'], tax, { latent: lookup });
    expect(c.tags).toContain('alpha');
    expect(c.newTags).toEqual([{ label: 'Gamma flow', parentId: 'alpha', aliases: [], pack: 'test-pack/topic.gamma-flow', reason: 'main subject' }]);
  });
});
