import { describe, expect, it } from 'vitest';
import { taxonomyFileSchema } from '@rl/core';
import { createMockAiProvider } from './mock.js';
import { activeTagNodes, cleanSuggestion, parseTaxonomyBlock, suggestPrompt, suggestSchema, suggestSystem, tagResolver, taxonomyBlock } from './suggest.js';

const tax = taxonomyFileSchema.parse({
  nodes: [
    { id: 'robots', label: 'Robotics', aliases: ['robot'] },
    { id: 'planning', label: 'Motion planning', parents: ['robots'] },
    { id: 'old', label: 'Old node', status: 'deprecated' },
    { id: 'merged-into', label: 'Learning', mergedFrom: ['was-merged'] },
  ],
});

describe('suggest helpers', () => {
  it('lists active nodes with their parent path and renders a parsable block', () => {
    const nodes = activeTagNodes(tax);
    expect(nodes.map((n) => n.id)).toEqual(['robots', 'planning', 'merged-into']);
    expect(nodes[1]!.path).toBe('Robotics');
    const block = taxonomyBlock(nodes);
    expect(parseTaxonomyBlock(block)).toEqual([
      { id: 'robots', label: 'Robotics' },
      { id: 'planning', label: 'Motion planning' },
      { id: 'merged-into', label: 'Learning' },
    ]);
  });

  it('builds a schema of the requested fields only', () => {
    expect(Object.keys(suggestSchema(['tags', 'summary']).shape)).toEqual(['tagIds', 'newTags', 'summary']);
    expect(suggestSystem(['description'], 'it')).toContain('Italian');
  });

  it('drops unknown and deprecated ids, resolves merged ones, caps and cleans the rest', () => {
    const r = tagResolver(tax);
    expect(r('ROBOTS')).toBe('robots');
    expect(r('was-merged')).toBe('merged-into');
    expect(r('old')).toBeNull();
    expect(r('nope')).toBeNull();
    const c = cleanSuggestion(
      {
        tagIds: ['robots', 'robots', 'old', 'was-merged', 'zzz'],
        newTags: [
          { label: 'robotics', parentId: null, aliases: [], reason: '' },
          { label: 'Soft grippers', parentId: 'missing', aliases: ['SG', 'sg'], reason: 'none fits' },
          { label: 'A', parentId: 'planning', aliases: [], reason: '' },
          { label: 'B', parentId: null, aliases: [], reason: '' },
          { label: 'C', parentId: null, aliases: [], reason: '' },
        ],
        description: 'x'.repeat(5000),
        keywords: Array.from({ length: 30 }, (_, i) => `k${i}`),
      },
      ['tags', 'description', 'keywords'],
      tax,
    );
    expect(c.tags).toEqual(['robots', 'merged-into']);
    expect(c.newTags).toHaveLength(3);
    expect(c.newTags![0]).toMatchObject({ label: 'Soft grippers', parentId: null, aliases: ['SG'] });
    expect(c.newTags![1]!.parentId).toBe('planning');
    expect(c.description).toHaveLength(1200);
    expect(c.keywords).toHaveLength(12);
    expect(c.summary).toBeUndefined();
  });

  it('the mock picks taxonomy ids whose label words appear in the data, else the first node', async () => {
    const mock = createMockAiProvider();
    const nodes = activeTagNodes(tax);
    const ask = (data: string) =>
      mock.completeStructured({ model: 'm', reasoning: 'low', system: 's', source: 'job:suggest', schema: suggestSchema(['tags', 'summary']), prompt: suggestPrompt(['tags', 'summary'], `<<<DATA document\n${data}\nDATA>>>`, nodes) });
    expect((await ask('a study of motion planning')).value).toMatchObject({ tagIds: ['planning'], newTags: [], summary: 'Mock summary.' });
    expect((await ask('nothing related')).value.tagIds).toEqual(['robots']);
  });
});

const vocab = taxonomyFileSchema.parse({
  nodes: [
    { id: 'topic', label: 'Topic', family: 'many' },
    { id: 'robotics', label: 'Robotics', parents: ['topic'] },
    { id: 'planning', label: 'Motion planning', parents: ['robotics'] },
    { id: 'method', label: 'Method', family: 'one' },
    { id: 'survey', label: 'Survey', parents: ['method'] },
    { id: 'experiment', label: 'Experiment', parents: ['method'] },
    { id: 'kw', label: 'Keywords', family: 'keywords' },
    { id: 'kw1', label: 'Alpha', parents: ['kw'] },
    { id: 'loose', label: 'Misc' },
  ],
});

describe('AI constrained to the vocabulary (D-496)', () => {
  it('offers only the values of the one/many families, with their path and the one-value rule', () => {
    const nodes = activeTagNodes(vocab);
    expect(nodes.map((n) => n.id)).toEqual(['robotics', 'planning', 'survey', 'experiment']);
    expect(nodes[1]!.path).toBe('Topic › Robotics');
    const block = taxonomyBlock(nodes);
    expect(block).toContain('# at most one value of family Method');
    expect(block).not.toContain('Keywords');
    expect(block).not.toContain('Misc');
    expect(parseTaxonomyBlock(block).map((n) => n.id)).toEqual(['robotics', 'planning', 'survey', 'experiment']);
    expect(suggestSystem(['tags'], 'en')).toContain('at most one value');
  });

  it('drops ids outside the block and keeps one value per one-value family', () => {
    const c = cleanSuggestion({ tagIds: ['kw1', 'loose', 'topic', 'survey', 'experiment', 'planning'] }, ['tags'], vocab);
    expect(c.tags).toEqual(['survey', 'planning']);
  });

  it('discards new tags whose parent is outside a family; keeps the ones under a family', () => {
    const c = cleanSuggestion(
      {
        newTags: [
          { label: 'Free thing', parentId: 'kw', aliases: [], reason: '' },
          { label: 'Loose thing', parentId: 'loose', aliases: [], reason: '' },
          { label: 'Root thing', parentId: null, aliases: [], reason: '' },
          { label: 'Soft robots', parentId: 'robotics', aliases: [], reason: 'none fits' },
        ],
      },
      ['tags'],
      vocab,
    );
    expect(c.newTags!.map((t) => t.label)).toEqual(['Soft robots']);
  });

  it('turns a near-new label into the existing tag, and keeps a genuinely new one as a proposal', () => {
    const resolveLabels = (labels: readonly string[]) => Object.fromEntries(labels.filter((l) => l === 'Motion plannings').map((l) => [l, 'planning']));
    const c = cleanSuggestion(
      { tagIds: ['survey'], newTags: [{ label: 'Motion plannings', parentId: 'robotics', aliases: [], reason: '' }, { label: 'Soft robots', parentId: 'robotics', aliases: [], reason: '' }] },
      ['tags'],
      vocab,
      { resolveLabels },
    );
    expect(c.tags).toEqual(['survey', 'planning']);
    expect(c.newTags!.map((t) => t.label)).toEqual(['Soft robots']);
    // The converted tag still obeys the one-value rule.
    const d = cleanSuggestion({ tagIds: ['survey'], newTags: [{ label: 'Experiments', parentId: 'method', aliases: [], reason: '' }] }, ['tags'], vocab, { resolveLabels: () => ({ Experiments: 'experiment' }) });
    expect(d.tags).toEqual(['survey']);
  });
});

