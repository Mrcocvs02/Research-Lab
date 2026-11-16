import { describe, expect, it } from 'vitest';
import type { TaxonomyNodeView } from '@rl/core';
import { initialBrowse, planQuery, setTagFilter } from './docQuery';
import { clickSelect, emptySelection, moveSelect, rangeHasHoles, selectAll, toggleActive } from './selection';
import { canCreateTag, exactNode, suggestTags } from './tagSuggest';
import { buildModel, canDelete, parentsAfterDrop, docMatchesTag, flattenTree, impliedClosure, impliesCycle, pathLabel, wouldCycle } from './taxonomyModel';

const node = (id: string, over: Partial<TaxonomyNodeView> = {}): TaxonomyNodeView => ({
  id,
  label: id,
  parents: [],
  aliases: [],
  implies: [],
  status: 'active',
  origin: 'user',
  counts: { direct: 0, implied: 0, subtree: 0 },
  ...over,
});

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('click selects one, ctrl toggles, shift selects a range from the anchor', () => {
    let s = clickSelect(emptySelection(), order, 1);
    expect([...s.ids]).toEqual(['b']);
    s = clickSelect(s, order, 3, { ctrl: true });
    expect([...s.ids].sort()).toEqual(['b', 'd']);
    s = clickSelect(s, order, 1, { ctrl: true });
    expect([...s.ids]).toEqual(['d']);
    s = clickSelect(clickSelect(emptySelection(), order, 1), order, 3, { shift: true });
    expect([...s.ids]).toEqual(['b', 'c', 'd']);
    // the anchor stays: shifting back shrinks the range
    s = clickSelect(s, order, 0, { shift: true });
    expect([...s.ids].sort()).toEqual(['a', 'b']);
  });
  it('ctrl+shift adds the range to what is selected', () => {
    let s = clickSelect(emptySelection(), order, 0);
    s = clickSelect(s, order, 4, { ctrl: true });
    s = clickSelect(s, order, 3, { ctrl: true, shift: true });
    expect([...s.ids].sort()).toEqual(['a', 'd', 'e']);
  });
  it('arrow keys move the selection, shift extends, ctrl only moves the focus', () => {
    let s = moveSelect(emptySelection(), order, 1);
    expect([s.active, [...s.ids]]).toEqual(['a', ['a']]);
    s = moveSelect(s, order, 1, { shift: true });
    s = moveSelect(s, order, 1, { shift: true });
    expect([...s.ids]).toEqual(['a', 'b', 'c']);
    s = moveSelect(s, order, 1, { ctrl: true });
    expect([s.active, [...s.ids]]).toEqual(['d', ['a', 'b', 'c']]);
    s = toggleActive(s, order);
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(moveSelect(s, order, 'end').active).toBe('e');
    expect(moveSelect(s, order, -99).active).toBe('a');
  });
  it('keeps focus and anchor by id when the list changes under them', () => {
    let s = clickSelect(emptySelection(), order, 2); // c
    // a new row arrives at the top: c moves from index 2 to 3, the focus stays on c
    const next = ['n', 'a', 'b', 'c', 'd'];
    expect(s.active).toBe('c');
    expect([...moveSelect(s, next, 1).ids]).toEqual(['d']);
    expect([...moveSelect(s, next, -1).ids]).toEqual(['b']);
    s = clickSelect(s, next, 0, { shift: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c', 'n']);
    const lost = { ...emptySelection(), ids: new Set(['a']), active: 'gone' };
    expect(toggleActive(lost, next)).toBe(lost);
    // an active row that left the list: moving restarts from the edge instead of acting on another document
    expect([...moveSelect({ ...emptySelection(), active: 'gone' }, next, 1).ids]).toEqual(['n']);
  });
  it('select all and holes', () => {
    expect(selectAll(order).ids.size).toBe(5);
    const holey = ['a', undefined, 'c'];
    expect(rangeHasHoles(holey, 0, 2)).toBe(true);
    expect(rangeHasHoles(holey, 2, 2)).toBe(false);
    expect([...clickSelect(emptySelection(), holey, 0).ids]).toEqual(['a']);
    expect(clickSelect(emptySelection(), holey, 1).ids.size).toBe(0);
  });
});

describe('tag completion', () => {
  const model = buildModel([
    node('methods', { label: 'Methods', counts: { direct: 1, implied: 1, subtree: 3 } }),
    node('stats', { label: 'Statistics', parents: ['methods'], aliases: ['stat', 'Statistique'] }),
    node('ml', { label: 'Machine learning', parents: ['methods'], aliases: ['ML', 'apprentissage automatique'] }),
    node('old', { label: 'Old topic', status: 'deprecated' }),
    node('reseau', { label: 'Réseau' }),
  ]);
  it('finds by label, alias, accent-free text and says when an alias matched', () => {
    expect(suggestTags(model, 'stat')[0]?.id).toBe('stats');
    const viaAlias = suggestTags(model, 'apprentissage')[0];
    expect(viaAlias?.id).toBe('ml');
    expect(viaAlias?.viaAlias).toBe('apprentissage automatique');
    expect(suggestTags(model, 'ml')[0]).toMatchObject({ id: 'ml', viaAlias: 'ML' });
    expect(suggestTags(model, 'reseau')[0]?.id).toBe('reseau');
    expect(suggestTags(model, 'statistique')[0]?.id).toBe('stats');
  });
  it('never proposes deprecated or excluded tags and shows the parents', () => {
    expect(suggestTags(model, 'old')).toEqual([]);
    expect(suggestTags(model, 'stat', { exclude: new Set(['stats']) })).toEqual([]);
    expect(suggestTags(model, 'statistics')[0]?.path).toBe('Methods');
  });
  it('offers to create a tag only for a text that names none', () => {
    expect(canCreateTag(model, 'brand new')).toBe(true);
    expect(canCreateTag(model, 'ML')).toBe(false);
    expect(canCreateTag(model, 'old topic')).toBe(false);
    expect(canCreateTag(model, '   ')).toBe(false);
    expect(exactNode(model, 'RESEAU')?.id).toBe('reseau');
  });
});

