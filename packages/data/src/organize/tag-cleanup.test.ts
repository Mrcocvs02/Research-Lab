import { taxonomyFileSchema, type TaxonomyFile, type TaxonomyNode } from '@rl/core';
import { describe, expect, it } from 'vitest';
import { cleanupPlan, planOps, simulateCleanup, toCleanupInput, type CleanupDoc, type CleanupInput } from './tag-cleanup.js';
import { tagHealth } from './tag-health.js';
import { corpus, node } from './tag-test-corpus.js';

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: Step[] = [1, 2, 3, 4, 5];

const fileOf = (nodes: TaxonomyNode[], extra: Record<string, unknown> = {}): TaxonomyFile => taxonomyFileSchema.parse({ nodes, ...extra });

/** A library in the shape of the old index: macro / micro / extra hints and an `extra:<Name>` family. */
function legacy(): CleanupInput {
  const nodes = [
    node('Macro one', { group: 'macro' }),
    node('Macro two', { group: 'macro' }),
    node('Micro a', { group: 'micro' }),
    node('Micro b', { group: 'micro' }),
    node('Micro d', { group: 'micro' }),
    node('Micro z', { group: 'micro' }),
    node('Micro a detail', { group: 'extra' }),
    node('Plain kw', { group: 'extra' }),
    node('Meth a', { group: 'extra:Method' }),
    node('Meth b', { group: 'extra:Method' }),
  ];
  const on = (n: number, ...tags: string[]): CleanupDoc => ({ id: `d${n}`, tags });
  const docs: CleanupDoc[] = [
    on(0, 'macro-one', 'micro-a', 'micro-a-detail', 'meth-a', 'micro-d'),
    on(1, 'macro-one', 'micro-a', 'micro-a-detail', 'meth-a'),
    on(2, 'macro-one', 'micro-a', 'micro-a-detail', 'meth-b'),
    on(3, 'macro-one', 'micro-a', 'meth-b'),
    on(4, 'macro-one', 'plain-kw'),
    on(5, 'macro-one'),
    on(6, 'macro-two', 'micro-b', 'micro-d'),
    on(7, 'macro-two', 'micro-b', 'micro-d'),
    on(8, 'macro-two', 'micro-d'),
    on(9, 'macro-two'),
    on(10, 'micro-z'),
    on(11),
  ];
  return { nodes, docs };
}

const rebuild = (tax: TaxonomyFile, docs: CleanupDoc[], like: CleanupInput): CleanupInput => ({ ...toCleanupInput(tax, docs), venues: like.venues });

/** Applies every ticked row of the five steps in order, each step planned on the result of the previous one. */
function runAll(input: CleanupInput, pick: (r: { checked: boolean }) => boolean = (r) => r.checked) {
  let tax = fileOf([...input.nodes], input.distinct ? { distinct: input.distinct } : {});
  let cur = input;
  const applied: string[] = [];
  for (const step of STEPS) {
    const plan = cleanupPlan(cur, step);
    const chosen = new Map(plan.rows.filter(pick).map((r) => [r.id, undefined as string | undefined]));
    const { ops, docEdits } = planOps(plan, chosen);
    applied.push(...chosen.keys());
    if (ops.length > 0 || docEdits.length > 0) {
      const sim = simulateCleanup(tax, cur.docs, ops, docEdits);
      tax = sim.taxonomy;
      cur = rebuild(tax, sim.docs, cur);
    }
  }
  return { tax, input: cur, applied };
}

