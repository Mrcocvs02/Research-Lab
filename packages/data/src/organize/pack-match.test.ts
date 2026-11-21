import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vocabPackSchema, validatePackIntegrity } from '../../../core/src/vocab/pack-schema.js';
import { matchPack, type PackConceptIn, type PackMatchInput, type PackNodeIn } from './pack-match.js';

const pack = vocabPackSchema.parse(JSON.parse(readFileSync(new URL('../../../core/src/vocab/test-pack.json', import.meta.url), 'utf8')));
const concepts: PackConceptIn[] = pack.families.flatMap((f) => f.concepts.map((c) => ({ id: c.id, family: f.id, label: c.label, labelIt: c.labelIt, aliases: c.aliases, parent: c.parent, distinctFrom: c.distinctFrom })));
const families = pack.families.map((f) => ({ id: f.id, label: f.label, singleValue: f.singleValue }));

const node = (id: string, label: string, over: Partial<PackNodeIn> = {}): PackNodeIn => ({ id, label, aliases: [], parents: [], status: 'active', ...over });
const run = (nodes: PackNodeIn[], over: Partial<PackMatchInput> = {}) => matchPack({ packId: pack.id, nodes, docs: [], families, concepts, ...over });
const pairOf = (r: ReturnType<typeof run>, nodeId: string) => r.matches.filter((m) => m.nodeId === nodeId);

describe('the synthetic test pack', () => {
  it('is a valid pack', () => {
    expect(validatePackIntegrity(pack)).toEqual([]);
  });
});

