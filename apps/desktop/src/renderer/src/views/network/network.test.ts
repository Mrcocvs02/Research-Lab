// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider } from '../../lib/aiUi';
import { LibraryEventsProvider } from '../../lib/events';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider } from '../../lib/reader';
import { AppProvider } from '../../state/app-context';
import { ExportProbe } from '../../testing/exportProbe';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { Explore } from './Explore';
import { MAX_NET_NODES, Network } from './forceSim';
import { boundsOf, fitView, PointGrid, placeLabels, toScreenX, toWorldX, zoomAt } from './geometry';
import { NetworkView } from './NetworkView';
import { parentFromPath, pushBack } from './exploreNav';
import { clusterText, prepareMap, type MapResponse } from './mapModel';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

describe('geometry', () => {
  it('fits bounds and keeps the point under the cursor when zooming', () => {
    const b = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    const v = fitView(b, 400, 300, 0);
    expect(v.k).toBeCloseTo(4);
    expect(toScreenX(v, 50, 400)).toBeCloseTo(200);
    const z = zoomAt(v, 100, 80, 2, 400, 300, v.k);
    expect(toWorldX(z, 100, 400)).toBeCloseTo(toWorldX(v, 100, 400));
    expect(z.k).toBeCloseTo(8);
  });

  it('finds the nearest point and culls through the grid', () => {
    const n = 2000;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (i % 50) * 10;
      ys[i] = Math.floor(i / 50) * 10;
    }
    const grid = new PointGrid(xs, ys, n, boundsOf(xs, ys, n));
    expect(grid.nearest(101, 52, 3)).toBe(5 * 50 + 10);
    expect(grid.nearest(105, 105, 1)).toBe(-1);
    const seen: number[] = [];
    grid.forEachIn(0, 0, 20, 20, (i) => seen.push(i));
    for (const want of [0, 1, 2, 50, 51, 52, 100, 101, 102]) expect(seen).toContain(want);
  });

  it('places labels without overlaps, first in the given order', () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 5, y: 5, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
    ];
    expect(placeLabels(boxes, [1, 0, 2])).toEqual([1, 2]);
  });
});

