import { describe, expect, it } from 'vitest';
import { documentRecordSchema, type AiField, type DocumentRecord, type SearchResultHit, type ToolSpec } from '@rl/core';
import { createLibraryTools, folderOf, inEnabledFolder, TOOL_LIMITS, type AiFieldName, type AiFieldValue, type LibraryToolsHost, type ToolNote, type ToolResult } from './tools.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const rec = (n: number, over: Record<string, unknown> = {}): DocumentRecord =>
  documentRecordSchema.parse({ id: hex(n), hash: 'ab'.repeat(32), path: `open/p${n}.pdf`, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: `Paper ${n}`, year: 2020, ...over });

function setup(opts: { enabled?: string[]; docs?: DocumentRecord[]; notes?: Record<string, ToolNote[]> } = {}) {
  const docs = new Map((opts.docs ?? [rec(1), rec(2, { path: 'closed/p2.pdf' }), rec(3, { path: 'open/sub/p3.pdf' })]).map((d) => [d.id, d]));
  const sends: Array<Parameters<LibraryToolsHost['logSend']>[0]> = [];
  const writes: Array<{ docId: string; field: AiFieldName; value: AiField<AiFieldValue> }> = [];
  let enabled = opts.enabled ?? ['open'];
  const host: LibraryToolsHost = {
    enabledFolders: async () => enabled,
    search: async () => ({
      total: docs.size,
      hits: [...docs.values()].map(
        (d) => ({ docId: d.id, score: 1, field: 'text', snippet: '\u0001match\u0002 here', page: 2, pages: [{ page: 2, snippet: '\u0001match\u0002 here' }], title: d.title, authors: ['A. One'], year: d.year, type: null, path: d.path, studyState: 'to-read', size: 1, tags: [] }) as SearchResultHit,
      ),
    }),
    getDocument: async (id) => docs.get(id) ?? null,
    pageTexts: async (_d, pages) => pages.map((p) => ({ page: p, text: 'x'.repeat(p === 1 ? 50_000 : 10) })),
    listNotes: async (id) => opts.notes?.[id] ?? [],
    writeAiField: async (docId, field, value) => void writes.push({ docId, field, value }),
    logSend: async (e) => void sends.push(e),
    now: () => new Date(NOW),
  };
  const tools = createLibraryTools({ host, model: 'claude-haiku-5-5', provider: 'mock' });
  const by = (name: string): ToolSpec => tools.find((t) => t.name === name)!;
  const run = async (name: string, input: unknown) => (await by(name).run(input, {})) as ToolResult;
  return { tools, run, sends, writes, setEnabled: (f: string[]) => void (enabled = f) };
}

describe('folder rules', () => {
  it('matches folders and sub-folders only on separators', () => {
    expect(folderOf('a/b/c.pdf')).toBe('a/b');
    expect(folderOf('c.pdf')).toBe('');
    expect(inEnabledFolder('open/p.pdf', ['open'])).toBe(true);
    expect(inEnabledFolder('open/sub/p.pdf', ['open/'])).toBe(true);
    expect(inEnabledFolder('opened/p.pdf', ['open'])).toBe(false);
    expect(inEnabledFolder('any/p.pdf', [''])).toBe(true);
    expect(inEnabledFolder('any/p.pdf', [])).toBe(false);
  });

  it('spellings of one folder are one folder; a climbing path and a different case never match', () => {
    for (const f of ['x', './x', 'x/', 'x//', 'x/.', './x/./']) {
      expect(inEnabledFolder('x/p.pdf', [f])).toBe(true);
      expect(inEnabledFolder('x/sub/p.pdf', [f])).toBe(true);
      expect(inEnabledFolder('xy/p.pdf', [f])).toBe(false);
      expect(inEnabledFolder('p.pdf', [f])).toBe(false);
    }
    // The path of a record is read the same way.
    expect(inEnabledFolder('./x//p.pdf', ['x'])).toBe(true);
    // './' and './.' are the root itself, not the whole library.
    for (const f of ['.', './', './.']) {
      expect(inEnabledFolder('p.pdf', [f])).toBe(true);
      expect(inEnabledFolder('x/p.pdf', [f])).toBe(false);
    }
    // '..' is never a way in; case fails closed (a folder the user did not mean is not opened).
    expect(inEnabledFolder('y/p.pdf', ['x/../y'])).toBe(false);
    expect(inEnabledFolder('p.pdf', ['..'])).toBe(false);
    expect(inEnabledFolder('Papers/p.pdf', ['papers'])).toBe(false);
    // A composed and a decomposed accent are the same folder name.
    expect(inEnabledFolder('café/p.pdf', ['café'])).toBe(true);
    expect(inEnabledFolder('café/p.pdf', ['café'])).toBe(true);
  });

  it("'.' enables only the files directly in the root", () => {
    expect(inEnabledFolder('p.pdf', ['.'])).toBe(true);
    expect(inEnabledFolder('open/p.pdf', ['.'])).toBe(false);
    expect(inEnabledFolder('open/p.pdf', ['.', 'open'])).toBe(true);
  });
});