describe('matching the tags of a library with the concepts of a pack (D-517)', () => {
  it('finds a tag by its form, its Italian label, a plural or an alias: sure', () => {
    const one = (label: string) => run([node('n', label)]).matches;
    expect(one('Alpha-theory')).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'sure' }]);
    // The Italian label of a concept is one of its names.
    expect(one('Teoria alfa')).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'sure' }]);
    expect(one('Epsilon map')).toMatchObject([{ conceptId: 'topic.epsilon-maps', confidence: 'sure' }]);
    expect(one('AT')).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'sure' }]);
  });

  it('a match through an alias with more words than the label (a narrower term) is at most probable (D-560)', () => {
    const one = (label: string) => run([node('n', label)]).matches;
    // "conditional epsilon maps" is an alias of "Epsilon maps" in the synthetic pack, as a narrower term would be: never a sure merge.
    expect(one('Conditional epsilon maps')).toMatchObject([{ conceptId: 'topic.epsilon-maps', confidence: 'likely' }]);
    // A spelling variant (as many words) stays sure.
    expect(one('Epsilon mapping')).toMatchObject([{ conceptId: 'topic.epsilon-maps', confidence: 'sure' }]);
    // The label itself, even with more words in the tag than in the label, is not an alias match.
    expect(one('Epsilon maps')).toMatchObject([{ conceptId: 'topic.epsilon-maps', confidence: 'sure' }]);
  });

  it('a sure match through an alias needs the rules of form, plural, sigla in the name or alias in collision', () => {
    const one = (label: string, aliases: string[] = []) => run([node('n', label, { aliases })]).matches;
    expect(one('Alpha theory models')).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'likely' }]);
    expect(one('Alpha theory (AT)')).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'sure' }]);
    // The same words in another order are probable even through a true alias.
    expect(one('Models of alpha-theory')).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'likely' }]);
  });

  it('a narrower term that has its own concept is matched to it, apart from its parent: the tag named like the concept is sure, the alias tag is not', () => {
    const r = run([node('p', 'Eta model'), node('c', 'Mixed eta model'), node('a', 'Eta')]);
    // "Eta" and "Eta model" are two tags of the one concept: the tag that carries the concept's label stays sure, the alias one is probable.
    expect(pairOf(r, 'p')).toMatchObject([{ conceptId: 'topic.eta-model', confidence: 'sure' }]);
    expect(pairOf(r, 'a')).toMatchObject([{ conceptId: 'topic.eta-model', confidence: 'likely' }]);
    // The narrower tag is not drawn into it.
    expect(pairOf(r, 'c')).toMatchObject([{ conceptId: 'topic.eta-mixed', confidence: 'sure' }]);
    const alone = run([node('p', 'Eta model'), node('c', 'Mixed eta chain')]);
    expect(alone.matches.map((m) => [m.nodeId, m.conceptId, m.confidence])).toEqual([
      ['c', 'topic.eta-mixed', 'sure'],
      ['p', 'topic.eta-model', 'sure'],
    ]);
    expect(alone.conflicts).toBe(0);
  });

  it('a narrower tag is not the broader concept: its own concept (acronym, plural) takes it, the alias that names the broader one does not (D-562)', () => {
    const own: PackConceptIn[] = [
      { id: 'topic.omega-machines', family: 'topic', label: 'Omega machines', aliases: [] },
      { id: 'topic.omega-restricted', family: 'topic', label: 'Restricted omega machine', aliases: ['ROM', 'Restricted omega machines'], parent: 'topic.omega-machines' },
    ];
    const r = run([node('a', 'Restricted omega machines (ROM)')], { concepts: own });
    expect(pairOf(r, 'a')).toMatchObject([{ conceptId: 'topic.omega-restricted', confidence: 'sure' }]);
    // The alias is a plural of the broader concept, with fewer meaningful words than the label: at most probable (and the tag now fits two concepts).
    const wide = run([node('b', 'Restricted omega machines (ROM)', { aliases: ['Omega machine'] })], { concepts: own.slice(0, 1) });
    expect(pairOf(wide, 'b')).toMatchObject([{ conceptId: 'topic.omega-machines', confidence: 'likely' }]);
    // An alias as long as the label, or a label that is the concept itself, is a true variant: sure.
    expect(run([node('c', 'AT', { aliases: ['Alpha theory'] })]).matches).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'sure' }]);
    expect(run([node('d', 'Alpha theory', { aliases: ['Alpha-theory'] })]).matches).toMatchObject([{ conceptId: 'topic.alpha-theory', confidence: 'sure' }]);
  });

  it('a spelling slip is probable, never sure', () => {
    const r = run([node('g', 'Delta chian')]);
    expect(pairOf(r, 'g')).toMatchObject([{ conceptId: 'topic.delta-chains', confidence: 'likely', rule: 'spelling' }]);
  });

  it('a tag whose own label reaches one concept stays sure; the concept its alias reaches is not a conflict (D-563)', () => {
    const r = run([node('x', 'Beta states', { aliases: ['Delta chain'] })]);
    expect(pairOf(r, 'x').map((m) => [m.conceptId, m.confidence])).toEqual([['topic.beta-states', 'sure']]);
    expect(r.conflicts).toBe(0);
    // Also when the alias is a sure match of another concept and the label is a plural of its own.
    expect(pairOf(run([node('y', 'Beta state', { aliases: ['Delta systems'] })]), 'y').map((m) => [m.conceptId, m.confidence])).toEqual([['topic.beta-states', 'sure']]);
  });

  it('a tag whose label sure-meets two concepts stays a "maybe" for both, and is counted as a conflict', () => {
    const r = run([node('t', 'Theta flow')]);
    expect(pairOf(r, 't').map((m) => [m.conceptId, m.confidence]).sort()).toEqual([
      ['topic.theta-flow', 'maybe'],
      ['topic.theta-flows', 'maybe'],
    ]);
    expect(r.conflicts).toBe(1);
  });

  it('a tag with no label match and two candidates stays a "maybe" for both', () => {
    const r = run([node('x', 'Unrelated name', { aliases: ['Beta state', 'Delta chain'] })]);
    expect(pairOf(r, 'x').map((m) => m.confidence)).toEqual(['maybe', 'maybe']);
    expect(r.conflicts).toBe(1);
  });

  it('a concept two different tags claim: only the tag that matches its label is sure, the other is probable', () => {
    const claimed = run([node('p', 'Zeta solver'), node('q', 'ZS')]);
    expect(claimed.matches.map((m) => [m.nodeId, m.confidence])).toEqual([
      ['p', 'sure'],
      ['q', 'likely'],
    ]);
    expect(claimed.conflicts).toBe(1);
  });

  it('a concept claimed by tags that are sure duplicates of each other keeps them all sure', () => {
    const r = run([node('p', 'Alpha theory'), node('q', 'Alpha theory (AT)'), node('s', 'Alpha-theories')]);
    expect(r.matches.map((m) => [m.nodeId, m.confidence])).toEqual([
      ['p', 'sure'],
      ['q', 'sure'],
      ['s', 'sure'],
    ]);
    expect(r.conflicts).toBe(0);
  });

  it('two different tags on a combined concept, each through an alias, are not sure: they are different concepts', () => {
    const r = run([node('l', 'Lambda methods'), node('m', 'Mu methods')]);
    expect(r.matches.map((m) => [m.nodeId, m.conceptId, m.confidence])).toEqual([
      ['l', 'topic.lambda-and-mu', 'likely'],
      ['m', 'topic.lambda-and-mu', 'likely'],
    ]);
    // Neither counts as sure.
    expect(r.matches.filter((m) => m.confidence === 'sure')).toEqual([]);
  });

  it('a match made only between an alias of the tag and an alias of the concept is probable at most (D-563)', () => {
    const chain = run([node('c', 'Rho methods', { aliases: ['sigma simulation'] })]);
    expect(pairOf(chain, 'c')).toMatchObject([{ conceptId: 'method.sigma-study', confidence: 'likely' }]);
    // The tag's label meeting an alias of the concept, or the concept's label meeting an alias of the tag, is still sure.
    expect(run([node('d', 'Sigma simulation')]).matches).toMatchObject([{ conceptId: 'method.sigma-study', confidence: 'sure' }]);
    expect(run([node('e', 'Rho methods', { aliases: ['Sigma study'] })]).matches).toMatchObject([{ conceptId: 'method.sigma-study', confidence: 'sure' }]);
  });

  it('never merges what the field tells apart: the tag is listed, not matched', () => {
    const r = run([node('s', 'Gamma spectrum')]);
    expect(r.distinct).toEqual([{ nodeId: 's', conceptId: 'topic.beta-spectrum' }]);
    expect(r.matches).toEqual([]);
  });

  it('respects the pairs the user said are not the same', () => {
    const nodes = [node('a', 'Alpha theory')];
    expect(pairOf(run(nodes), 'a')).toHaveLength(1);
    expect(pairOf(run(nodes, { rejected: [['a', 'topic.alpha-theory']] }), 'a')).toEqual([]);
  });

  it('counts what it recognises and the papers that have a topic of the field', () => {
    const r = run([node('a', 'Alpha theory'), node('m', 'Sampling methods'), node('z', 'Unrelated')], { docs: [{ id: 'd1', tags: ['a'] }, { id: 'd2', tags: ['m'] }, { id: 'd3', tags: ['z'] }] });
    expect(r).toMatchObject({ recognized: 2, tags: 3, papers: 3, papersWithTopic: 1 });
  });
});