describe('cleanup step 4: macro / micro / extra become levels', () => {
  const input = legacy();
  const plan = cleanupPlan(input, 4);
  const row = (id: string) => plan.rows.find((r) => r.id === `place:${id}`);
  const parentOf = (id: string) => row(id)?.variants['default']?.ops.find((o) => o.op === 'move');

  it('macros go under Topic (created); micros under the macro with the highest P(macro | micro)', () => {
    expect(plan.prelude.map((o) => o.op)).toContain('setFamily');
    const topic = (plan.prelude[0] as { id: string }).id;
    expect(parentOf('macro-one')).toMatchObject({ parents: [topic] });
    expect(parentOf('macro-two')).toMatchObject({ parents: [topic] });
    expect(parentOf('micro-a')).toMatchObject({ parents: ['macro-one'] }); // P = 1
    expect(parentOf('micro-b')).toMatchObject({ parents: ['macro-two'] });
    expect(parentOf('micro-d')).toMatchObject({ parents: ['macro-two'] }); // 3 of 4 papers vs 1 of 4
  });
  it('a micro with P < 0.5 goes straight under Topic and is marked', () => {
    expect(parentOf('micro-z')).toMatchObject({ parents: [(plan.prelude[0] as { id: string }).id] });
    expect(row('micro-z')?.marked).toBe(true);
  });
  it('extras go to Keywords, except one with 3+ papers that R8 puts under a micro (a detail)', () => {
    expect(parentOf('micro-a-detail')).toMatchObject({ parents: ['micro-a'] });
    const kw = plan.prelude.find((o) => o.op === 'create' && o.label === 'Keywords') as { id: string };
    expect(parentOf('plain-kw')).toMatchObject({ parents: [kw.id] });
  });
  it('an extra:<Name> family becomes a root with its members; one value when 80 % of the papers have one', () => {
    const fam = plan.rows.find((r) => r.kind === 'family');
    expect(fam?.variant).toBe('default');
    const ops = fam?.variants['default']?.ops ?? [];
    expect(ops[0]).toMatchObject({ op: 'create', label: 'Method' });
    expect(ops).toContainEqual(expect.objectContaining({ op: 'setFamily', family: 'one' }));
    expect(fam?.variants['many']).toBeDefined();
  });
  it('a library with no suggestion: tags with enough papers become Topic values, the rest Keywords', () => {
    const nodes = [node('Often'), node('Rare'), node('Mid')];
    const docs: CleanupDoc[] = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, tags: [...(i < 6 ? ['often'] : []), ...(i === 0 ? ['rare'] : [])] }));
    const p = cleanupPlan({ nodes, docs }, 4);
    const to = (id: string) => (p.rows.find((r) => r.id === `place:${id}`)?.variants['default']?.ops[0] as { parents: string[] }).parents[0];
    const topicId = (p.prelude.find((o) => o.op === 'create' && o.label === 'Topic') as { id: string }).id;
    const kwId = (p.prelude.find((o) => o.op === 'create' && o.label === 'Keywords') as { id: string }).id;
    expect(to('often')).toBe(topicId);
    expect(to('rare')).toBe(kwId);
  });
  it('several parents become one (the one with most papers in common)', () => {
    const nodes = [node('P one', { family: 'many' }), node('P two', { family: 'many' }), node('Child', { parents: ['p-one', 'p-two'] })];
    const docs: CleanupDoc[] = [{ id: 'd0', tags: ['child', 'p-two'] }, { id: 'd1', tags: ['child', 'p-two'] }, { id: 'd2', tags: ['child', 'p-one'] }];
    const r = cleanupPlan({ nodes, docs }, 4).rows.find((x) => x.kind === 'parent');
    expect(r?.variants['default']?.ops).toEqual([{ op: 'move', id: 'child', parents: ['p-two'] }]);
  });
  it('a one-value family with papers holding two values: keep one per paper, or make it many', () => {
    const nodes = [node('Method', { family: 'one' }), node('M one', { parents: ['method'] }), node('M two', { parents: ['method'] }), node('M two sub', { parents: ['m-two'] })];
    const docs: CleanupDoc[] = [{ id: 'd0', tags: ['m-one', 'm-two', 'm-two-sub'] }, { id: 'd1', tags: ['m-one'] }];
    const r = cleanupPlan({ nodes, docs }, 4).rows.find((x) => x.kind === 'onevalue');
    expect(r?.variants['pick']?.docEdits).toEqual([{ docId: 'd0', removeTags: ['m-one'] }]); // the most specific value stays
    expect(r?.variants['many']?.ops).toEqual([{ op: 'setFamily', id: 'method', family: 'many' }]);
  });
  it('document types: an off-by-default "Paper type" family', () => {
    const docs: CleanupDoc[] = [{ id: 'd0', tags: [], type: 'article' }, { id: 'd1', tags: [], type: 'thesis' }];
    const r = cleanupPlan({ nodes: [], docs, documentTypes: [{ id: 'article', label: 'article' }, { id: 'thesis', label: 'thesis' }] }, 4).rows.find((x) => x.kind === 'paper-type');
    expect(r?.checked).toBe(false);
    expect(r?.variants['default']?.docEdits).toHaveLength(2);
  });
});