describe('library tools: privacy gate', () => {
  it('offers exactly the documented tools and only one writes', () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual(['search_library', 'get_document', 'read_pages', 'list_notes', 'read_note', 'write_ai_field']);
    expect(tools.filter((t) => t.writes).map((t) => t.name)).toEqual(['write_ai_field']);
  });

  it('refuses every content read of a document outside the enabled folders, and logs nothing', async () => {
    const { run, sends } = setup();
    const id = hex(2);
    for (const [name, input] of [['get_document', { docId: id }], ['read_pages', { docId: id, pages: [1] }], ['list_notes', { docId: id }], ['read_note', { docId: id }], ['write_ai_field', { docId: id, field: 'summary', text: 'x' }]] as const) {
      await expect(run(name, input)).rejects.toMatchObject({ code: 'FOLDER_NOT_AI_ENABLED' });
    }
    expect(sends).toEqual([]);
  });

  it('refuses everything when no folder is enabled', async () => {
    const { run } = setup({ enabled: [] });
    await expect(run('search_library', { query: 'a' })).rejects.toMatchObject({ code: 'FOLDER_NOT_AI_ENABLED' });
    await expect(run('get_document', { docId: hex(1) })).rejects.toMatchObject({ code: 'FOLDER_NOT_AI_ENABLED' });
  });

  it('search drops hits of other folders, strips markers and logs only what it returns', async () => {
    const { run, sends } = setup();
    const r = await run('search_library', { query: 'match' });
    expect(r.docIds.sort()).toEqual([hex(1), hex(3)]);
    expect(JSON.stringify(r.data)).not.toMatch(/[\u0001\u0002]/);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ docIds: [hex(1), hex(3)], folders: ['open', 'open/sub'], purpose: 'chat:tool:search_library' });
    expect(sends[0]!.approxInputTokens).toBeGreaterThan(0);
  });

  it('follows a change of the enabled folders made during the chat', async () => {
    const { run, setEnabled } = setup();
    await run('get_document', { docId: hex(1) });
    setEnabled(['closed']);
    await expect(run('get_document', { docId: hex(1) })).rejects.toMatchObject({ code: 'FOLDER_NOT_AI_ENABLED' });
  });

  it('unknown documents are NOT_FOUND', async () => {
    const { run } = setup();
    await expect(run('get_document', { docId: hex(99) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('library tools: reads', () => {
  it('get_document shows card, tags, AI fields with status and the notes list; logs one send', async () => {
    const withAi = rec(1, { tags: ['t1'], ai: { summary: { value: 'S', meta: { model: 'm', provider: 'mock', date: NOW, source: 'chat' }, review: { status: 'accepted' } } } });
    const { run, sends } = setup({ docs: [withAi], notes: { [hex(1)]: [{ page: null, body: 'private', updatedAt: NOW }] } });
    const r = await run('get_document', { docId: hex(1) });
    const d = r.data as any;
    expect(d.title).toBe('Paper 1');
    expect(d.tags).toEqual([{ id: 't1', label: 't1' }]);
    expect(d.ai.summary.status).toBe('accepted');
    expect(d.notes).toEqual([{ page: null, updatedAt: NOW }]);
    expect(JSON.stringify(d)).not.toContain('private'); // the list has no bodies
    expect(sends).toEqual([expect.objectContaining({ docIds: [hex(1)], folders: ['open'], purpose: 'chat:tool:get_document' })]);
  });

  it('read_pages caps each page and the whole call, and rejects too many pages', async () => {
    const { run } = setup();
    const r = (await run('read_pages', { docId: hex(1), pages: [1, 2] })).data as any;
    expect(r.pages[0].text).toHaveLength(TOOL_LIMITS.pageChars);
    expect(r.truncated).toBe(true);
    await expect(run('read_pages', { docId: hex(1), pages: Array.from({ length: 11 }, (_, i) => i + 1) })).rejects.toThrow();
  });

  it('notes are read only: list gives excerpts, read gives the body', async () => {
    const { run, tools } = setup({ notes: { [hex(1)]: [{ page: null, body: 'a'.repeat(500), updatedAt: NOW }, { page: 4, body: 'page note', updatedAt: NOW }] } });
    const list = (await run('list_notes', { docId: hex(1) })).data as any;
    expect(list.items[0].excerpt.length).toBeLessThanOrEqual(TOOL_LIMITS.noteExcerpt + 1);
    expect(((await run('read_note', { docId: hex(1), page: 4 })).data as any).body).toBe('page note');
    await expect(run('read_note', { docId: hex(1), page: 9 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tools.find((t) => t.name === 'read_note')!.writes).toBe(false);
  });
});

describe('write_ai_field', () => {
  it('writes an AI field with meta and status proposed, nothing else', async () => {
    const { run, writes } = setup();
    const r = await run('write_ai_field', { docId: hex(1), field: 'keywords', items: ['a', 'b', 'a'] });
    expect(writes).toEqual([
      { docId: hex(1), field: 'keywords', value: { value: ['a', 'b'], meta: { model: 'claude-haiku-5-5', provider: 'mock', date: NOW, source: 'chat' }, review: { status: 'proposed' } } },
    ]);
    expect(r.summary).toMatch(/proposed/);
  });

  it('accepts only the five AI fields and the matching payload', async () => {
    const { run, writes } = setup();
    await expect(run('write_ai_field', { docId: hex(1), field: 'title', text: 'x' })).rejects.toThrow();
    await expect(run('write_ai_field', { docId: hex(1), field: 'tags', items: ['x'] })).rejects.toThrow();
    await expect(run('write_ai_field', { docId: hex(1), field: 'summary' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(run('write_ai_field', { docId: hex(1), field: 'keywords', text: 'x' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(writes).toEqual([]);
  });

  it('checks the targets of relations', async () => {
    const { run, writes } = setup();
    await expect(run('write_ai_field', { docId: hex(1), field: 'relations', relations: [{ docId: hex(1), reason: 'self' }] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(run('write_ai_field', { docId: hex(1), field: 'relations', relations: [{ docId: hex(77), reason: 'x' }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await run('write_ai_field', { docId: hex(1), field: 'relations', relations: [{ docId: hex(3), reason: 'same method' }] });
    expect(writes).toHaveLength(1);
  });

  it('a related document in a folder not enabled is reported exactly like an unknown one (no existence oracle)', async () => {
    const { run, writes } = setup();
    const err = async (id: string) => run('write_ai_field', { docId: hex(1), field: 'relations', relations: [{ docId: id, reason: 'x' }] }).catch((e: any) => e);
    const closed = await err(hex(2));
    const unknown = await err(hex(77));
    expect(closed.code).toBe('NOT_FOUND');
    expect(unknown.code).toBe('NOT_FOUND');
    expect(closed.message.replace(hex(2), 'ID')).toBe(unknown.message.replace(hex(77), 'ID'));
    expect(writes).toEqual([]);
  });

  it('does not overwrite what the user accepted, edited or rejected, but replaces a proposed one', async () => {
    const field = (status: string) => ({ value: 'old', meta: { model: 'm', provider: 'mock', date: NOW, source: 'chat' }, review: { status } });
    for (const [status, ok] of [['accepted', false], ['edited', false], ['proposed', true], ['rejected', false]] as const) {
      const { run, writes } = setup({ docs: [rec(1, { ai: { summary: field(status) } })] });
      const p = run('write_ai_field', { docId: hex(1), field: 'summary', text: 'new' });
      if (ok) await p;
      else await expect(p).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(writes).toHaveLength(ok ? 1 : 0);
    }
  });
});
