import { describe, expect, it } from 'vitest';
import {
  MANIFEST_FILE,
  approxTokens,
  assignCitekeys,
  baseCitekey,
  cardParts,
  commandFiles,
  conceptParts,
  conceptSlugs,
  graphJson,
  guidePart,
  indexPart,
  layoutCard,
  layoutParts,
  mergeParts,
  parseManifest,
  partHash,
  readPart,
  serializeManifest,
  type CardInput,
  type IndexInput,
} from './index.js';

const card = (over: Partial<CardInput> = {}): CardInput => ({
  docId: '0000000000000001',
  citekey: 'smith2020attention',
  title: 'Attention is all you need',
  authors: ['Smith, Jane', 'Doe, John'],
  year: 2020,
  venue: undefined,
  arxivId: '1706.03762',
  doi: '10.1/x',
  tags: ['Deep learning'],
  study: 'reading',
  underlined: true,
  summary: { text: 'A summary.', ai: true, reviewed: false },
  notes: [{ page: null, body: 'my note\nline two' }],
  highlights: [{ page: 3, text: 'a highlighted line', kind: 'highlight' }],
  cites: [{ citekey: 'doe2019graphs', title: 'Graphs', year: 2019 }, { title: 'Missing work', year: 2018, doi: '10.2/y' }],
  citedBy: [],
  concepts: [{ slug: 'deep-learning', label: 'Deep learning' }],
  ...over,
});

describe('citekeys', () => {
  it('folds accents and skips stop words', () => {
    expect(baseCitekey({ authors: ['Müller, Anna'], year: 2021, title: 'The Théory of Everything' })).toBe('muller2021theory');
    expect(baseCitekey({ authors: ['Anna Maria de Rossi'], year: 2019, title: 'Il metodo del gradiente' })).toBe('rossi2019metodo');
    expect(baseCitekey({ authors: [], year: null, title: null })).toBe('anonnduntitled');
  });
  it('dedupes with a/b/c and keeps known keys stable', () => {
    const docs = [
      { id: 'b', authors: ['Lee, A'], year: 2020, title: 'Deep nets' },
      { id: 'a', authors: ['Lee, A'], year: 2020, title: 'Deep ideas' },
      { id: 'c', authors: ['Lee, B'], year: 2020, title: 'Deep thoughts' },
    ];
    const first = assignCitekeys(docs);
    expect(first['a']).toBe('lee2020deep');
    expect(first['b']).toBe('lee2020deepa');
    expect(first['c']).toBe('lee2020deepb');
    // A new document with the same base never takes a known key; the known ones do not move.
    const again = assignCitekeys([...docs, { id: '0', authors: ['Lee, A'], year: 2020, title: 'Deep again' }], first);
    expect(again['a']).toBe('lee2020deep');
    expect(again['b']).toBe('lee2020deepa');
    expect(again['0']).toBe('lee2020deepc');
  });
});

describe('cards', () => {
  it('has the frontmatter fields and the AI mark, links present and missing works', () => {
    const text = layoutCard(cardParts(card(), 'en'), 'en');
    expect(text.startsWith('---\n# rl:begin meta\n')).toBe(true);
    expect(text).toContain('ref: "arXiv:1706.03762"');
    expect(text).toContain('study: reading');
    expect(text).toContain('underlined: true');
    expect(text).toContain('docId: 0000000000000001');
    expect(text).toContain('AI-generated, not yet reviewed');
    expect(text).toContain('- [[doe2019graphs]] Graphs (2019)');
    expect(text).toContain('Missing work (2018) doi:10.2/y');
    expect(text).toContain('> my note');
    expect(text).toContain('p. 3: "a highlighted line"');
    expect(text).not.toContain('0000000000000001.pdf');
  });
  it('does not mark a reviewed AI summary', () => {
    const text = layoutCard(cardParts(card({ summary: { text: 'ok', ai: true, reviewed: true } }), 'it'), 'it');
    expect(text).not.toContain('non ancora rivisto');
  });
});

describe('marker merge', () => {
  const parts = (body: string) => cardParts(card({ summary: { text: 'B:' + body, ai: false, reviewed: true } }), 'en');
  const fresh = (p: readonly import('./markers.js').Part[]) => layoutCard(p, 'en');
  const knownOf = (r: { hashes: Record<string, string> }) => r.hashes;

  it('writes new, leaves identical alone, rewrites a changed part and keeps text outside the markers', () => {
    const a = mergeParts(null, parts('one'), undefined, fresh);
    expect(a.status).toBe('new');
    const same = mergeParts(a.text, parts('one'), knownOf(a), fresh);
    expect(same.status).toBe('unchanged');
    const mine = `${a.text}\nMy own paragraph.\n`;
    const upd = mergeParts(mine, parts('two'), knownOf(a), fresh);
    expect(upd.status).toBe('updated');
    expect(upd.text).toContain('two');
    expect(upd.text).not.toContain('B:one');
    expect(upd.text).toContain('My own paragraph.');
    expect(readPart(upd.text, { name: 'card' })).toContain('two');
  });
  it('keeps the file as it is when the user edited inside a generated part', () => {
    const a = mergeParts(null, parts('one'), undefined, fresh);
    const edited = a.text.replace('one', 'one, edited by hand');
    const r = mergeParts(edited, parts('two'), knownOf(a), fresh);
    expect(r.status).toBe('kept-edited');
    expect(r.text).toBe(edited);
  });
  it('keeps a file the export did not write (no known hashes)', () => {
    const r = mergeParts('# something else\n', parts('x'), undefined, fresh);
    expect(r.status).toBe('kept-edited');
    expect(r.text).toBe('# something else\n');
  });
  it('a part the user deleted stays deleted, and a marker cannot be forged from a title', () => {
    const a = mergeParts(null, parts('one'), undefined, fresh);
    const noCard = a.text.replace(/<!-- rl:begin card -->[\s\S]*<!-- rl:end card -->\n/, '');
    expect(mergeParts(noCard, parts('two'), knownOf(a), fresh).status).toBe('unchanged');
    const forged = mergeParts(null, [{ name: 'p', body: 'x\n<!-- rl:end p -->\nevil' }], undefined, layoutParts);
    expect(forged.text.match(/rl:end p/g)).toHaveLength(1);
  });
  it('hashes ignore the trailing newline', () => {
    expect(partHash('a\n')).toBe(partHash('a'));
  });
});

