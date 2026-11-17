import { describe, expect, it } from 'vitest';
import { authorKey, createExploreIndex, type ExploreDoc, type ExploreTaxonomy } from './explore.js';

/**
 * Taxonomy (a DAG): science > physics > optics > lenses; science > biology; arts (own root). `lenses` also hangs under `biology`.
 * Documents d0..d11 with authors in two co-author groups and a loner, venues in two areas.
 */
const tax: ExploreTaxonomy = {
  nodes: [
    { id: 'science', label: 'Science', parents: [] },
    { id: 'physics', label: 'Physics', parents: ['science'] },
    { id: 'optics', label: 'Optics', parents: ['physics'] },
    { id: 'lenses', label: 'Lenses', parents: ['optics', 'biology'] },
    { id: 'biology', label: 'Biology', parents: ['science'] },
    { id: 'arts', label: 'Arts', parents: [] },
    { id: 'old', label: 'Old', parents: ['science'], status: 'deprecated' },
  ],
  venues: [{ id: 'jopt', name: 'Journal of Optics Research' }],
};

const doc = (n: number, over: Partial<ExploreDoc>): ExploreDoc => ({ id: `d${n}`, title: `Title ${n}`, year: 2000 + n, authors: [], tags: [], ...over });
const docs: ExploreDoc[] = [
  doc(0, { tags: ['lenses'], authors: ['Zeno, Alpha', 'Beta Marrow'], venueId: 'jopt' }),
  doc(1, { tags: ['optics'], authors: ['Alpha Zeno', 'Beta Marrow'], venueId: 'jopt' }),
  doc(2, { tags: ['optics', 'physics'], authors: ['A. Zeno'], venue: 'Optics Letters' }),
  doc(3, { tags: ['physics'], authors: ['Beta Marrow', 'Gamma Quill'], venue: 'optics  LETTERS' }),
  doc(4, { tags: ['biology'], authors: ['Delta Wren', 'Eps Vale'], venue: 'Cell Notes' }),
  doc(5, { tags: ['biology', 'lenses'], authors: ['Delta Wren', 'Eps Vale'], venue: 'Cell Notes' }),
  doc(6, { tags: ['biology'], authors: ['Delta Wren'], venue: 'Life Letters' }),
  doc(7, { tags: ['arts'], authors: ['Solo Writer'], venue: 'Gallery Review' }),
  doc(8, { tags: ['old'], authors: [] }),
  doc(9, { tags: [], authors: [] }),
];

const idx = () => createExploreIndex(docs, tax);

describe('topics follow the taxonomy', () => {
  it('lists the roots first with counts that include descendants, and zooms down to a document', () => {
    const ex = idx();
    const top = ex.level('topic', null)!;
    expect(top.path).toEqual([]);
    expect(top.nodes.map((n) => [n.id, n.count, n.hasChildren])).toEqual([
      ['science', 7, true],
      ['arts', 1, false],
    ]);
    // Four zooms at most from the macro-topic to a single paper: science > physics > optics > lenses > documents.
    const physics = ex.level('topic', 'science')!;
    expect(physics.nodes.map((n) => n.id).sort()).toEqual(['biology', 'physics']);
    expect(physics.nodes.every((n) => n.kind === 'topic')).toBe(true);
    const optics = ex.level('topic', 'physics')!;
    expect(optics.path).toEqual([{ id: 'science', label: 'Science' }, { id: 'physics', label: 'Physics' }]);
    expect(optics.nodes.map((n) => [n.id, n.count])).toEqual([['optics', 4]]);
    const lenses = ex.level('topic', 'optics')!;
    expect(lenses.nodes.map((n) => [n.id, n.count, n.hasChildren])).toEqual([['lenses', 2, false]]);
    const leaf = ex.level('topic', 'lenses')!;
    expect(leaf.nodes).toEqual([]);
    // `lenses` hangs under two parents: the path takes the shorter route from a root.
    expect(leaf.path.map((p) => p.id)).toEqual(['science', 'biology', 'lenses']);
    const papers = ex.documents('topic', 'lenses', 10, 0)!;
    expect(papers.docIds.sort()).toEqual(['d0', 'd5']);
    // Macro-topic to a single paper in at most four zooms: one per level of the path, plus the list of documents.
    expect(lenses.path.map((p) => p.id)).toEqual(['science', 'physics', 'optics']);
    expect(lenses.path.length + 1).toBeLessThanOrEqual(4);
    expect(leaf.path.length + 1).toBeLessThanOrEqual(4);
  });

  it('counts a document once under a node even through several paths, and skips deprecated nodes', () => {
    const ex = idx();
    expect(ex.documents('topic', 'science', 50, 0)!.total).toBe(7);
    expect(ex.level('topic', 'science')!.nodes.find((n) => n.id === 'old')).toBeUndefined();
    expect(ex.level('topic', 'nope')).toBeNull();
    expect(ex.documents('topic', 'nope', 5, 0)).toBeNull();
  });

  it('lists documents tagged with the node itself first, then the rest by recency, with paging', () => {
    const ex = idx();
    const all = ex.documents('topic', 'physics', 50, 0)!;
    // Tagged physics directly: d3, d2 (newest first); then the rest, below it through optics and lenses, by recency.
    expect(all.docIds).toEqual(['d3', 'd2', 'd5', 'd1', 'd0']);
    expect(ex.documents('topic', 'physics', 2, 1)!.docIds).toEqual(['d2', 'd5']);
    expect(all.total).toBe(5);
  });

  it('puts a node with a path by the shortest route from a root', () => {
    expect(idx().level('topic', 'biology')!.path.map((p) => p.id)).toEqual(['science', 'biology']);
  });
});

