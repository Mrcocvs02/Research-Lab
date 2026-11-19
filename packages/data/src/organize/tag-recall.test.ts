import { describe, expect, it } from 'vitest';
import { reviewTags, type ReviewInput } from './tag-review.js';
import { idOf, node } from './tag-test-corpus.js';

/**
 * Recall and precision on a synthetic vocabulary shaped like a real, hand-grown one (D-508): acronym <-> expansion in several
 * writings, plural / hyphen / underscore variants, word order, stop words, one-letter slips, author names used as tags. Generic names only.
 */
const TRUTH: string[][] = [
  ['KLM', 'kappa lambda mu'],
  ['SIL', 'self-iota learning'],
  ['rst', 'rho sigma tau'],
  ['GNUs', 'gamma nu units'],
  ['Omega xi pi (OXP)', 'oxp'],
  ['ZAM', 'Zeta of the alpha method'],
  ['pre-trained model', 'pretrained models'],
  ['multi_agent systems', 'multi-agent system'],
  ['k-means', 'kmeans'],
  ['transfer learning', 'learning transfer'],
  ['graph theory', 'theory of graphs'],
  ['analysis of variance', 'variance analysis'],
  ['learning and memory', 'learning & memory'],
  ['modelling', 'modeling'],
  ['reinforcment learning', 'reinforcement learning'],
  ['Neural_nets', 'neural net'],
  ['decision-making', 'decision making'],
  ['data_set', 'datasets'],
  ['sparse coding', 'coding sparse'],
  ['Q learning', 'q-learning'],
];
const DIFFERENT = ['model a', 'model b', 'alpha 1', 'alpha 2', 'graph', 'theory', 'zeta', 'alpha', 'attention', 'intention', 'learning', 'memory', 'machine learning', 'learning machine unit', 'Beta unit', 'Gamma unit', 'FGH', 'delta eta theta', 'delta eta kappa', 'RSV', 'rho sigma phi omega'];
const AUTHOR_TAGS = ['doe_j', 'roe_k', 'Poe A', 'm doe'];

const ids = new Map<string, string>();
function vocab(): ReviewInput {
  const taken = new Set<string>();
  const nodes = [...TRUTH.flat(), ...DIFFERENT, ...AUTHOR_TAGS].map((l) => {
    let id = idOf(l);
    for (let i = 2; taken.has(id); i++) id = `${idOf(l)}-${i}`;
    taken.add(id);
    ids.set(l, id);
    return node(l, { id });
  });
  const docs = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, tags: [] as string[], authors: [] as string[] }));
  nodes.forEach((n, i) => {
    docs[i % 20]?.tags.push(n.id);
    docs[(i * 7 + 3) % 20]?.tags.push(n.id);
  });
  // The lower-case sigla and its expansion are used together on one paper (the old keyword lists do that).
  docs[5]?.tags.push(ids.get('rst') as string, ids.get('rho sigma tau') as string);
  // Author tags sit on papers written by those authors; "m doe" is a topic written like an author on papers by someone else.
  for (const [tag, author] of [['doe_j', 'Doe, Jane Q.'], ['roe_k', 'Kim Roe'], ['Poe A', 'Poe, A.']] as const) {
    for (const d of docs) if (d.tags.includes(ids.get(tag) as string)) d.authors.push(author);
  }
  return { nodes, docs };
}
const input = vocab();
const idOfLabel = (l: string): string => ids.get(l) as string;
const groupOf = new Map<string, number>();
TRUTH.forEach((g, i) => g.forEach((l) => groupOf.set(idOfLabel(l), i)));

describe('recall and precision of the duplicate detector on a real-shaped vocabulary', () => {
  const r = reviewTags(input);
  const merges = r.proposals.filter((p) => p.kind === 'merge');
  const strong = merges.filter((p) => p.confidence !== 'maybe');
  it('at least 90 % of the double concepts are in one proposal of confidence likely or sure', () => {
    const found = TRUTH.filter((g) => strong.some((p) => g.every((l) => p.tags.includes(idOfLabel(l)))));
    expect(TRUTH.filter((g) => !found.includes(g))).toEqual([]);
    expect(found.length / TRUTH.length).toBeGreaterThanOrEqual(0.9);
  });
  it('the sure proposals are at least 95 % right and never join different things', () => {
    const sure = merges.filter((p) => p.confidence === 'sure');
    const good = sure.filter((p) => groupOf.has(p.tags[0] as string) && new Set(p.tags.map((t) => groupOf.get(t))).size === 1);
    expect(sure.filter((p) => !good.includes(p)).map((p) => p.tags)).toEqual([]);
    expect(good.length / sure.length).toBeGreaterThanOrEqual(0.95);
    for (const p of strong) for (const d of DIFFERENT) expect(p.tags).not.toContain(idOfLabel(d));
  });
  it('word-order and stop-word variants are likely, never sure', () => {
    const order = merges.find((p) => p.tags.includes(idOfLabel('transfer learning')));
    expect(order?.confidence).toBe('likely');
  });
});

describe('author names used as tags are metadata (W15)', () => {
  const meta = reviewTags(input).proposals.filter((p) => p.kind === 'metadata');
  it('"surname_initial" and "initial surname" tags that match the authors of their papers', () => {
    expect(meta.map((p) => p.tags[0]).sort()).toEqual(['doe-j', 'poe-a', 'roe-k']);
    expect(meta.every((p) => p.meta?.field === 'author' && p.reason === 'author')).toBe(true);
  });
  it('a lookalike on papers by other authors is left alone', () => {
    expect(meta.some((p) => p.tags[0] === idOfLabel('m doe'))).toBe(false);
  });
  it('nothing without authors', () => {
    const none = reviewTags({ ...input, docs: input.docs.map((d) => ({ id: d.id, tags: d.tags })) });
    expect(none.proposals.some((p) => p.kind === 'metadata')).toBe(false);
  });
});