describe('a library shaped like a real one (acceptance 20.11 A, D-563)', () => {
  const A = ['amber', 'basalt', 'cobalt', 'dune', 'fjord', 'garnet', 'harbor', 'indigo', 'jasper'];
  const B = ['lattice', 'orbit', 'phase', 'ridge', 'spiral'];
  const syn = (i: number): string => `${A[i % A.length]} ${B[Math.floor(i / A.length) % B.length]}`;
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const mk = (id: string, label: string, aliases: string[] = []): PackConceptIn => ({ id, family: 'topic', label, aliases });
  const own: PackConceptIn[] = [];
  const nodes: PackNodeIn[] = [];
  const wrong: Array<[string, string]> = [];
  // 36 plain tags named like a concept; 4 tags whose own label meets a concept and whose alias meets another one.
  for (let i = 0; i < 36; i++) {
    own.push(mk(`c${i}`, cap(syn(i)), i % 3 === 0 ? [`${syn(i)} variant`] : []));
    nodes.push(node(`n${i}`, cap(syn(i))));
  }
  for (let i = 36; i < 40; i++) {
    own.push(mk(`c${i}`, cap(syn(i)), []), mk(`x${i}`, cap(syn(i + 4)), []));
    nodes.push(node(`n${i}`, cap(syn(i)), { aliases: [cap(syn(i + 4))] }));
    wrong.push([`n${i}`, `x${i}`]);
  }
  // A concept claimed twice by sure duplicates (the name and the name with its sigla): both sure.
  own.push(mk('d', 'Quartz field', ['QF']));
  nodes.push(node('d1', 'Quartz field'), node('d2', 'Quartz field (QF)'));
  // A concept claimed by a tag that carries its label and a tag that only reaches it through an alias: the second is not sure.
  own.push(mk('e', 'Ruby solver', ['RS']));
  nodes.push(node('e1', 'Ruby solver'), node('e2', 'RS'));
  wrong.push(['e2', 'e']);
  // A combined concept claimed by two different tags through its aliases.
  own.push(mk('f', 'Topaz and onyx methods', ['topaz methods', 'onyx methods']));
  nodes.push(node('f1', 'Topaz methods'), node('f2', 'Onyx methods'));
  wrong.push(['f1', 'f'], ['f2', 'f']);
  // A tag whose label meets nothing and whose alias is an alias of a concept.
  own.push(mk('g', 'Pearl study', ['pearl simulation']));
  nodes.push(node('g1', 'Opal methods', { aliases: ['pearl simulation'] }));
  wrong.push(['g1', 'g']);
  const r = run(nodes, { concepts: own });
  const sure = new Set(r.matches.filter((m) => m.confidence === 'sure').map((m) => `${m.nodeId}/${m.conceptId}`));

  it('recognises 43 tags for sure, with no wrong pairing among them (at least 40 are expected on a real library)', () => {
    expect(sure.size).toBe(43);
    expect(sure.size).toBeGreaterThanOrEqual(40);
    expect(r.recognized).toBe(r.matches.filter((m) => m.confidence !== 'maybe').length);
    for (let i = 0; i < 40; i++) expect(sure.has(`n${i}/c${i}`), `n${i}`).toBe(true);
    for (const k of ['d1/d', 'd2/d', 'e1/e']) expect(sure.has(k), k).toBe(true);
  });

  it('every wrong pairing is not sure', () => {
    for (const [n, c] of wrong) expect(sure.has(`${n}/${c}`), `${n}/${c}`).toBe(false);
    expect([...sure].filter((k) => k.startsWith('f') || k.startsWith('g'))).toEqual([]);
  });
});

