import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, documentRecordSchema, taxonomyFileSchema, type DocumentRecord, type TaxonomyFile, type TaxonomyOp } from '@rl/core';
import { canonical, createLibraryStore, type FileLibraryStore } from '../store.js';
import { createOrganizer, type Organizer } from './organizer.js';
import { applyTaxonomyOps } from './taxonomy-ops.js';
import { opsExt, retagWithOrigin } from './taxonomy-ops-ext.js';
import { cleanupPlan, planOps, toCleanupInput } from './tag-cleanup.js';
import { hex, removeDir, tempDir } from '../test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const file = (nodes: unknown[], extra: Record<string, unknown> = {}): TaxonomyFile => taxonomyFileSchema.parse({ nodes, ...extra });
const run = (tax: TaxonomyFile, ...ops: TaxonomyOp[]) => applyTaxonomyOps(tax, ops, new Map(), NOW, opsExt);
const fails = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected a failure');
};

describe('setFamily, depth, distinct (pure)', () => {
  it('setFamily: only on a root; one keywords family at most; null clears', () => {
    const tax = file([node('a'), node('b'), node('c', { parents: ['a'] })]);
    expect(run(tax, { op: 'setFamily', id: 'a', family: 'many' }).taxonomy.nodes[0]?.family).toBe('many');
    expect(fails(() => run(tax, { op: 'setFamily', id: 'c', family: 'one' })).details).toMatchObject({ reason: 'not-root' });
    const kw = run(tax, { op: 'setFamily', id: 'a', family: 'keywords' }).taxonomy;
    expect(fails(() => run(kw, { op: 'setFamily', id: 'b', family: 'keywords' })).code).toBe('INVALID_REQUEST');
    expect('family' in (run(kw, { op: 'setFamily', id: 'a', family: null }).taxonomy.nodes[0] ?? {})).toBe(false);
  });
  it('a move that gives parents to a family root takes the family away', () => {
    const tax = file([node('a', { family: 'many' }), node('b', { family: 'many' })]);
    const out = run(tax, { op: 'move', id: 'a', parents: ['b'] }).taxonomy;
    expect(out.nodes.find((n) => n.id === 'a')?.family).toBeUndefined();
  });
  it('depth: three levels under the root; a fourth is refused with reason "depth"', () => {
    const tax = file([node('fam', { family: 'many' }), node('l1', { parents: ['fam'] }), node('l2', { parents: ['l1'] }), node('l3', { parents: ['l2'] }), node('x')]);
    expect(run(tax, { op: 'move', id: 'x', parents: ['l2'] }).taxonomy.nodes.find((n) => n.id === 'x')?.parents).toEqual(['l2']);
    const e = fails(() => run(tax, { op: 'move', id: 'x', parents: ['l3'] }));
    expect(e.code).toBe('INVALID_REQUEST');
    expect(e.details).toMatchObject({ reason: 'depth' });
    // Moving a subtree counts its own height.
    const sub = file([node('fam', { family: 'many' }), node('l1', { parents: ['fam'] }), node('l2', { parents: ['l1'] }), node('t'), node('t1', { parents: ['t'] }), node('t2', { parents: ['t1'] })]);
    expect(fails(() => run(sub, { op: 'move', id: 't', parents: ['l2'] })).details).toMatchObject({ reason: 'depth' });
  });
  it('the keywords family is flat', () => {
    const tax = file([node('kw', { family: 'keywords' }), node('k1', { parents: ['kw'] }), node('k2')]);
    expect(fails(() => run(tax, { op: 'move', id: 'k2', parents: ['k1'] })).details).toMatchObject({ reason: 'depth' });
  });
  it('markDistinct / unmarkDistinct: unordered, idempotent, empty list leaves no key', () => {
    const tax = file([node('a'), node('b')]);
    const marked = run(tax, { op: 'markDistinct', a: 'b', b: 'a' }, { op: 'markDistinct', a: 'a', b: 'b' }).taxonomy;
    expect(marked.distinct).toEqual([{ a: 'a', b: 'b' }]);
    const back = run(marked, { op: 'unmarkDistinct', a: 'b', b: 'a' }).taxonomy;
    expect('distinct' in back).toBe(false);
    expect(fails(() => run(tax, { op: 'markDistinct', a: 'a', b: 'a' })).code).toBe('INVALID_REQUEST');
    expect(fails(() => run(tax, { op: 'markDistinct', a: 'a', b: 'zz' })).code).toBe('NOT_FOUND');
  });
  it('merge keeps the distinct pairs pointing at the survivor', () => {
    const tax = file([node('a'), node('b'), node('c')], { distinct: [{ a: 'a', b: 'c' }, { a: 'a', b: 'b' }] });
    expect(run(tax, { op: 'merge', from: 'a', into: 'b' }).taxonomy.distinct).toEqual([{ a: 'b', b: 'c' }]);
  });
});