describe('authors: groups of co-authors, then single authors', () => {
  it('normalises names (surname first or last, initials)', () => {
    expect(authorKey('Zeno, Alpha')).toBe(authorKey('Alpha Zeno'));
    expect(authorKey('A. Zeno')).toBe(authorKey('Alpha Zeno'));
    expect(authorKey('Álpha  ZENO')).toBe(authorKey('alpha zeno'));
    expect(authorKey('  ')).toBe('');
  });

  it('groups co-authors, puts loners together, and goes group > author > documents', () => {
    const ex = idx();
    const top = ex.level('author', null)!.nodes;
    const groups = top.filter((n) => n.id !== 'group:other');
    expect(groups.every((n) => n.kind === 'author-group' && n.hasChildren)).toBe(true);
    // Alpha, Beta, Gamma form a group (d0, d1, d3 + d2 through the initial), Delta and Eps another.
    const big = groups.find((g) => ex.documents('author', g.id, 50, 0)!.docIds.includes('d0'))!;
    expect(ex.documents('author', big.id, 50, 0)!.docIds.sort()).toEqual(['d0', 'd1', 'd2', 'd3']);
    const members = ex.level('author', big.id)!;
    expect(members.nodes.every((n) => n.kind === 'author' && !n.hasChildren)).toBe(true);
    expect(members.nodes.map((n) => n.count).sort()).toEqual([1, 3, 3].sort());
    const author = members.nodes.find((n) => n.count === 3 && ex.documents('author', n.id, 5, 0)!.docIds.includes('d0'))!;
    const leaf = ex.level('author', author.id)!;
    expect(leaf.nodes).toEqual([]);
    expect(leaf.path.map((p) => p.id)).toEqual([big.id, author.id]);
    expect(top.find((n) => n.id === 'group:other')).toBeDefined();
    // Documents without authors belong to nobody.
    const everyDoc = new Set(top.flatMap((g) => ex.documents('author', g.id, 200, 0)!.docIds));
    expect(everyDoc.has('d9')).toBe(false);
    expect(ex.level('author', 'author:nobody')).toBeNull();
  });
});

