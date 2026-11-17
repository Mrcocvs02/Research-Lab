import { describe, expect, it } from 'vitest';
import { analyze, buildModel, citationKey, citationSignals, countTerms, createPlacer, decodeModel, neighborsOf, reasonsOf, similarTo, surprisingPairs, tokenize } from './index.js';
import { buildVectors } from './tfidf.js';
import { syntheticDocs, topicWord } from './synthetic.js';
import type { GraphDoc } from './types.js';

const build = (docs: GraphDoc[], seed = 7) => buildModel(docs, { seed, now: () => new Date('2026-01-01T00:00:00.000Z') });

describe('text and vectors', () => {
  it('drops Italian and English stop words, short words and numbers', () => {
    expect(tokenize('The quick analysis of 2024 and il modello della rete è un 12 ab')).toEqual(['quick', 'analysis', 'modello', 'rete']);
  });

  it('builds capped, normalised sparse vectors: singletons and ubiquitous words are left out', () => {
    const docs = syntheticDocs(40, { topics: 4 });
    docs[0]!.title += ' singletonword';
    const { vocab, vectors } = buildVectors(docs.map((d) => countTerms(d)));
    expect(vocab.index.has('singletonword')).toBe(false);
    expect(vocab.index.has('method')).toBe(false); // in more than 40% of a corpus of 40
    for (const v of vectors) {
      expect(v.i.length).toBeLessThanOrEqual(64);
      const norm = Math.sqrt([...v.w].reduce((s, w) => s + w * w, 0));
      expect(norm).toBeGreaterThan(0.95);
      expect(norm).toBeLessThan(1.05);
      expect([...v.i]).toEqual([...v.i].sort((a, b) => a - b));
    }
  });

  it('weights the title above the body', () => {
    const base = { sig: '1', folder: '', abstract: '', keywords: [], tags: [], refs: [], cites: [] };
    const counts = countTerms({ ...base, title: 'alpha', text: 'beta' });
    expect(counts.get('alpha')).toBeGreaterThan(counts.get('beta') as number);
  });
});

describe('similarity and its reasons', () => {
  it('ranks same-topic documents first and says why: text, tags, citations', async () => {
    const docs = syntheticDocs(30, { topics: 3 });
    // Two documents of different topics that cite the same works and one another.
    docs[0]!.refs = ['r:doi:x1', 'r:doi:x2'];
    docs[1]!.refs = ['r:doi:x1', 'r:doi:x2'];
    docs[0]!.cites = [docs[1]!.id];
    const a = await analyze(docs);
    const top = similarTo(a, 0, 40);
    // Every same-topic document comes before any other topic's document.
    const firstOther = top.findIndex((n) => docs[n.j]!.topic !== 0 && n.citShared === 0 && !n.direct);
    const lastSame = top.map((n) => docs[n.j]!.topic).lastIndexOf(0);
    expect(firstOther === -1 || lastSame < firstOther).toBe(true);
    const same = top.find((n) => docs[n.j]!.topic === 0)!;
    expect(same.reasons).toEqual(expect.arrayContaining(['text', 'tags']));
    expect(same.terms.length).toBeGreaterThan(0);
    const cited = top.find((n) => n.j === 1)!;
    expect(cited.reasons).toContain('citations');
    expect(cited.reasons).not.toContain('tags');
    expect(cited.citShared).toBe(2);
    expect(cited.direct).toBe(true);
    expect(cited.score).toBeGreaterThan(0.1);
    expect(top.every((n) => n.score >= 0 && n.score <= 1)).toBe(true);
    expect(reasonsOf({ text: 0, citShared: 0, direct: false, tagShared: 0 })).toEqual([]);
  });

  it('reads citation files as shared-work keys and direct links', () => {
    const link = (extra: object) => ({ authors: [], matchedDocId: null, source: 'manual' as const, checkedAt: '2026-01-01T00:00:00.000Z', ...extra });
    const sig = citationSignals({
      schemaVersion: 1,
      docId: 'abcdef0123456789',
      references: [link({ doi: 'HTTPS://doi.org/10.1/ABC' }), link({ arxivId: '2101.00001v2', matchedDocId: '0123456789abcdef' }), link({ title: 'short' })],
      citedBy: [link({ externalId: 'W9' })],
    } as never);
    expect(sig.refs).toEqual(['r:doi:10.1/abc', 'r:arxiv:2101.00001', 'c:id:w9']);
    expect(sig.cites).toEqual(['0123456789abcdef']);
    expect(citationKey({ title: 'A sufficiently long and descriptive title', year: 2020 })).toMatch(/^t:/);
  });
});

