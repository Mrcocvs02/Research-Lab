import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACK_MAX_DEPTH, normalizePackTerm, validatePackIntegrity, vocabPackSchema, type VocabPack } from './pack-schema.js';

const packsDir = new URL('./packs/', import.meta.url);
const files = readdirSync(packsDir).filter((f) => f.endsWith('.json'));

const mini = (): VocabPack => ({
  version: 1,
  id: 'mini',
  label: 'Mini',
  language: 'en',
  families: [
    {
      id: 'topic',
      label: 'Topic',
      singleValue: false,
      concepts: [
        { id: 'topic.a', label: 'A', aliases: ['aa'] },
        { id: 'topic.b', label: 'B', aliases: [], parent: 'topic.a' },
      ],
    },
  ],
});

describe('vocab pack validator', () => {
  it('accepts a valid pack and flags duplicates, bad parents, depth and shared aliases', () => {
    expect(validatePackIntegrity(mini())).toEqual([]);
    const dup = mini();
    dup.families[0]!.concepts[1]!.id = 'topic.a';
    expect(validatePackIntegrity(dup).join()).toContain('duplicate id');
    const orphan = mini();
    orphan.families[0]!.concepts[1]!.parent = 'topic.zz';
    expect(validatePackIntegrity(orphan).join()).toContain('does not exist');
    const shared = mini();
    shared.families[0]!.concepts[1]!.aliases = ['AA'];
    expect(validatePackIntegrity(shared).join()).toContain('shared by');
    const deep = mini();
    deep.families[0]!.concepts.push(
      { id: 'topic.c', label: 'C', aliases: [], parent: 'topic.b' },
      { id: 'topic.d', label: 'D', aliases: [], parent: 'topic.c' },
    );
    expect(validatePackIntegrity(deep).join()).toContain('depth 4');
  });
});

