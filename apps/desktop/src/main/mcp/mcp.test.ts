import http from 'node:http';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPatch, channels, citationFileSchema, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, libraryConfigSchema, projectSchema, type IpcEnvelope, type SecretScope } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { reconcileMcp, stopMcp } from './service.js';

const NOW = '2026-01-02T03:04:05.000Z';
const ID_OPEN = '0000000000000001';
const ID_OPEN2 = '0000000000000003';
const ID_PRIVATE = '0000000000000002';
const rec = (id: string, p: string, title: string, extra: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id, hash: id.padEnd(64, 'a'), path: p, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title, year: 2020, authors: ['Quillon, Wren'], ...extra });

let root: string;
let local: string;
let store: FileLibraryStore;
let active: string | null;
let secrets: Map<string, string>;
let clip: string[];
let events: Array<{ channel: string; payload: any }>;
let services: MainServices;
let call: (c: string, p?: unknown) => Promise<IpcEnvelope>;
const blockers: net.Server[] = [];

const key = (scope: SecretScope, name: string) => (scope.kind === 'app' ? `app/${name}` : `lib:${scope.libraryId}/${name}`);

function harness() {
  const rt = {
    libraryId: 'lib-1',
    store,
    search: async () => ({
      total: 2,
      hits: [rec(ID_OPEN, 'open/a.pdf', 'Open paper about graphs'), rec(ID_PRIVATE, 'private/b.pdf', 'Private paper about graphs')].map((d) => ({ docId: d.id, path: d.path, title: d.title, authors: d.authors, year: d.year, snippet: 'about graphs', score: 1 })),
    }),
    reindexDocuments: async () => {},
    textCacheDir: path.join(local, 'cache', 'text'),
  };
  const log = createMemoryLogger();
  services = {
    log,
    localDataDir: local,
    emit: (channel: string, payload: unknown) => events.push({ channel, payload }),
    runtime: {
      sync: async () => {},
      hold: () => () => {},
      status: () => ({}),
      require: async (id?: string) => {
        if (id !== undefined && id !== active) throw Object.assign(new Error('not active'), { name: 'AppError', code: 'LIBRARY_NOT_ACTIVE' });
        return rt;
      },
    },
    settings: { get: async () => ({ deviceId: 'device-12345678' }) },
    libraries: {
      list: async () => ({ profiles: [], activeLibraryId: active }),
      profile: async () => ({ rootPath: root }),
      getConfig: async () => store.readConfig(),
      setConfig: async (patch: unknown) => {
        const next = libraryConfigSchema.parse(applyPatch(await store.readConfig(), patch));
        await store.writeConfig(next);
        return next;
      },
    },
    secrets: {
      get: async (sc: SecretScope, n: string) => secrets.get(key(sc, n)) ?? null,
      set: async (sc: SecretScope, n: string, v: string) => void secrets.set(key(sc, n), v),
    },
    clipboard: { writeText: (t: string) => void clip.push(t) },
    appInfo: () => ({ name: 'x', version: '1.2.3', platform: 'test', electron: '0' }),
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  call = (c, p = {}) => dispatch(c, p);
}

const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const tokenOf = () => [...secrets.entries()].find(([k]) => k.endsWith('/mcp-token'))![1];

interface Reply {
  status: number;
  json: any;
}
/** One POST with exactly the headers given (no Host or Origin of its own), so that the refusals can be provoked. */
function post(port: number, body: unknown, headers: Record<string, string> = {}, o: { method?: string } = {}): Promise<Reply> {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: o.method ?? 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}
const auth = () => ({ Authorization: `Bearer ${tokenOf()}` });
let rpcId = 0;
const rpc = (port: number, method: string, params?: unknown, headers: Record<string, string> = auth()) => post(port, { jsonrpc: '2.0', id: ++rpcId, method, params }, headers);
const tool = async (port: number, name: string, args: unknown) => {
  const r = await rpc(port, 'tools/call', { name, arguments: args });
  if (r.json.error) return { rpcError: r.json.error as { message: string } };
  const text = r.json.result.content[0].text as string;
  return { isError: r.json.result.isError === true, body: JSON.parse(text) as any };
};

async function enable(): Promise<number> {
  const st = ok(await call('mcp:setEnabled', { enabled: true }));
  expect(st).toMatchObject({ enabled: true, running: true });
  return st.port as number;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-mcp-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-mcp-local-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeConfig({ ...defaultLibraryConfig(), name: 'My Test Library', aiEnabledFolders: ['open'] });
  await store.documents.put(rec(ID_OPEN, 'open/a.pdf', 'Open paper about graphs'));
  await store.documents.put(rec(ID_OPEN2, 'open/c.pdf', 'Second open paper'));
  await store.documents.put(rec(ID_PRIVATE, 'private/b.pdf', 'Private paper about graphs'));
  active = 'lib-1';
  secrets = new Map();
  clip = [];
  events = [];
  harness();
});
afterEach(async () => {
  await stopMcp(services);
  await Promise.all(blockers.splice(0).map((b) => new Promise<void>((r) => b.close(() => r()))));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(local, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('the server over HTTP', () => {
  it('answers initialize and tools/list with the token, and refuses a missing or wrong token, a foreign Origin and a wrong Host', async () => {
    const port = await enable();
    const init = await rpc(port, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo).toEqual({ name: 'research-lab-my-test-library', version: '1.2.3' });
    const list = await rpc(port, 'tools/list');
    const names = list.json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['search_library', 'get_document', 'read_pages', 'list_notes', 'read_note', 'list_highlights', 'similar_documents', 'citations', 'list_projects', 'get_project', 'read_next']);
    expect(names).not.toContain('write_ai_field');

    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await post(port, body, {})).status).toBe(401);
    expect((await post(port, body, { Authorization: 'Bearer wrong-token-value' })).status).toBe(401);
    expect((await post(port, body, { ...auth(), Origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(port, body, { ...auth(), Host: 'evil.example:80' })).status).toBe(403);
    expect((await post(port, body, { ...auth(), Host: `127.0.0.1:${port + 1}` })).status).toBe(403);
    expect((await post(port, body, auth(), { method: 'GET' })).status).toBe(405);
  });

  it('search, card and page tools see only documents of AI-enabled folders, re-read at each call', async () => {
    const port = await enable();
    const found = await tool(port, 'search_library', { query: 'graphs' });
    expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([ID_OPEN]);
    const card = await tool(port, 'get_document', { docId: ID_OPEN });
    expect(card.body).toMatchObject({ id: ID_OPEN, title: 'Open paper about graphs' });
    const refused = await tool(port, 'get_document', { docId: ID_PRIVATE });
    expect(refused).toMatchObject({ isError: true, body: { code: 'FOLDER_NOT_AI_ENABLED' } });
    expect((await tool(port, 'read_pages', { docId: ID_PRIVATE, pages: [1] })).body.code).toBe('FOLDER_NOT_AI_ENABLED');
    expect((await tool(port, 'list_highlights', { docId: ID_PRIVATE })).body.code).toBe('FOLDER_NOT_AI_ENABLED');
    expect((await tool(port, 'list_highlights', { docId: ID_OPEN })).body.items).toEqual([]);
    // The user enables the other folder while the server runs: the next call sees it.
    await services.libraries.setConfig({ aiEnabledFolders: ['open', 'private'] } as never, 'lib-1');
    expect((await tool(port, 'get_document', { docId: ID_PRIVATE })).isError).toBe(false);
    await services.libraries.setConfig({ aiEnabledFolders: [] } as never, 'lib-1');
    expect((await tool(port, 'search_library', { query: 'graphs' })).body.code).toBe('FOLDER_NOT_AI_ENABLED');
  });

  it('neighbours, citations, projects and read-next never name a document outside the enabled folders', async () => {
    const link = (matchedDocId: string | null, title: string) => ({ title, authors: [], matchedDocId, source: 'manual', checkedAt: NOW });
    await store.citations.put(citationFileSchema.parse({ schemaVersion: 1, docId: ID_OPEN, references: [link(ID_OPEN2, 'Second open paper'), link(ID_PRIVATE, 'Private paper about graphs'), link(null, 'An outside work')], citedBy: [] }));
    await store.projects.put(
      projectSchema.parse({ schemaVersion: 1, id: 'proj', name: 'A project', createdAt: NOW, updatedAt: NOW, members: [{ docId: ID_OPEN, addedAt: NOW }, { docId: ID_PRIVATE, addedAt: NOW }], notes: 'secret user notes' }),
    );
    const port = await enable();

    const cites = await tool(port, 'citations', { docId: ID_OPEN, direction: 'references' });
    const refs = cites.body.references as Array<{ id?: string; title: string; inLibrary: boolean }>;
    expect(refs.map((r) => r.id ?? null)).toEqual([ID_OPEN2, null, null]);
    expect(refs[1]).toMatchObject({ inLibrary: false });
    expect(JSON.stringify(cites.body)).not.toContain(ID_PRIVATE);
    expect((await tool(port, 'citations', { docId: ID_PRIVATE })).body.code).toBe('FOLDER_NOT_AI_ENABLED');

    const near = await tool(port, 'similar_documents', { docId: ID_OPEN, limit: 5 });
    expect(near.isError).toBe(false);
    expect(JSON.stringify(near.body)).not.toContain(ID_PRIVATE);
    expect((await tool(port, 'similar_documents', { docId: ID_PRIVATE })).body.code).toBe('FOLDER_NOT_AI_ENABLED');

    expect((await tool(port, 'list_projects', {})).body.items).toEqual([expect.objectContaining({ id: 'proj', documents: 1 })]);
    const proj = await tool(port, 'get_project', { projectId: 'proj' });
    expect(proj.body.documents.map((d: { id: string }) => d.id)).toEqual([ID_OPEN]);
    expect(JSON.stringify(proj.body)).not.toContain('secret user notes');
    expect((await tool(port, 'read_next', { minCiting: 1 })).isError).toBe(false);
  });

  it('read_next counts and names only citing documents of enabled folders', async () => {
    const work = { title: 'A cited work', authors: [], doi: '10.1000/xyz', matchedDocId: null, source: 'manual', checkedAt: NOW };
    for (const id of [ID_OPEN, ID_PRIVATE]) await store.citations.put(citationFileSchema.parse({ schemaVersion: 1, docId: id, references: [work], citedBy: [] }));
    const port = await enable();
    expect((await tool(port, 'read_next', { minCiting: 2 })).body.items).toEqual([]);
    const one = (await tool(port, 'read_next', { minCiting: 1 })).body;
    expect(one.items).toHaveLength(1);
    expect(one.items[0]).toMatchObject({ citingCount: 1, citing: [{ docId: ID_OPEN }] });
    expect(JSON.stringify(one)).not.toContain(ID_PRIVATE);
  });

  it('write_ai_field is neither listed nor callable until writing is enabled, then only proposes an AI field', async () => {
    const port = await enable();
    const args = { docId: ID_OPEN, field: 'summary', text: 'A proposed summary' };
    expect((await tool(port, 'write_ai_field', args)).rpcError?.message).toBe('Unknown tool');
    ok(await call('mcp:setWriteEnabled', { writeEnabled: true }));
    const names = (await rpc(port, 'tools/list')).json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('write_ai_field');

    expect((await tool(port, 'write_ai_field', { ...args, docId: ID_PRIVATE })).body.code).toBe('FOLDER_NOT_AI_ENABLED');
    const done = await tool(port, 'write_ai_field', args);
    expect(done.body).toEqual({ id: ID_OPEN, field: 'summary', status: 'proposed' });
    const after = (await store.documents.get(ID_OPEN as never))!;
    expect(after.ai.summary).toMatchObject({ value: 'A proposed summary', review: { status: 'proposed' }, meta: { source: 'mcp', model: 'claude-code' } });
    expect(after.title).toBe('Open paper about graphs');
    expect((await store.documents.get(ID_PRIVATE as never))!.ai.summary).toBeUndefined();

    // A field the user already accepted is not overwritten.
    await store.documents.update(ID_OPEN as never, (c) => ({ ...c!, ai: { ...c!.ai, summary: { ...c!.ai.summary!, review: { status: 'accepted' as const } } } }));
    expect((await tool(port, 'write_ai_field', { ...args, text: 'Another' })).body.code).toBe('CONFLICT');

    ok(await call('mcp:setWriteEnabled', { writeEnabled: false }));
    expect((await tool(port, 'write_ai_field', args)).rpcError?.message).toBe('Unknown tool');
  });

  it('keeps a bounded local log of calls without contents', async () => {
    const port = await enable();
    await tool(port, 'search_library', { query: 'graphs' });
    await tool(port, 'get_document', { docId: ID_PRIVATE });
    const log = ok(await call('mcp:log', {}));
    expect(log.total).toBe(2);
    expect(log.items[0]).toMatchObject({ tool: 'get_document', ok: false, code: 'FOLDER_NOT_AI_ENABLED', docIds: [] });
    expect(log.items[1]).toMatchObject({ tool: 'search_library', ok: true, docIds: [ID_OPEN] });
    expect(JSON.stringify(log)).not.toContain('graphs');
    const saved = await readFile(path.join(local, 'mcp', 'lib-1.json'), 'utf8').catch(() => '');
    // Saved at stop; the file never holds the token.
    await stopMcp(services);
    const file = await readFile(path.join(local, 'mcp', 'lib-1.json'), 'utf8');
    expect(saved === '' || !saved.includes(tokenOf())).toBe(true);
    expect(file).not.toContain(tokenOf());
    expect(JSON.parse(file).log).toHaveLength(2);
  });
});

describe('token and configuration', () => {
  it('the token never crosses IPC; copyConfig puts the real line on the clipboard and returns it masked; rotation cuts the old token', async () => {
    expect(fail(await call('mcp:copyConfig', { format: 'cli' }))).toMatchObject({ code: 'CONFLICT', details: { reason: 'not-running' } });
    const port = await enable();
    const token = tokenOf();
    const status = ok(await call('mcp:status'));
    expect(JSON.stringify([status, events])).not.toContain(token);

    const cli = ok(await call('mcp:copyConfig', { format: 'cli' }));
    expect(clip[0]).toBe(`claude mcp add --transport http research-lab-my-test-library http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${token}"`);
    expect(cli.preview).not.toContain(token);
    expect(cli.preview).toContain('Bearer ••');
    const json = ok(await call('mcp:copyConfig', { format: 'json' }));
    expect(JSON.parse(clip[1]!).mcpServers['research-lab-my-test-library']).toEqual({ type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } });
    expect(json.preview).not.toContain(token);

    const before = auth();
    ok(await call('mcp:rotateToken'));
    expect(tokenOf()).not.toBe(token);
    expect((await rpc(port, 'tools/list', undefined, before)).status).toBe(401);
    expect((await rpc(port, 'tools/list')).status).toBe(200);
    expect(ok(await call('mcp:status')).running).toBe(true);
  });
});

describe('lifecycle', () => {
  it('starts only when enabled, stops when disabled, and remembers the port of this computer', async () => {
    expect(ok(await call('mcp:status'))).toMatchObject({ enabled: false, running: false, port: null, url: null, error: null });
    const port = await enable();
    expect(ok(await call('mcp:status'))).toMatchObject({ running: true, port, url: `http://127.0.0.1:${port}/mcp` });
    expect(events.some((e) => e.channel === 'mcp:changed' && e.payload.running === true)).toBe(true);
    expect((await store.readConfig()).mcp.enabled).toBe(true);

    expect(ok(await call('mcp:setEnabled', { enabled: false }))).toMatchObject({ enabled: false, running: false, port });
    await expect(post(port, {}, auth())).rejects.toThrow();
    expect(await enable()).toBe(port);
    // The port lives in the local folder, not in the library folder.
    expect(JSON.parse(await readFile(path.join(local, 'mcp', 'lib-1.json'), 'utf8')).port).toBe(port);
    expect(JSON.stringify(await store.readConfig())).not.toContain(String(port));
  });

  it('a library switch, forgetting the library, and the app quit stop it', async () => {
    const port = await enable();
    active = 'lib-2';
    await store.writeConfig({ ...(await store.readConfig()), mcp: { enabled: false, writeEnabled: false } });
    await reconcileMcp(services);
    await expect(post(port, {}, auth())).rejects.toThrow();
    expect(ok(await call('mcp:status'))).toMatchObject({ running: false });

    active = 'lib-1';
    await store.writeConfig({ ...(await store.readConfig()), mcp: { enabled: true, writeEnabled: false } });
    await reconcileMcp(services);
    const again = ok(await call('mcp:status'));
    expect(again.running).toBe(true);
    active = null;
    await reconcileMcp(services);
    expect(ok(await call('mcp:status'))).toMatchObject({ running: false, enabled: false });

    active = 'lib-1';
    await reconcileMcp(services);
    expect(ok(await call('mcp:status')).running).toBe(true);
    await stopMcp(services);
    expect(ok(await call('mcp:status')).running).toBe(false);
  });

  it('a port in use is a status error, not a crash, and a later free port works', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    blockers.push(blocker);
    const busy = (blocker.address() as net.AddressInfo).port;
    ok(await call('mcp:setPort', { port: busy }));
    const st = ok(await call('mcp:setEnabled', { enabled: true }));
    expect(st).toMatchObject({ enabled: true, running: false, url: null, port: busy, error: { code: 'PORT_IN_USE' } });
    expect(fail(await call('mcp:copyConfig', { format: 'cli' })).code).toBe('CONFLICT');

    // null: a free port is picked and remembered.
    const free = ok(await call('mcp:setPort', { port: null }));
    expect(free).toMatchObject({ running: true, error: null });
    expect(free.port).not.toBe(busy);
    // A running server restarts on the new port.
    const other = new net.Server();
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const target = (other.address() as net.AddressInfo).port;
    await new Promise<void>((r) => other.close(() => r()));
    expect(ok(await call('mcp:setPort', { port: target }))).toMatchObject({ running: true, port: target });
    expect((await rpc(target, 'tools/list')).status).toBe(200);
  });
});