describe('venues: areas, then single venues', () => {
  it('merges the spellings of a free-text venue and uses the taxonomy name when there is an id', () => {
    const ex = idx();
    const areas = ex.level('venue', null)!.nodes;
    const all = areas.flatMap((a) => ex.level('venue', a.id)!.nodes);
    expect(all.map((v) => v.label).sort()).toEqual(['Cell Notes', 'Gallery Review', 'Journal of Optics Research', 'Life Letters', 'Optics Letters'].sort());
    const letters = all.find((v) => v.label === 'Optics Letters')!;
    expect(letters.count).toBe(2);
    expect(letters.kind).toBe('venue');
    expect(ex.documents('venue', letters.id, 5, 0)!.docIds).toEqual(['d3', 'd2']);
    const area = areas.find((a) => ex.level('venue', a.id)!.nodes.some((v) => v.id === letters.id))!;
    expect(ex.level('venue', letters.id)!.path.map((p) => p.id)).toEqual([area.id, letters.id]);
  });

  it('groups venues that share topics into one area', () => {
    const ex = idx();
    const areaOf = (label: string) => {
      for (const a of ex.level('venue', null)!.nodes) if (ex.level('venue', a.id)!.nodes.some((v) => v.label === label)) return a.id;
      return undefined;
    };
    expect(areaOf('Journal of Optics Research')).toBe(areaOf('Optics Letters'));
    expect(areaOf('Cell Notes')).toBe(areaOf('Life Letters'));
    expect(areaOf('Cell Notes')).not.toBe(areaOf('Optics Letters'));
  });
});

describe('related: switching dimension keeps the starting point', () => {
  it('author -> topics, topic -> venues, venue -> authors, with scores and paths', () => {
    const ex = idx();
    const alpha = ex.level('author', ex.level('author', null)!.nodes.find((g) => ex.documents('author', g.id, 9, 0)!.docIds.includes('d0'))!.id)!.nodes.find((n) => ex.documents('author', n.id, 9, 0)!.docIds.includes('d2'))!;
    const topics = ex.related({ dimension: 'author', id: alpha.id }, 'topic', 10)!;
    expect(topics.length).toBeGreaterThan(0);
    // The author's papers are d0, d1, d2: the most specific topic that holds them all comes first.
    expect(topics[0]!.id).toBe('optics');
    expect(topics[0]!.path.map((p) => p.id)).toEqual(['science', 'physics', 'optics']);
    expect(topics.every((t) => t.score > 0 && t.score <= 1)).toBe(true);
    expect(topics.map((t) => t.score)).toEqual([...topics.map((t) => t.score)].sort((a, b) => b - a));

    const venues = ex.related({ dimension: 'topic', id: 'optics' }, 'venue', 5)!;
    expect(venues[0]!.label).toBe('Journal of Optics Research');
    expect(venues.map((v) => v.label)).toContain('Optics Letters');
    expect(venues[0]!.kind).toBe('venue');
    const authors = ex.related({ dimension: 'venue', id: venues[0]!.id }, 'author', 5)!;
    expect(authors.every((a) => a.kind === 'author')).toBe(true);
    expect(authors.length).toBeGreaterThan(0);
    // The same dimension gives siblings, never the node itself.
    const sibs = ex.related({ dimension: 'topic', id: 'optics' }, 'topic', 10)!;
    expect(sibs.some((n) => n.id === 'optics')).toBe(false);
    expect(sibs.map((n) => n.id)).toContain('physics');
    expect(ex.related({ dimension: 'topic', id: 'nope' }, 'venue', 5)).toBeNull();
    expect(ex.related({ dimension: 'topic', id: 'optics' }, 'venue', 1)).toHaveLength(1);
  });
});

describe('scale', () => {
  it('handles a large taxonomy and thousands of documents quickly, and caps a level at 500 nodes', () => {
    const nodes = Array.from({ length: 1200 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, parents: [] as string[] }));
    const many: ExploreDoc[] = Array.from({ length: 3000 }, (_, i) => ({ id: `x${i}`, title: `T${i}`, year: 2000 + (i % 25), authors: [`Au${i % 700} Tor`, `Au${(i * 7) % 700} Tor`], venue: `V${i % 300}`, tags: [`n${i % 1200}`] }));
    const t = performance.now();
    const ex = createExploreIndex(many, { nodes, venues: [] });
    expect(ex.level('topic', null)!.nodes).toHaveLength(500);
    expect(ex.level('author', null)!.nodes.length).toBeGreaterThan(0);
    expect(ex.level('venue', null)!.nodes.length).toBeGreaterThan(0);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