describe('pairing the families', () => {
  const topic = node('topic', 'Topic', { family: 'many' });
  const method = node('method', 'Method', { family: 'one' });

  it('Topic goes to the biggest many-value family, the others by name', () => {
    const r = run([topic, method, node('t1', 'Alpha theory', { parents: ['topic'] }), node('t2', 'Other', { parents: ['topic'] }), node('big', 'Another family', { family: 'many' })]);
    expect(r.families).toEqual([
      { packFamily: 'topic', root: 'topic', reason: 'largest' },
      { packFamily: 'method', root: 'method', reason: 'name' },
    ]);
  });

  it('a family that is not there is created on first use; a different kind is paired with a warning, never changed', () => {
    expect(run([node('x', 'Whatever')]).families).toEqual([
      { packFamily: 'topic', root: 'later', reason: 'later' },
      { packFamily: 'method', root: 'later', reason: 'later' },
    ]);
    const r = run([node('method', 'Method', { family: 'many' })]);
    expect(r.families.find((f) => f.packFamily === 'method')).toEqual({ packFamily: 'method', root: 'method', reason: 'kind' });
  });

  it('pairs by overlap when the names differ and most recognised values sit in one family', () => {
    const r = run([node('how', 'How', { family: 'one' }), node('s1', 'Sampling methods', { parents: ['how'] }), node('s2', 'Fast sampling', { parents: ['how'] })]);
    expect(r.families.find((f) => f.packFamily === 'method')).toEqual({ packFamily: 'method', root: 'how', reason: 'overlap' });
  });
});