describe('cleanup steps 1-3 and 5', () => {
  const c = corpus();
  it('step 1 holds the sure merges ticked; step 2 the likely ones ticked and the maybe ones not', () => {
    expect(cleanupPlan(c, 1).rows.every((r) => r.confidence === 'sure' && r.checked)).toBe(true);
    const two = cleanupPlan(c, 2).rows;
    expect(two.every((r) => r.checked === (r.confidence === 'likely'))).toBe(true);
  });
  it('a merge keeps every old name as an alias and the extended name with its sigla', () => {
    const { tax } = runAll(c);
    const abc = tax.nodes.find((n) => n.id === 'alfa-beta-gamma-abc');
    expect(abc?.label).toBe('Alfa beta gamma (ABC)');
    expect(abc?.aliases).toEqual(expect.arrayContaining(['ABC', 'ABCs']));
    expect(tax.nodes.some((n) => n.id === 'abcs')).toBe(false);
  });
  it('twins: the default for a block of five is Keywords; "leave" does nothing', () => {
    const t = cleanupPlan(c, 3).rows.find((r) => r.tags.includes('twin-a'));
    expect(t?.variant).toBe('keywords');
    expect(t?.variants['leave']).toEqual({ ops: [], docEdits: [] });
  });
  it('names: renamed by the convention, the old name stays an alias; metadata moves to the field', () => {
    const nodes = [node('old_name'), node('preprint'), node('Journal x')];
    const docs: CleanupDoc[] = [{ id: 'd0', tags: ['old-name', 'preprint'] }, { id: 'd1', tags: ['preprint', 'journal-x'], status: 'published' }];
    const venues = [{ id: 'jx', name: 'Journal x', aliases: [] }];
    const rows = cleanupPlan({ nodes, docs, venues }, 5).rows;
    expect(rows.find((r) => r.kind === 'name')?.variants['default']?.ops).toEqual([{ op: 'rename', id: 'old-name', label: 'Old name' }, { op: 'setAliases', id: 'old-name', aliases: ['old_name'] }]);
    const meta = rows.find((r) => r.kind === 'metadata' && r.tags[0] === 'preprint');
    expect(meta?.remains).toBe(true); // d1 says "published": the tag stays there
    expect(meta?.variants['default']?.docEdits).toEqual([{ docId: 'd0', removeTags: ['preprint'], status: 'preprint' }]);
    const venueRow = rows.find((r) => r.kind === 'metadata' && r.tags[0] === 'journal-x');
    expect(venueRow?.variants['default']?.docEdits).toEqual([{ docId: 'd1', removeTags: ['journal-x'], venueId: 'jx' }]);
    expect(venueRow?.variants['default']?.ops).toEqual([{ op: 'delete', id: 'journal-x' }]);
  });
});

describe('idempotency: after the ticked rows are applied, nothing new is proposed', () => {
  it.each([
    ['synthetic corpus', () => corpus()],
    ['old-index shape', () => legacy()],
  ])('%s', (_name, make) => {
    const before = make();
    const first = runAll(before);
    expect(first.applied.length).toBeGreaterThan(0);
    const beforeIds = new Set(STEPS.flatMap((s) => cleanupPlan(before, s).rows.map((r) => r.id)));
    for (const step of STEPS) {
      const rows = cleanupPlan(first.input, step).rows;
      expect(rows.filter((r) => r.checked).map((r) => r.id)).toEqual([]);
      for (const r of rows) expect(beforeIds.has(r.id), `new row ${r.id} in step ${step}`).toBe(true);
    }
    // And a second run changes nothing.
    const second = runAll(first.input);
    expect(second.applied).toEqual([]);
    expect(JSON.stringify(taxonomyFileSchema.parse(second.tax))).toBe(JSON.stringify(taxonomyFileSchema.parse(first.tax)));
  });
  it('the cleanup improves the figures: fewer duplicates, no tag outside a family', () => {
    const before = legacy();
    const after = runAll(before).input;
    const get = (i: CleanupInput, k: string) => tagHealth(i).find((h) => h.kind === k)?.count;
    expect(get(before, 'orphans')).toBeGreaterThan(0);
    expect(get(after, 'orphans')).toBe(0);
  });
});