describe('network simulation', () => {
  const raw = (n: number, prefix = 'n') => Array.from({ length: n }, (_, i) => ({ kind: 'doc' as const, id: `${prefix}${i}`, label: `${prefix}${i}` }));

  it('places new nodes around the expanded one and leaves the others in place', () => {
    const net = new Network();
    const root = net.seed({ kind: 'doc', id: 'root', label: 'root' });
    net.expand(root, raw(5), raw(5).map((r) => ({ from: root.key, to: `doc:${r.id}`, kind: 'similar' as const, weight: 0.5 })));
    for (let i = 0; i < 300 && net.tick(); i++);
    const before = new Map([...net.nodes].map(([k, n]) => [k, { x: n.x, y: n.y }]));
    const leaf = net.nodes.get('doc:n0')!;
    const res = net.expand(leaf, raw(6, 'm'), raw(6, 'm').map((r) => ({ from: leaf.key, to: `doc:${r.id}`, kind: 'similar' as const, weight: 0.3 })));
    expect(res.added).toBe(6);
    for (const m of raw(6, 'm')) {
      const n = net.nodes.get(`doc:${m.id}`)!;
      expect(Math.hypot(n.x - leaf.x, n.y - leaf.y)).toBeLessThan(150);
    }
    for (let i = 0; i < 20; i++) net.tick();
    // The first tick of an expansion moves old nodes only a little.
    for (const [k, p] of before) {
      const n = net.nodes.get(k)!;
      expect(Math.hypot(n.x - p.x, n.y - p.y)).toBeLessThan(60);
    }
  });

  it('matches edges by node key, so a folder and a tag with the same id stay apart', () => {
    const net = new Network();
    const root = net.seed({ kind: 'folder', id: 'x', label: 'x' });
    net.expand(root, [{ kind: 'tag', id: 'x', label: 'tag x' }], [{ from: 'tag:x', to: 'folder:x', kind: 'tagged', weight: 1 }]);
    expect(net.size).toBe(2);
    expect(net.edges).toEqual([{ a: 'tag:x', b: 'folder:x', kind: 'tagged', weight: 1 }]);
  });

  it('collapses an expansion, removes a node with its orphans and caps the size', () => {
    const net = new Network();
    const root = net.seed({ kind: 'doc', id: 'r', label: 'r' });
    net.expand(root, raw(3), raw(3).map((r) => ({ from: root.key, to: `doc:${r.id}`, kind: 'similar' as const, weight: 1 })));
    net.expand(net.nodes.get('doc:n0')!, raw(2, 'q'), raw(2, 'q').map((r) => ({ from: 'doc:n0', to: `doc:${r.id}`, kind: 'cites' as const, weight: 1 })));
    expect(net.size).toBe(6);
    expect(net.collapse('doc:n0')).toBe(2);
    expect(net.size).toBe(4);
    net.remove('doc:n1');
    expect(net.nodes.has('doc:n1')).toBe(false);
    net.clear();
    const big = net.seed({ kind: 'doc', id: 'big', label: 'big' });
    const r = net.expand(big, raw(MAX_NET_NODES + 50, 'z'), []);
    expect(r.capped).toBe(true);
    expect(net.size).toBe(MAX_NET_NODES);
  });

  it('stays cheap with 500 nodes', () => {
    const net = new Network();
    const root = net.seed({ kind: 'doc', id: 'r', label: 'r' });
    net.expand(root, raw(300), raw(300).map((r) => ({ from: root.key, to: `doc:${r.id}`, kind: 'similar' as const, weight: Math.random() })));
    net.expand(net.nodes.get('doc:n1')!, raw(200, 'k'), raw(200, 'k').map((r) => ({ from: 'doc:n1', to: `doc:${r.id}`, kind: 'cites' as const, weight: 0.5 })));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) net.tick();
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});

describe('exploration navigation', () => {
  it('finds the parent from a path with or without the node itself', () => {
    expect(parentFromPath([{ id: 'a' }, { id: 'b' }], 'b')).toBe('a');
    expect(parentFromPath([{ id: 'a' }, { id: 'b' }], 'c')).toBe('b');
    expect(parentFromPath([{ id: 'a' }], 'a')).toBeNull();
    expect(parentFromPath([], 'a')).toBeNull();
  });

  it('keeps a bounded back stack without repeating the top', () => {
    const e = { loc: { dim: 'topic' as const, parentId: null, selected: null }, label: 'x' };
    expect(pushBack(pushBack([], e), e)).toHaveLength(1);
    let s: ReturnType<typeof pushBack> = [];
    for (let i = 0; i < 80; i++) s = pushBack(s, { ...e, loc: { ...e.loc, parentId: String(i) } });
    expect(s).toHaveLength(50);
  });
});

describe('map model', () => {
  const resp: MapResponse = {
    points: [
      { docId: 'a'.repeat(16), x: 0, y: 0, clusters: ['c0', 'c0a'] },
      { docId: 'b'.repeat(16), x: 1, y: 1, clusters: ['c0', 'c0b'] },
      { docId: 'c'.repeat(16), x: 5, y: 5, clusters: ['c1', 'c1a'] },
      { docId: 'd'.repeat(16), x: 6, y: 5, clusters: [] },
    ],
    clusters: [
      { id: 'c0', parent: null, level: 0, size: 2, topTerms: ['alpha', 'beta', 'gamma', 'delta'], aiLabel: null, centroid: { x: 0.5, y: 0.5 } },
      { id: 'c1', parent: null, level: 0, size: 1, topTerms: ['omega'], aiLabel: { text: 'Omega things', meta: {} as never }, centroid: { x: 5, y: 5 } },
      { id: 'c0a', parent: 'c0', level: 1, size: 1, topTerms: ['x'], aiLabel: null, centroid: { x: 0, y: 0 } },
    ],
    seed: 7,
    builtAt: '2026-01-01T00:00:00.000Z',
  };

  it('groups points by cluster per level and labels clusters', () => {
    const m = prepareMap(resp);
    expect(m.levels.map((l) => l.length)).toEqual([2, 1]);
    const g0 = m.groups[0]!;
    // c0 has 2 points, c1 one, the rest (no cluster) one
    expect([...g0.starts]).toEqual([0, 2, 3, 4]);
    expect(clusterText(m.levels[0]![0]!)).toEqual({ text: 'alpha, beta, gamma', ai: false });
    expect(clusterText(m.levels[0]![1]!)).toEqual({ text: 'Omega things', ai: true });
    expect(m.grid.nearest(5.1, 5, 0.5)).toBe(2);
  });
});

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));