describe('placing the linked tags', () => {
  const base = [node('topic', 'Topic', { family: 'many' }), node('inbox', 'To sort'), node('kw', 'Keywords', { family: 'keywords' })];

  it('moves tags of "To sort" and Keywords into the family, under the parent the pack names when it is a tag', () => {
    const r = run([
      ...base,
      node('alpha', 'Alpha theory', { parents: ['inbox'] }),
      node('beta', 'Beta states', { parents: ['inbox'] }),
      node('gamma', 'Gamma flow', { parents: ['inbox'] }),
      node('delta', 'Delta systems', { parents: ['kw'] }),
      node('chain', 'Delta chains', { parents: ['kw'] }),
    ]);
    expect(r.place).toContainEqual({ nodeId: 'alpha', parentId: 'topic' });
    expect(r.place).toContainEqual({ nodeId: 'beta', parentId: 'alpha' });
    expect(r.place).toContainEqual({ nodeId: 'gamma', parentId: 'alpha' });
    expect(r.place).toContainEqual({ nodeId: 'delta', parentId: 'topic' });
    expect(r.place).toContainEqual({ nodeId: 'chain', parentId: 'delta' });
  });

  it('puts a tag at level 1 when its parent concept is not a tag, and leaves tags already in a family alone', () => {
    const r = run([...base, node('spec', 'Beta spectrum', { parents: ['inbox'] }), node('inside', 'Epsilon maps', { parents: ['topic'] })]);
    expect(r.place).toEqual([{ nodeId: 'spec', parentId: 'topic' }]);
  });

  it('a family that does not exist yet places at its root by `null`', () => {
    const r = run([node('inbox', 'To sort'), node('alpha', 'Alpha theory', { parents: ['inbox'] })]);
    expect(r.place).toEqual([{ nodeId: 'alpha', parentId: null }]);
  });

  it('does not place beyond the depth limit', () => {
    // "Fast sampling" has three levels of its own below it: under "Sampling methods" (level 2) or under the root (level 1) it would go past level 3.
    const r = run([
      node('how', 'Method', { family: 'one' }),
      node('inbox', 'To sort'),
      node('s', 'Sampling methods', { parents: ['how'] }),
      node('f', 'Fast sampling', { parents: ['inbox'] }),
      node('k1', 'Child', { parents: ['f'] }),
      node('k2', 'Grandchild', { parents: ['k1'] }),
      node('k3', 'Great-grandchild', { parents: ['k2'] }),
    ]);
    expect(r.place.find((p) => p.nodeId === 'f')).toBeUndefined();
  });
});

describe('after the pack is applied', () => {
  it('proposes nothing again: linked tags and concepts are left alone', () => {
    const nodes = [node('topic', 'Topic', { family: 'many' }), node('inbox', 'To sort'), node('alpha', 'Alpha theory', { parents: ['inbox'] }), node('gamma', 'Gamma flow', { parents: ['inbox'] })];
    const first = run(nodes);
    expect(first.matches.length).toBe(2);
    const linked = nodes.map((n) => {
      const m = first.matches.find((x) => x.nodeId === n.id);
      const p = first.place.find((x) => x.nodeId === n.id);
      return m ? { ...n, pack: `${pack.id}/${m.conceptId}`, parents: p?.parentId ? [p.parentId] : n.parents } : n;
    });
    const again = run(linked);
    expect(again.matches).toEqual([]);
    expect(again.place).toEqual([]);
    expect(again.recognized).toBe(2);
  });
});