describe.each(files)('pack %s', (file) => {
  const pack = vocabPackSchema.parse(JSON.parse(readFileSync(new URL(file, packsDir), 'utf8')));
  it('has unique ids, existing parents, depth <= max and no shared label or alias', () => {
    expect(validatePackIntegrity(pack)).toEqual([]);
  });
  it('declares the expected families and flags single-value ones', () => {
    const byId = new Map(pack.families.map((f) => [f.id, f]));
    expect([...byId.keys()].sort()).toEqual(['method', 'paperType', 'system', 'topic']);
    expect(byId.get('topic')!.singleValue).toBe(false);
    expect(byId.get('system')!.singleValue).toBe(false);
    expect(byId.get('method')!.singleValue).toBe(true);
    expect(byId.get('paperType')!.singleValue).toBe(true);
  });
  it('keeps narrower terms out of the aliases of the broader concept (D-560): they have their own concept, under it', () => {
    const byTerm = new Map<string, string>();
    const concepts = pack.families.flatMap((f) => f.concepts);
    for (const c of concepts) for (const t of [c.label, ...c.aliases]) byTerm.set(normalizePackTerm(t), c.id);
    const under = (id: string, ancestor: string): boolean => {
      for (let cur = concepts.find((c) => c.id === id); cur?.parent; cur = concepts.find((c) => c.id === cur?.parent)) if (cur.parent === ancestor) return true;
      return false;
    };
    const narrower: Array<[string, string]> = [
      ['conditional mutual information', 'topic.mutual-information'],
      ['XXZ model', 'system.heisenberg-model'],
    ];
    for (const [term, broader] of narrower) {
      const owner = byTerm.get(normalizePackTerm(term));
      expect(owner, term).toBeDefined();
      expect(owner, term).not.toBe(broader);
      expect(under(owner as string, broader), term).toBe(true);
    }
  });
  it('has an own concept for a narrower term, and no alias that is a different concept (D-562)', () => {
    const concepts = pack.families.flatMap((f) => f.concepts);
    const byLabel = new Map(concepts.map((c) => [normalizePackTerm(c.label), c]));
    const narrow = byLabel.get('restricted boltzmann machine');
    expect(narrow?.parent).toBe('topic.boltzmann-machines');
    expect(narrow?.aliases).toContain('RBM');
    expect(concepts.find((c) => c.id === 'topic.boltzmann-machines')?.aliases).toEqual([]);
    expect(concepts.find((c) => c.id === 'paperType.numerical-study')?.aliases).not.toContain('computational study');
  });
  it('covers the common general terms as variants of a standard concept, never as person, journal or metadata words (D-563)', () => {
    const concepts = pack.families.flatMap((f) => f.concepts);
    const owner = new Map<string, string>();
    for (const c of concepts) for (const t of [c.label, ...c.aliases]) owner.set(normalizePackTerm(t), c.id);
    const expected: Array<[string, string]> = [
      ['many-body', 'topic.quantum-many-body-physics'],
      ['quantum many-body', 'topic.quantum-many-body-physics'],
      ['strongly correlated', 'topic.strongly-correlated-systems'],
      ['unsupervised machine learning', 'method.unsupervised-learning'],
      ['unsupervised ML', 'method.unsupervised-learning'],
      ['quench', 'topic.quantum-quenches'],
      ['thermalization', 'topic.thermalization'],
      ['ergodicity', 'topic.ergodicity-and-its-breaking'],
      ['ergodic', 'topic.ergodicity-and-its-breaking'],
      ['non-ergodicity', 'topic.ergodicity-and-its-breaking'],
      ['ergodicity breaking', 'topic.ergodicity-and-its-breaking'],
      ['intrinsic dimension', 'method.intrinsic-dimension-estimation'],
      ['intrinsic dimensionality', 'method.intrinsic-dimension-estimation'],
      ['intrinsic dimension estimation', 'method.intrinsic-dimension-estimation'],
      ['algorithmic complexity', 'topic.kolmogorov-complexity'],
      ['algorithmic information', 'topic.algorithmic-information-theory'],
      ['Lempel-Ziv complexity', 'topic.lempel-ziv-complexity'],
      ['multifractality', 'topic.multifractality'],
      ['nonstabilizerness', 'topic.nonstabilizerness'],
      ['non-stabilizerness', 'topic.nonstabilizerness'],
      ['magic', 'topic.nonstabilizerness'],
      ['scale-free networks', 'topic.scale-free-networks'],
      ['information-theoretic methods', 'topic.information-theory'],
      ['measurement snapshots', 'method.measurement-snapshots'],
      ['projective measurements snapshots', 'method.measurement-snapshots'],
    ];
    for (const [term, id] of expected) expect(owner.get(normalizePackTerm(term)), term).toBe(id);
    const metadata = /\b(preprint|arxiv|published|journal)\b/i;
    for (const c of concepts) for (const t of [c.label, ...c.aliases]) expect(metadata.test(t), t).toBe(false);
  });
  it('has the two fixed macro-areas of D-566 at the top of Topic, with true aliases, and the non-research tags go under the second (D-567)', () => {
    const topic = pack.families.find((f) => f.id === 'topic')!.concepts;
    const children = (id: string) => topic.filter((c) => c.parent === id).map((c) => c.label);
    const math = topic.find((c) => c.id === 'topic.mathematics')!;
    expect(math).toMatchObject({ label: 'Mathematics', labelIt: 'Matematica' });
    expect(math.parent).toBeUndefined();
    expect(children(math.id)).toEqual(expect.arrayContaining(['Differential geometry', 'Topology and algebraic topology', 'Algebra and group theory', 'Analysis and functional analysis', 'Probability and statistics', 'Combinatorics and graph theory', 'Numerical analysis']));
    expect(topic.find((c) => c.id === 'topic.fiber-bundles-and-gauge-theory')?.parent).toBe('topic.differential-geometry');
    expect(topic.find((c) => c.id === 'topic.differential-geometry')?.arxiv).toEqual(['math.DG']);
    const society = topic.find((c) => c.id === 'topic.science-society-and-research-practice')!;
    expect(society).toMatchObject({ label: 'Science, society and research practice', labelIt: 'Scienza, società e pratica della ricerca', arxiv: ['physics.soc-ph', 'physics.ed-ph', 'physics.hist-ph'] });
    expect(society.parent).toBeUndefined();
    expect(children(society.id)).toEqual(['Science communication', 'Research ethics and dual use', 'Reproducibility and research integrity', 'Research policy and administration', 'History and philosophy of physics', 'Physics education']);
    // "administrative" and "bureaucracy" are different things: two children of the policy concept, never one concept (D-571).
    const owner = (term: string) => topic.find((c) => [c.label, ...c.aliases].some((t) => normalizePackTerm(t) === normalizePackTerm(term)));
    expect(owner('administrative')).toMatchObject({ id: 'topic.research-administration', parent: 'topic.research-policy-and-administration' });
    expect(owner('bureaucracy')).toMatchObject({ id: 'topic.bureaucracy', parent: 'topic.research-policy-and-administration' });
  });
  it('gives the parts of a combined concept their own child concepts instead of aliases (D-571)', () => {
    const concepts = pack.families.flatMap((f) => f.concepts);
    const owner = (term: string) => concepts.find((c) => [c.label, ...c.aliases].some((t) => normalizePackTerm(t) === normalizePackTerm(term)));
    const parts: Array<[string, string, string]> = [
      ['machine learning', 'topic.machine-learning', 'topic.machine-learning-and-ai'],
      ['ML', 'topic.machine-learning', 'topic.machine-learning-and-ai'],
      ['artificial intelligence', 'topic.artificial-intelligence', 'topic.machine-learning-and-ai'],
      ['AI', 'topic.artificial-intelligence', 'topic.machine-learning-and-ai'],
      ['quantum information', 'topic.quantum-information', 'topic.quantum-information-and-computation'],
      ['quantum computing', 'topic.quantum-computing', 'topic.quantum-information-and-computation'],
      ['quantum computation', 'topic.quantum-computing', 'topic.quantum-information-and-computation'],
      ['quantum simulation', 'topic.quantum-simulation', 'topic.quantum-simulation-and-quantum-hardware'],
      ['phase transitions', 'topic.phase-transitions', 'topic.phase-transitions-and-critical-phenomena'],
      ['critical phenomena', 'topic.critical-phenomena', 'topic.phase-transitions-and-critical-phenomena'],
    ];
    for (const [term, id, parent] of parts) {
      expect(owner(term)?.id, term).toBe(id);
      expect(owner(term)?.parent, term).toBe(parent);
    }
    // The combined concept keeps none of its parts as an alias.
    const combined = concepts.find((c) => c.id === 'topic.machine-learning-and-ai')!;
    expect(combined.aliases).toEqual([]);
  });
  it('keeps the topic hierarchy within bounds', () => {
    const topic = pack.families.find((f) => f.id === 'topic')!;
    const roots = topic.concepts.filter((c) => !c.parent);
    expect(roots.length).toBeGreaterThanOrEqual(8);
    expect(roots.length).toBeLessThanOrEqual(14);
    expect(topic.concepts.length).toBeGreaterThanOrEqual(150);
    expect(topic.concepts.length).toBeLessThanOrEqual(300);
    expect(PACK_MAX_DEPTH).toBe(3);
  });
});