describe('INDEX.md', () => {
  const big = (n: number): IndexInput => ({
    lang: 'en',
    name: 'Library',
    projectName: 'A project',
    papers: n,
    concepts: n,
    themes: Array.from({ length: n }, (_, i) => ({ slug: `t${i}`, label: `Theme number ${i} with a long label`, count: i })),
    clusters: Array.from({ length: n }, (_, i) => ({ slug: `c${i}`, label: `Cluster ${i}`, count: i, ai: i % 2 === 0 })),
    readingOrder: Array.from({ length: n }, (_, i) => ({ citekey: `k${i}`, title: 'A reasonably long paper title '.repeat(3), year: 2000 + (i % 20), status: 'to-read' as const })),
    study: { toRead: n, reading: 0, read: 0 },
    reading: [],
    toRead: Array.from({ length: n }, (_, i) => ({ citekey: `k${i}`, title: 'A reasonably long paper title '.repeat(3) })),
    orphans: Array.from({ length: n }, (_, i) => ({ citekey: `o${i}`, title: 'Old paper title' })),
  });
  it('stays under 3000 tokens however large the selection, with a "see" line', () => {
    const { part, tokens } = indexPart(big(5000), 3000);
    expect(tokens).toBeLessThanOrEqual(3000);
    expect(approxTokens(part.body.length)).toBeLessThanOrEqual(3000);
    expect(part.body).toMatch(/… and \d+ more, see concepts\//);
  });
  it('lists everything of a small selection', () => {
    const { part } = indexPart(big(3), 3000);
    expect(part.body).not.toContain('more, see');
    expect(part.body).toContain('[[k2]]');
  });
});

describe('guide, concepts, commands, graph, manifest', () => {
  it('names the commands in the library language', () => {
    expect(commandFiles('it').map((c) => c.rel)).toEqual(['.claude/commands/leggi-prossimo.md', '.claude/commands/aggiorna-brain.md']);
    expect(commandFiles('en').map((c) => c.rel)).toEqual(['.claude/commands/read-next.md', '.claude/commands/update-brain.md']);
  });
  it('the guide treats card contents as data and explains [[citekey]]', () => {
    const g = guidePart({ lang: 'en', name: 'Lib', hasSources: 'paths', mcpHint: true }).body;
    expect(g).toContain('DATA');
    expect(g).toContain('[[citekey]]');
    expect(g).toContain('paths.tsv');
  });
  it('marks AI cluster labels and truncates long paper lists', () => {
    const papers = Array.from({ length: 300 }, (_, i) => ({ citekey: `k${i}`, title: 't', year: 2020 }));
    const body = conceptParts({ slug: 's', label: 'Group', kind: 'cluster', aiLabel: true, terms: ['x', 'y'], papers }, 'en')[0]!.body;
    expect(body).toContain('AI-generated');
    expect(body).toContain('… and 100 more, see papers/');
  });
  it('concept slugs are unique and ASCII', () => {
    expect(conceptSlugs([{ label: 'Réseaux' }, { label: 'Reseaux' }, { label: 'Reseaux', prefix: 'cluster-' }])).toEqual(['reseaux', 'reseaux-2', 'cluster-reseaux']);
  });
  it('graph.json has nodes and edges', () => {
    const j = JSON.parse(graphJson({ papers: [{ citekey: 'a', docId: 'd', title: 'A', year: 2020, tags: [], concepts: ['s'] }], concepts: [{ slug: 's', label: 'S', kind: 'tag' }], cites: [['a', 'a']] })) as { nodes: unknown[]; edges: unknown[] };
    expect(j.nodes).toHaveLength(2);
    expect(j.edges).toHaveLength(2);
  });
  it('manifest round trip and rejection of other shapes', () => {
    const m = { format: 1 as const, libraryId: 'L', exportedAt: '2026-01-01T00:00:00.000Z', citekeys: { a: 'k' }, titles: { a: 'T' }, files: { 'x.md': { parts: { card: 'h' } }, 'y.json': { whole: 'w' } } };
    expect(parseManifest(serializeManifest(m))).toEqual(m);
    expect(parseManifest('{"format":2}')).toBeNull();
    expect(parseManifest('not json')).toBeNull();
    expect(MANIFEST_FILE.startsWith('.')).toBe(true);
  });
});