async function mount(child: React.ReactElement, extra: Record<string, (p: any) => unknown>) {
  const { handlers } = memoryBackend({ profiles: [profile], settings: { uiLanguage: 'en' } });
  setHandlers({ ...handlers, 'projects:list': () => ({ items: [] }), 'taxonomy:get': () => ({ revision: 0, nodes: [], documentTypes: [], venues: [] }), 'library:listFolders': () => ({ folders: [] }), ...extra });
  const P: any[] = [AppProvider, LibraryEventsProvider, NotifyProvider, ReaderProvider, AiUiProvider];
  render(P.reduceRight((c, X) => createElement(X, null, c), createElement(Fragment, null, child, createElement(ExportProbe))));
  await settle();
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('NetworkView', () => {
  it('shows the empty state, builds with progress and reloads when the build ends', async () => {
    let state: 'none' | 'ready' = 'none';
    await mount(createElement(NetworkView), {
      'graph:status': () => ({ state, documents: 3, builtAt: state === 'ready' ? '2026-01-01T10:00:00.000Z' : null, seed: state === 'ready' ? 5 : null, pending: 0 }),
      'graph:build': () => ({ jobId: 'job1' }),
      'graph:map': () => ({ points: [], clusters: [], seed: 5, builtAt: '2026-01-01T10:00:00.000Z' }),
    });
    expect(screen.getByTestId('graph-empty')).toBeTruthy();
    fireEvent.change(screen.getByTestId('graph-seed'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('graph-build-empty'));
    await settle();
    expect(callsTo('graph:build')).toEqual([{ seed: 5 }]);
    act(() => emitEvent('graph:progress', { jobId: 'job1', phase: 'similarity', done: 1, total: 4 }));
    expect(screen.getByTestId('graph-progress').getAttribute('data-phase')).toBe('similarity');
    expect(screen.getByTestId('graph-cancel')).toBeTruthy();
    state = 'ready';
    act(() => emitEvent('graph:progress', { jobId: 'job1', phase: 'done', done: 4, total: 4 }));
    await settle();
    expect(screen.queryByTestId('graph-progress')).toBeNull();
    expect(screen.getByTestId('graph-status').getAttribute('data-state')).toBe('ready');
    expect(callsTo('graph:map').length).toBeGreaterThan(0);
  });

  it('keeps the map usable when stale and shows how many documents are pending', async () => {
    await mount(createElement(NetworkView), {
      'graph:status': () => ({ state: 'stale', documents: 4, builtAt: '2026-01-01T10:00:00.000Z', seed: 5, pending: 2 }),
      'graph:map': () => ({ points: [], clusters: [], seed: 5, builtAt: '2026-01-01T10:00:00.000Z' }),
    });
    expect(screen.getByTestId('graph-status-text').textContent).toContain('2 documents');
    expect(screen.getByTestId('graph-build').textContent).toBe('Rebuild');
    expect(callsTo('graph:map').length).toBeGreaterThan(0);
  });
});

describe('NetworkView: second-brain export', () => {
  it('starts the export from one cluster of the legend', async () => {
    await mount(createElement(NetworkView), {
      'graph:status': () => ({ state: 'ready', documents: 2, builtAt: '2026-01-01T10:00:00.000Z', seed: 5, pending: 0 }),
      'graph:map': () => ({
        points: [
          { docId: 'a'.repeat(16), x: 0, y: 0, clusters: ['c0'] },
          { docId: 'b'.repeat(16), x: 1, y: 1, clusters: ['c0'] },
        ],
        clusters: [{ id: 'c0', parent: null, level: 0, size: 2, topTerms: ['alpha', 'beta'], aiLabel: null, centroid: { x: 0.5, y: 0.5 } }],
        seed: 5,
        builtAt: '2026-01-01T10:00:00.000Z',
      }),
    });
    const button = await screen.findByTestId('cluster-export');
    expect(button.getAttribute('aria-label')).toContain('alpha, beta');
    fireEvent.click(button);
    expect(JSON.parse(screen.getByTestId('export-probe').textContent!)).toEqual({ clusters: [{ id: 'c0', label: 'alpha, beta' }], name: 'alpha, beta' });
  });
});

describe('Explore', () => {
  const nodes: Record<string, any> = {
    '': { nodes: [{ id: 't1', label: 'Macro', kind: 'topic', count: 9, hasChildren: true }], path: [] },
    t1: { nodes: [{ id: 't2', label: 'Micro', kind: 'topic', count: 4, hasChildren: false }], path: [{ id: 't1', label: 'Macro' }] },
    '@author': { nodes: [{ id: 'author:x', label: 'Author X', kind: 'author', count: 2, hasChildren: false }], path: [] },
  };

  it('zooms down, keeps the selection when going back and switches dimension from a node', async () => {
    await mount(createElement(Explore, { selectedDoc: null, onOpenDoc: () => undefined }), {
      'explore:level': (p: any) => (p.dimension === 'author' ? nodes['@author'] : nodes[p.parentId ?? '']),
      'explore:documents': () => ({ docIds: [], total: 0 }),
      'explore:related': () => ({ nodes: [{ id: 'author:x', label: 'Author X', kind: 'author', count: 2, hasChildren: false, score: 0.8, path: [{ id: 'author:x', label: 'Author X' }] }] }),
    });
    fireEvent.click(screen.getByTestId('explore-node'));
    fireEvent.click(screen.getByTestId('explore-zoom'));
    await settle();
    expect(screen.getByTestId('explore-panel').getAttribute('data-depth')).toBe('1');
    fireEvent.click(screen.getByTestId('explore-back'));
    await settle();
    expect(screen.getByTestId('explore-panel').getAttribute('data-depth')).toBe('0');
    expect(screen.getByTestId('explore-node').getAttribute('aria-pressed')).toBe('true');
    // related: topic -> authors, then back to the start
    fireEvent.click(screen.getByTestId('explore-related-author'));
    await waitFor(() => expect(screen.getByTestId('explore-related')).toBeTruthy());
    fireEvent.click(screen.getByTestId('related-node'));
    await settle();
    expect(screen.getByTestId('explore-panel').getAttribute('data-dim')).toBe('author');
    fireEvent.click(screen.getByTestId('explore-back'));
    await settle();
    expect(screen.getByTestId('explore-panel').getAttribute('data-dim')).toBe('topic');
    expect(screen.getByTestId('explore-node').getAttribute('aria-pressed')).toBe('true');
  });
});