describe('model: clusters, layout, determinism', () => {
  it('recovers the topics as top-level clusters and names them by their words', async () => {
    const docs = syntheticDocs(60, { topics: 4 });
    const m = await build(docs);
    const top = m.clusters.filter((c) => c.level === 0);
    expect(top.length).toBeGreaterThanOrEqual(4);
    // Purity: the documents of a top-level cluster come from one topic.
    let pure = 0;
    for (const c of top) {
      const idx = m.cl.flatMap((l, i) => (l[0] === m.clusters.indexOf(c) ? [i] : []));
      const counts = new Map<number, number>();
      for (const i of idx) counts.set(docs[i]!.topic, (counts.get(docs[i]!.topic) ?? 0) + 1);
      pure += Math.max(...counts.values());
    }
    expect(pure / docs.length).toBeGreaterThan(0.95);
    for (const c of top) {
      expect(c.terms.length).toBeGreaterThan(0);
      expect(c.terms.every((t) => /^zq/.test(t) || ['method', 'analysis', 'model', 'results', 'study', 'approach'].includes(t))).toBe(true);
    }
    // The terms of a cluster belong to its topic's vocabulary.
    const first = top[0]!;
    const member = m.cl.findIndex((l) => l[0] === m.clusters.indexOf(first));
    const topic = docs[member]!.topic;
    expect(first.terms.filter((t) => t.startsWith(topicWord(topic, 0).slice(0, 4)))).toHaveLength(first.terms.length);
    // Layout is inside the unit square.
    expect(m.x.concat(m.y).every((v) => v >= -1 && v <= 1)).toBe(true);
  });

  it('splits large clusters into levels (coarse to fine)', async () => {
    const m = await build(syntheticDocs(120, { topics: 2, vocabulary: 80 }));
    const maxLevel = Math.max(...m.clusters.map((c) => c.level));
    expect(maxLevel).toBeGreaterThanOrEqual(1);
    for (const l of m.cl) for (let k = 1; k < l.length; k++) expect(m.clusters[l[k]!]!.parent).toBe(l[k - 1]);
  });

  it('is deterministic: same seed, same clusters and layout; the file survives a round trip', async () => {
    const docs = syntheticDocs(80, { topics: 4, seed: 3 });
    const a = await build(docs, 11);
    const b = await build(docs, 11);
    expect(b.cl).toEqual(a.cl);
    expect(b.x).toEqual(a.x);
    expect(b.y).toEqual(a.y);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = await build(docs, 12);
    expect(c.x).not.toEqual(a.x);
    const back = decodeModel(JSON.parse(JSON.stringify(a)));
    expect(back).not.toBeNull();
    expect(neighborsOf(back!, 0)[0]).toEqual(neighborsOf(a, 0)[0]);
  });

  it('refuses a damaged or foreign model file', async () => {
    const m = await build(syntheticDocs(12, { topics: 2 }));
    const clone = () => JSON.parse(JSON.stringify(m)) as Record<string, unknown> & { nb: number[][]; x: number[] };
    expect(decodeModel(null)).toBeNull();
    expect(decodeModel({ ...clone(), version: 99 })).toBeNull();
    const shortX = clone();
    shortX.x.pop();
    expect(decodeModel(shortX)).toBeNull();
    const badNeighbor = clone();
    badNeighbor.nb[0]![0] = 9999;
    expect(decodeModel(badNeighbor)).toBeNull();
  });

  it('handles tiny and empty libraries', async () => {
    expect((await build([])).ids).toEqual([]);
    const one = await build(syntheticDocs(1));
    expect(one.x).toEqual([0]);
    expect(one.clusters).toHaveLength(1);
    const two = await build(syntheticDocs(2, { topics: 1 }));
    expect(two.ids).toHaveLength(2);
  });

  it('stops at once when cancelled', async () => {
    const ac = new AbortController();
    const phases: string[] = [];
    const run = buildModel(syntheticDocs(300), {
      seed: 1,
      signal: ac.signal,
      onProgress: (p) => {
        phases.push(p);
        if (p === 'similarity') ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(phases).not.toContain('layout');
  });
});

describe('incremental placement', () => {
  it('puts a new document next to its neighbours and changes nobody else', async () => {
    const docs = syntheticDocs(60, { topics: 4, seed: 5 });
    const m = await build(docs);
    const snapshot = JSON.stringify(m);
    const placer = createPlacer(m);
    const target = 2; // a document of topic 2
    const fresh = { ...docs[target]!, id: 'ffffffffffffffff', title: docs[target]!.title };
    const p = placer.place(fresh.id, countTerms(fresh));
    const sameTopic = docs.flatMap((d, i) => (d.topic === 2 ? [i] : []));
    const cx = sameTopic.reduce((s, i) => s + m.x[i]!, 0) / sameTopic.length;
    const cy = sameTopic.reduce((s, i) => s + m.y[i]!, 0) / sameTopic.length;
    const near = Math.hypot(p.x - cx, p.y - cy);
    // Closer to its topic's centre than to the centre of any other topic.
    for (const t of [0, 1, 3]) {
      const idx = docs.flatMap((d, i) => (d.topic === t ? [i] : []));
      const ox = idx.reduce((s, i) => s + m.x[i]!, 0) / idx.length;
      const oy = idx.reduce((s, i) => s + m.y[i]!, 0) / idx.length;
      expect(near).toBeLessThan(Math.hypot(p.x - ox, p.y - oy));
    }
    // It is in the cluster its neighbours are in, at every level they share.
    expect(p.clusters[0]).toBe(m.cl[p.from[0]!.j]![0]);
    expect(p.from.length).toBeGreaterThan(0);
    // Deterministic, and the model is untouched.
    expect(placer.place(fresh.id, countTerms(fresh))).toEqual(p);
    expect(JSON.stringify(m)).toBe(snapshot);
  });

  it('places a document without any common word away from the clusters, with no cluster', async () => {
    const m = await build(syntheticDocs(20, { topics: 2 }));
    const base = { sig: '1', folder: '', abstract: '', keywords: [], tags: [], refs: [], cites: [] };
    const p = createPlacer(m).place('eeeeeeeeeeeeeeee', countTerms({ ...base, title: 'unrelatedword', text: 'otherunknownword' }));
    expect(p.clusters).toEqual([]);
    expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(1);
  });
});

describe('surprising pairs', () => {
  it('finds close-by-text pairs that share no tag, citation or folder, and nothing else', async () => {
    const docs = syntheticDocs(40, { topics: 4, seed: 2 });
    // Same topic everywhere shares a tag and (i % 3) folders: make two documents textually close but unrelated otherwise.
    docs[0]!.tags = ['alpha'];
    docs[4]!.tags = ['beta'];
    docs[0]!.folder = 'one';
    docs[4]!.folder = 'two';
    const m = await build(docs);
    const all = surprisingPairs(m, { limit: 500 });
    const ids = (a: number, b: number) => [m.ids[a], m.ids[b]].sort().join();
    expect(all.some((p) => ids(p.a, p.b) === [docs[0]!.id, docs[4]!.id].sort().join())).toBe(true);
    for (const p of all) {
      const a = docs[p.a]!;
      const b = docs[p.b]!;
      expect(a.tags.some((t) => b.tags.includes(t))).toBe(false);
      expect(a.folder).not.toBe(b.folder);
      expect(p.text).toBeGreaterThanOrEqual(0.2);
    }
    const one = surprisingPairs(m, { doc: 0, limit: 10 });
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((p) => p.a === 0 || p.b === 0)).toBe(true);
    // A direct citation removes the pair from the list.
    docs[0]!.cites = [docs[4]!.id];
    const cited = await build(docs);
    expect(surprisingPairs(cited, { limit: 500 }).some((p) => ids(p.a, p.b) === [docs[0]!.id, docs[4]!.id].sort().join())).toBe(false);
  });
});

describe('budget', () => {
  it('builds the model of 1000 documents in a couple of seconds, with a bounded file', async () => {
    const docs = syntheticDocs(1000, { topics: 12, vocabulary: 120 });
    const t = performance.now();
    const m = await build(docs);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(4000);
    expect(JSON.stringify(m).length).toBeLessThan(3 * 1024 * 1024);
    expect(Math.max(...m.vi.map((v) => v.length))).toBeLessThanOrEqual(64);
    expect(m.vocab.length).toBeLessThanOrEqual(30_000);
  });
});
