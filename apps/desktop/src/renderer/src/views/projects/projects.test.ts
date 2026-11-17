// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider } from '../../lib/aiUi';
import { LibraryEventsProvider } from '../../lib/events';
import { parseBlocks, renderBlocks } from '../../lib/markdown';
import { NotifyProvider } from '../../lib/notify';
import { AppProvider } from '../../state/app-context';
import { ExportProbe } from '../../testing/exportProbe';
import { makeDocs, memoryLibrary } from '../../testing/memoryLibrary';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { moveItem, notInPlan, planProgress, sortPlan, toRequestItems, type PlanItemView } from './readingPlan';
import { ProjectsView } from './ProjectsView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const item = (docId: string, order: number, over: Partial<PlanItemView> = {}): PlanItemView => ({ docId, order, studyState: null, title: docId, missing: false, ...over });

describe('reading plan logic', () => {
  it('moves and renumbers', () => {
    const plan = [item('a', 0), item('b', 1), item('c', 2)];
    expect(moveItem(plan, 0, 2).map((i) => `${i.docId}${i.order}`)).toEqual(['b0', 'c1', 'a2']);
    expect(moveItem(plan, 2, 0).map((i) => i.docId)).toEqual(['c', 'a', 'b']);
    expect(moveItem(plan, 1, 99).map((i) => i.docId)).toEqual(['a', 'c', 'b']);
    expect(sortPlan([item('x', 5), item('y', 1)]).map((i) => i.docId)).toEqual(['y', 'x']);
  });
  it('builds the request without view-only fields and finds members missing from the plan', () => {
    const body = toRequestItems([item('a', 7, { status: 'read', studyState: 'read' }), item('b', 9)]);
    expect(body).toEqual([
      { docId: 'a', order: 0 },
      { docId: 'b', order: 1 },
    ]);
    const members = [{ docId: 'a' }, { docId: 'z' }] as never;
    expect(notInPlan(members, [item('a', 0)]).map((m) => m.docId)).toEqual(['z']);
    expect(planProgress([item('a', 0, { status: 'read', studyState: 'read' }), item('b', 1, { studyState: 'reading' }), item('c', 2, { status: 'read' })])).toEqual({ total: 3, read: 1, reading: 1, 'to-read': 1 });
  });
});