describe('taxonomy model', () => {
  const nodes = [
    node('a'),
    node('b', { parents: ['a'] }),
    node('c', { parents: ['b'] }),
    node('d', { parents: ['a', 'b'], implies: ['x'] }),
    node('x'),
  ];
  const model = buildModel(nodes);
  it('builds a tree with several parents (a node shows under each)', () => {
    const rows = flattenTree(model, 'all');
    expect(rows.filter((r) => r.id === 'd').map((r) => r.parentId).sort()).toEqual(['a', 'b']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(flattenTree(model, new Set()).map((r) => r.id)).toEqual(['a', 'x']);
  });
  it('detects cycles for parents and implications', () => {
    expect(wouldCycle(model, 'a', ['c'])).toBe(true);
    expect(wouldCycle(model, 'c', ['a'])).toBe(false);
    expect(impliesCycle(model, 'x', ['d'])).toBe(true);
    expect(impliesCycle(model, 'a', ['x'])).toBe(false);
  });
  it('matches documents through descendants and implications', () => {
    expect(docMatchesTag(model, ['c'], 'a')).toBe(true);
    expect(docMatchesTag(model, ['d'], 'x')).toBe(true);
    expect(docMatchesTag(model, ['x'], 'a')).toBe(false);
    expect([...impliedClosure(model, ['d'])].sort()).toEqual(['d', 'x']);
    expect(pathLabel(model, 'c')).toBe('a › b');
  });
  it('knows what can be deleted and how a drop changes the parents', () => {
    expect(canDelete(model, node('lonely'))).toBe(true);
    expect(canDelete(model, node('x', { counts: { direct: 2, implied: 2, subtree: 2 } }))).toBe(false);
    expect(canDelete(model, nodes[0]!)).toBe(false); // has children
    expect(canDelete(model, nodes[4]!)).toBe(false); // implied by d
    expect(parentsAfterDrop({ parents: ['a', 'b'] }, 'a', 'c')).toEqual(['b', 'c']);
    expect(parentsAfterDrop({ parents: ['a'] }, 'a', null)).toEqual([]);
    expect(parentsAfterDrop({ parents: [] }, null, 'a')).toEqual(['a']);
  });
});

describe('query plan', () => {
  it('sends every condition to the index: all-of tags, folder with sub-folders', () => {
    const s = { ...initialBrowse(), folder: 'x/y', tags: { include: ['a', 'c'], exclude: [], mode: 'all' as const } };
    expect(planQuery(s).filters).toEqual({ tags: ['a', 'c'], folder: 'x/y', includeSubfolders: true });
  });
  it('maps "any of", exclusion and "this folder only" to server filters', () => {
    expect(planQuery({ ...initialBrowse(), tags: { include: ['a', 'c'], exclude: [], mode: 'any' } }).filters).toEqual({ tagsAny: ['a', 'c'] });
    expect(planQuery({ ...initialBrowse(), tags: { include: ['a'], exclude: ['c'], mode: 'all' } }).filters).toEqual({ tags: ['a'], tagsExclude: ['c'] });
    expect(planQuery({ ...initialBrowse(), folder: 'x', includeSub: false }).filters).toEqual({ folder: 'x', includeSubfolders: false });
    expect(planQuery({ ...initialBrowse(), folder: '', includeSub: false }).filters).toEqual({ folder: '', includeSubfolders: false });
    expect(planQuery(initialBrowse()).filters).toEqual({});
  });
  it('a single "any" tag is the same as "all"; relevance without text is title order', () => {
    const p = planQuery({ ...initialBrowse(), tags: { include: ['a'], exclude: [], mode: 'any' } });
    expect(p.filters.tags).toEqual(['a']);
    expect(p.filters.tagsAny).toBeUndefined();
    expect(planQuery(initialBrowse()).sort).toBe('title');
    expect(planQuery({ ...initialBrowse(), text: 'q' }).sort).toBe('relevance');
    expect(planQuery({ ...initialBrowse(), sort: 'size-desc' }).sort).toBe('size-desc');
  });
  it('a tag is in the include or the exclude list, never both', () => {
    const t = setTagFilter({ include: ['a'], exclude: [], mode: 'all' }, 'a', 'exclude');
    expect(t).toMatchObject({ include: [], exclude: ['a'] });
    expect(setTagFilter(t, 'a', null)).toMatchObject({ include: [], exclude: [] });
  });
});