describe('cleanup on real-shaped vocabularies (D-505)', () => {
  it('twins: topics (macro / micro) stay where they are; only their keyword twins go to Keywords', () => {
    const nodes = [node('Topic t', { group: 'micro' }), node('kw a', { group: 'extra:K' }), node('kw b', { group: 'extra:K' }), node('kw c', { group: 'extra:K' })];
    const tags = ['topic-t', 'kw-a', 'kw-b', 'kw-c'];
    const docs: CleanupDoc[] = [{ id: 'd0', tags }, { id: 'd1', tags }];
    const row = cleanupPlan({ nodes, docs }, 3).rows[0];
    expect(row?.variant).toBe('keywords');
    const moved = row?.variants['keywords']?.ops.filter((o) => o.op === 'move').map((o) => (o as { id: string }).id);
    expect(moved?.sort()).toEqual(['kw-a', 'kw-b', 'kw-c']);
    // A group of topics only: nothing to send to Keywords, left alone and not ticked.
    const only = [node('Macro p', { group: 'macro' }), node('Micro q', { group: 'micro' })];
    const r2 = cleanupPlan({ nodes: only, docs: [{ id: 'd0', tags: ['macro-p', 'micro-q'] }, { id: 'd1', tags: ['macro-p', 'micro-q'] }] }, 3).rows[0];
    expect(r2).toMatchObject({ variant: 'leave', checked: false });
  });
  it('an extra:<Name> group with more than 12 values and several per paper is a keyword list, not a family', () => {
    const kws = Array.from({ length: 14 }, (_, i) => node(`kw ${String.fromCharCode(97 + i)}`, { group: 'extra:Big' }));
    const docs: CleanupDoc[] = [0, 1, 2].map((d) => ({ id: `d${d}`, tags: kws.map((k) => k.id) }));
    const plan = cleanupPlan({ nodes: [node('Macro m', { group: 'macro' }), ...kws], docs }, 4);
    expect(plan.rows.some((r) => r.kind === 'family')).toBe(false);
    const kwRoot = plan.prelude.find((o) => o.op === 'setFamily' && o.family === 'keywords') as { id: string } | undefined;
    expect(kwRoot).toBeDefined();
    for (const k of kws) expect(plan.rows.find((r) => r.id === `place:${k.id}`)?.variants['default']?.ops[0]).toMatchObject({ op: 'move', parents: [kwRoot?.id] });
  });
  it('a micro on a tie goes under the smaller (more specific) macro', () => {
    const nodes = [node('Big macro', { group: 'macro' }), node('Small macro', { group: 'macro' }), node('Micro s', { group: 'micro' })];
    const docs: CleanupDoc[] = [
      { id: 'd0', tags: ['big-macro', 'small-macro', 'micro-s'] },
      { id: 'd1', tags: ['big-macro', 'small-macro', 'micro-s'] },
      { id: 'd2', tags: ['big-macro'] },
      { id: 'd3', tags: ['big-macro'] },
    ];
    const move = cleanupPlan({ nodes, docs }, 4).rows.find((r) => r.id === 'place:micro-s')?.variants['default']?.ops[0];
    expect(move).toMatchObject({ parents: ['small-macro'] });
  });
});

describe('generic macros, micro lift and author tags (D-508)', () => {
  const nodes = [node('Wide', { group: 'macro' }), node('Narrow', { group: 'macro' }), node('Micro q', { group: 'micro' }), node('Other kw', { group: 'extra' })];
  const docs: CleanupDoc[] = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, tags: ['wide', ...(i < 3 ? ['narrow', 'micro-q'] : []), ...(i === 5 ? ['micro-q'] : [])] }));
  const plan = cleanupPlan({ nodes, docs }, 4);
  const row = (id: string) => plan.rows.find((r) => r.tags[0] === id);

  it('a macro on more than half of the papers is a family of its own, not a Topic value (W11)', () => {
    const wide = row('wide');
    expect(wide).toMatchObject({ kind: 'generic', marked: true, variant: 'default' });
    expect(wide?.variants['default']?.ops).toEqual([{ op: 'setFamily', id: 'wide', family: 'many' }]);
    expect(Object.keys(wide?.variants ?? {})).toEqual(['default', 'topic', 'keywords']);
    expect(row('narrow')?.kind).toBe('place');
  });
  it('a micro goes to the macro with the highest lift among those holding half of its papers (W16)', () => {
    // micro-q: on 4 papers, 3 with narrow (P 0.75, lift 3) and 4 with wide (P 1, lift 1.2): narrow wins, not the biggest.
    expect(row('micro-q')?.variants['default']?.ops).toEqual([{ op: 'move', id: 'micro-q', parents: ['narrow'] }]);
  });
  it('a small library has no generic value', () => {
    const small = cleanupPlan({ nodes, docs: docs.slice(0, 6) }, 4);
    expect(small.rows.some((r) => r.kind === 'generic')).toBe(false);
  });
  it('an author tag row only removes the tag from the papers', () => {
    const ds: CleanupDoc[] = [{ id: 'a', tags: ['doe-j', 'x'], authors: ['Doe, Jane'] }, { id: 'b', tags: ['doe-j'], authors: ['Jane Doe'] }];
    const rows = cleanupPlan({ nodes: [node('doe_j', { id: 'doe-j' }), node('x')], docs: ds }, 5).rows.filter((r) => r.kind === 'metadata');
    expect(rows).toHaveLength(1);
    const v = rows[0]?.variants['default'];
    expect(rows[0]).toMatchObject({ kind: 'metadata', remains: false });
    expect(v?.docEdits).toEqual([{ docId: 'a', removeTags: ['doe-j'] }, { docId: 'b', removeTags: ['doe-j'] }]);
    expect(v?.ops).toEqual([{ op: 'delete', id: 'doe-j' }]);
  });
});