describe('markdown', () => {
  const html = (src: string) => {
    const { container } = render(createElement('div', null, renderBlocks(parseBlocks(src))));
    return container;
  };
  afterEach(() => cleanup());
  it('renders structure', () => {
    const c = html('# Title\n\nSome **bold** and *it* and `code`.\n\n- one\n  - nested\n- two\n\n1. first\n\n> quote');
    expect(c.querySelector('h2')?.textContent).toBe('Title');
    expect(c.querySelector('strong')?.textContent).toBe('bold');
    expect(c.querySelector('em')?.textContent).toBe('it');
    expect(c.querySelector('p code')?.textContent).toBe('code');
    expect(c.querySelectorAll('ul li').length).toBe(3);
    expect(c.querySelector('ul ul li')?.textContent).toBe('nested');
    expect(c.querySelector('ol li')?.textContent).toBe('first');
    expect(c.querySelector('blockquote')?.textContent).toBe('quote');
  });
  it('never produces raw HTML or unsafe links', () => {
    const c = html('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [ok](https://example.org/a) ![pic](http://x/y.png)');
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('<script>alert(1)</script>');
    const anchors = [...c.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['https://example.org/a']);
    expect(anchors[0]?.getAttribute('rel')).toContain('noopener');
  });
  it('survives a huge line', () => {
    const t = Date.now();
    html('*a* '.repeat(3000));
    html('x'.repeat(200_000));
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

function setup(init: Parameters<typeof memoryLibrary>[0] = {}, override: Record<string, (p: any) => unknown> = {}) {
  const lib = memoryLibrary({ docs: makeDocs(4), ...init });
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...lib.handlers, ...override });
  render(createElement(AppProvider, null, createElement(LibraryEventsProvider, null, createElement(NotifyProvider, null, createElement(AiUiProvider, null, createElement(ProjectsView), createElement(ExportProbe))))));
  return lib;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('ProjectsView', () => {
  it('creates a project, lists it with the reading summary, archives and restores it', async () => {
    const lib = setup({ projects: [{ id: 'p1', kind: 'project', name: 'Thesis', description: '', notes: '', status: 'active', revision: 0, members: [{ docId: makeDocs(4)[0]!.docId, addedAt: '' }, { docId: makeDocs(4)[1]!.docId, addedAt: '' }], plan: [] }] });
    const row = await screen.findByTestId('project-row');
    expect(row.textContent).toContain('Thesis');
    expect(within(row).getByTestId('project-summary').textContent).toContain('2 documents: 1 to read, 1 reading, 0 read');

    fireEvent.change(screen.getByTestId('project-create-name'), { target: { value: 'Reading group' } });
    fireEvent.click(screen.getByTestId('project-kind-collection'));
    fireEvent.click(screen.getByTestId('project-create'));
    await screen.findByTestId('project-detail');
    expect(lib.state.projects.map((p) => [p.name, p.kind])).toContainEqual(['Reading group', 'collection']);
    fireEvent.click(screen.getByTestId('project-back'));

    const rows = await screen.findAllByTestId('project-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows.find((r) => r.textContent?.includes('Thesis'))!).getByTestId('project-archive'));
    await waitFor(() => expect(screen.queryAllByTestId('project-row')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('show-archived'));
    await waitFor(() => expect(screen.getAllByTestId('project-row')).toHaveLength(2));
    const archived = screen.getAllByTestId('project-row');
    fireEvent.click(within(archived.find((r) => r.dataset.status === 'archived')!).getByTestId('project-restore'));
    await waitFor(() => expect(lib.state.projects.find((p) => p.id === 'p1')?.status).toBe('active'));
  });

  it('shows members from different folders with their state, saves notes and renders them safely', async () => {
    const docs = makeDocs(3);
    const lib = setup({ docs, projects: [{ id: 'p1', kind: 'project', name: 'Mix', description: '', notes: '', status: 'active', revision: 0, members: docs.map((d) => ({ docId: d.docId, addedAt: '' })), plan: [] }] });
    fireEvent.click(await screen.findByTestId('project-open'));
    const rows = await screen.findAllByTestId('member-row');
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.querySelector('.result-path')?.textContent?.split('/')[0])).size).toBe(3);
    expect(within(rows[1]!).getByTestId('member-state')).toHaveProperty('value', 'reading');

    fireEvent.click(screen.getByTestId('project-tab-notes'));
    fireEvent.change(await screen.findByTestId('notes-input'), { target: { value: '# Plan\n\n<img src=x onerror=alert(1)> **now**' } });
    await waitFor(() => expect(screen.getByTestId('notes-preview').querySelector('strong')?.textContent).toBe('now'));
    expect(screen.getByTestId('notes-preview').querySelector('img')).toBeNull();
    fireEvent.click(screen.getByTestId('notes-save'));
    await waitFor(() => expect(lib.state.projects[0]?.notes).toContain('# Plan'));
    expect(callsTo('projects:update').at(-1)).toMatchObject({ id: 'p1', expectedRevision: 0 });
  });

  it('reorders the reading plan with the buttons and the keyboard and sets a state per item', async () => {
    const docs = makeDocs(3);
    const lib = setup({
      docs,
      projects: [{ id: 'p1', kind: 'project', name: 'Plan', description: '', notes: '', status: 'active', revision: 0, members: docs.map((d) => ({ docId: d.docId, addedAt: '' })), plan: [{ docId: docs[0]!.docId, order: 0 }, { docId: docs[1]!.docId, order: 1 }] }],
    });
    fireEvent.click(await screen.findByTestId('project-open'));
    fireEvent.click(await screen.findByTestId('project-tab-plan'));
    let items = await screen.findAllByTestId('plan-item');
    expect(items.map((i) => i.dataset.planDoc)).toEqual([docs[0]!.docId, docs[1]!.docId]);

    fireEvent.click(within(items[0]!).getByTestId('plan-down'));
    await waitFor(() => expect(lib.state.projects[0]?.plan.map((i) => i.docId)).toEqual([docs[1]!.docId, docs[0]!.docId]));
    items = await screen.findAllByTestId('plan-item');
    expect(items[0]!.dataset.planDoc).toBe(docs[1]!.docId);

    fireEvent.keyDown(items[1]!, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(lib.state.projects[0]?.plan.map((i) => i.docId)).toEqual([docs[0]!.docId, docs[1]!.docId]));

    items = await screen.findAllByTestId('plan-item');
    fireEvent.change(within(items[0]!).getByTestId('plan-status'), { target: { value: 'read' } });
    // The state of an item is its document's: the document is updated, the plan keeps no state of its own.
    await waitFor(() => expect(lib.state.docs.find((d) => d.docId === docs[0]!.docId)?.studyState).toBe('read'));
    expect(callsTo('documents:update').at(-1)).toMatchObject({ docId: docs[0]!.docId, patch: { studyState: 'read' } });
    expect(lib.state.projects[0]?.plan[0]).not.toHaveProperty('status');
    await waitFor(() => expect(screen.getByTestId('plan-progress').textContent).toContain('1 read'));
    expect(screen.getByTestId('project-counts').textContent).toContain('1 read');

    fireEvent.click(screen.getByTestId('plan-add-all'));
    await waitFor(() => expect(lib.state.projects[0]?.plan).toHaveLength(3));
    expect(callsTo('projects:setReadingPlan').every((c) => typeof c.expectedRevision === 'number')).toBe(true);
  });

  const twoDocs = () => {
    const docs = makeDocs(3);
    return { docs, projects: [{ id: 'p1', kind: 'project' as const, name: 'Plan', description: '', notes: '', status: 'active' as const, revision: 0, members: [docs[0]!, docs[1]!].map((d) => ({ docId: d.docId, addedAt: '' })), plan: [{ docId: docs[0]!.docId, order: 0 }] }] };
  };

  it('follows library:changed for its own members and its own id, and ignores the rest', async () => {
    const init = twoDocs();
    const lib = setup(init);
    fireEvent.click(await screen.findByTestId('project-open'));
    const states = async () => (await screen.findAllByTestId('member-state')).map((s) => (s as HTMLSelectElement).value);
    expect(await states()).toEqual(['to-read', 'reading']);
    const gets = () => callsTo('projects:get').length;

    // A document that is not a member: no reload.
    lib.state.docs[2]!.studyState = 'read';
    await new Promise((r) => setTimeout(r, 30));
    const before = gets();
    emitEvent('library:changed', { kind: 'documents', ids: [init.docs[2]!.docId] });
    emitEvent('library:changed', { kind: 'projects', ids: ['other'] });
    await new Promise((r) => setTimeout(r, 30));
    expect(gets()).toBe(before);

    // A member changed behind the view's back (a scan, the document panel).
    lib.state.docs[0]!.studyState = 'read';
    emitEvent('library:changed', { kind: 'documents', ids: [init.docs[0]!.docId] });
    await waitFor(async () => expect(await states()).toEqual(['read', 'reading']));

    lib.state.docs[1]!.studyState = 'read';
    emitEvent('library:changed', { kind: 'projects', ids: ['p1'] });
    await waitFor(async () => expect(await states()).toEqual(['read', 'read']));
  });

  it('reports "removed" only when the write succeeded', async () => {
    const init = twoDocs();
    let fail = true;
    let lib: ReturnType<typeof setup>;
    lib = setup(init, { 'projects:removeMembers': (p: any) => { if (fail) throw new AppError('INTERNAL', 'boom'); return lib.handlers['projects:removeMembers']!(p); } });
    fireEvent.click(await screen.findByTestId('project-open'));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    fireEvent.click(screen.getByTestId('members-remove'));
    fireEvent.click(screen.getByTestId('members-remove-confirm'));
    await screen.findAllByTestId('toast');
    expect(screen.getAllByTestId('toast').every((t) => t.dataset.kind === 'error')).toBe(true);
    expect(screen.queryByText(/removed from the project/)).toBeNull();
    fail = false;
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    fireEvent.click(screen.getByTestId('members-remove'));
    fireEvent.click(screen.getByTestId('members-remove-confirm'));
    await screen.findByText(/removed from the project/);
  });
});

describe('ProjectDetailView: second-brain export', () => {
  it('starts the export from the project page with the project and its name', async () => {
    setup({ projects: [{ id: 'p1', kind: 'project', name: 'Thesis', description: '', notes: '', status: 'active', revision: 0, members: [], plan: [] }] });
    fireEvent.click(await screen.findByTestId('project-open'));
    fireEvent.click(await screen.findByTestId('project-export'));
    expect(JSON.parse(screen.getByTestId('export-probe').textContent!)).toEqual({ projectId: 'p1', name: 'Thesis' });
  });
});