describe('provenance of a merge', () => {
  const resolve = (t: string) => (t === 'from' ? 'into' : t);
  it('the strongest origin wins: by hand > ai > import', () => {
    expect(retagWithOrigin(['from', 'into'], { from: 'ai' }, resolve)).toEqual({ tags: ['into'], tagOrigin: undefined }); // into is by hand
    expect(retagWithOrigin(['from', 'into'], { from: 'ai', into: 'import' }, resolve).tagOrigin).toEqual({ into: 'ai' });
    expect(retagWithOrigin(['from', 'into'], { from: 'import', into: 'import' }, resolve).tagOrigin).toEqual({ into: 'import' });
    expect(retagWithOrigin(['from', 'x'], { from: 'ai', x: 'import' }, resolve)).toEqual({ tags: ['into', 'x'], tagOrigin: { into: 'ai', x: 'import' } });
  });
});

describe('an applied and undone change leaves the library identical', () => {
  let root: string;
  let store: FileLibraryStore;
  let org: Organizer;
  const doc = (n: number, over: Record<string, unknown> = {}): DocumentRecord => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/f-${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });
  const snapshot = async () => {
    const { revision: _r, ...tax } = await store.readTaxonomy();
    const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags, tagOrigin: d.tagOrigin ?? null, ref: d.ref, publication: d.publication })).sort((a, b) => (a.id < b.id ? -1 : 1));
    return canonical({ tax, docs });
  };

  beforeEach(async () => {
    root = await tempDir();
    store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
    org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
    await store.init();
    await store.writeTaxonomy(
      file(
        [node('conc', { label: 'concetto' }), node('concs', { label: 'concetti' }), node('2x', { label: '2x' }), node('2-x', { label: '2-x' }), node('preprint', { label: 'preprint' }), node('twa'), node('twb'), node('twc'), node('twd')],
        { venues: [{ id: 'v1', name: 'Journal', aliases: [] }] },
      ),
    );
    await store.documents.put(doc(1, { tags: ['conc', '2x', 'preprint', 'twa', 'twb', 'twc', 'twd'], tagOrigin: { conc: 'ai', '2x': 'import' } }));
    await store.documents.put(doc(2, { tags: ['concs', '2-x', 'twa', 'twb', 'twc', 'twd'], tagOrigin: { concs: 'import', twa: 'ai' } }));
    await store.documents.put(doc(3, { tags: ['conc', 'concs', 'twa', 'twb', 'twc', 'twd'] }));
  });
  afterEach(() => removeDir(root));

  it('merges with provenance, then Undo: taxonomy and document tags and origins are identical', async () => {
    const before = await snapshot();
    const r = await org.applyTaxonomy([
      { op: 'merge', from: 'concs', into: 'conc' },
      { op: 'merge', from: '2-x', into: '2x' },
      { op: 'markDistinct', a: 'twa', b: 'twb' },
      { op: 'setFamily', id: 'twa', family: 'many' },
    ]);
    const mid = await store.documents.get(hex(2));
    expect(mid?.tags).toEqual(['conc', '2x', 'twa', 'twb', 'twc', 'twd']);
    expect(mid?.tagOrigin).toEqual({ conc: 'import', twa: 'ai' }); // doc 2: concs (import) alone becomes conc (import)
    expect((await store.documents.get(hex(3)))?.tags).toContain('conc');
    expect(await snapshot()).not.toBe(before);
    await org.undo(r.changeId);
    expect(JSON.parse(await snapshot())).toEqual(JSON.parse(before));
    await org.redo(r.changeId);
    expect((await store.readTaxonomy()).distinct).toEqual([{ a: 'twa', b: 'twb' }]);
  });

  it('a cleanup step with document edits (metadata to fields, tag deleted) and its Undo', async () => {
    const before = await snapshot();
    const tax = await store.readTaxonomy();
    const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags, venueId: d.ref.venueId ?? null, status: d.publication.status }));
    const input = toCleanupInput(tax, docs);
    const plan = cleanupPlan(input, 5);
    const row = plan.rows.find((x) => x.kind === 'metadata' && x.tags[0] === 'preprint');
    expect(row).toBeDefined();
    const { ops, docEdits } = planOps(plan, new Map([[row?.id as string, undefined]]));
    const r = await org.applyTaxonomy(ops, undefined, { docEdits, summary: 'Vocabulary cleanup, step 5' });
    const d1 = await store.documents.get(hex(1));
    expect(d1?.tags).not.toContain('preprint');
    expect(d1?.publication.status).toBe('preprint');
    expect((await store.readTaxonomy()).nodes.some((n) => n.id === 'preprint')).toBe(false);
    await org.undo(r.changeId);
    expect(await snapshot()).toBe(before);
  });

  it('the whole of steps 1-3 as separate changes, undone in reverse order, restores the start', async () => {
    const before = await snapshot();
    const ids: string[] = [];
    for (const step of [1, 2, 3] as const) {
      const tax = await store.readTaxonomy();
      const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags }));
      const plan = cleanupPlan(toCleanupInput(tax, docs), step);
      const { ops, docEdits } = planOps(plan, new Map(plan.rows.filter((x) => x.checked).map((x) => [x.id, undefined])));
      if (ops.length === 0) continue;
      ids.push((await org.applyTaxonomy(ops, undefined, { docEdits })).changeId);
    }
    expect(ids.length).toBeGreaterThan(0);
    expect(await snapshot()).not.toBe(before);
    for (const id of ids.reverse()) await org.undo(id);
    expect(await snapshot()).toBe(before);
  });
});
