import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createLibraryTools, type LibraryToolsHost } from '@rl/ai';
import { MCP_LIMITS, documentRecordSchema } from '@rl/core';
import {
  LATEST_PROTOCOL_VERSION,
  MCP_INSTRUCTIONS,
  bearerOk,
  checkRequest,
  cliConfig,
  createCallLog,
  hostAllowed,
  jsonConfig,
  newToken,
  safeEqual,
  serverNameFor,
  startMcpServer,
  toMcpTool,
  type McpTool,
  type RunningMcpServer,
} from './index.js';

const NOW = '2026-01-02T03:04:05.000Z';
const ID_OPEN = '0000000000000001';
const ID_PRIVATE = '0000000000000002';
const rec = (id: string, p: string, title: string) => documentRecordSchema.parse({ id, hash: 'ab'.repeat(32), path: p, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title, year: 2020, authors: ['Quillon, Wren'] });
const docs = new Map([
  [ID_OPEN, rec(ID_OPEN, 'open/a.pdf', 'Open paper about graphs')],
  [ID_PRIVATE, rec(ID_PRIVATE, 'private/b.pdf', 'Private paper about graphs')],
]);
const written: string[] = [];
const host: LibraryToolsHost = {
  enabledFolders: async () => ['open'],
  search: async () => ({
    total: 2,
    hits: [...docs.values()].map((d) => ({ docId: d.id, path: d.path, title: d.title, authors: d.authors, year: d.year, snippet: 'about graphs', score: 1 })) as never,
  }),
  getDocument: async (id) => docs.get(id) ?? null,
  pageTexts: async () => [],
  listNotes: async () => [],
  writeAiField: async (id, f) => void written.push(`${id}:${f}`),
  logSend: async () => {},
};

const TOKEN = newToken();
const specs = createLibraryTools({ host, model: 'm', provider: 'mock', purpose: 'mcp' });
const calls: Array<{ tool: string; ok: boolean; code: string | null; docIds: string[] }> = [];
let running: RunningMcpServer | null = null;

async function start(opts: { write?: boolean; extra?: McpTool[]; bodyBytes?: number; concurrent?: number; timeoutMs?: number } = {}) {
  const tools = [...specs.filter((s) => opts.write || !s.writes).map(toMcpTool), ...(opts.extra ?? [])];
  running = await startMcpServer({
    port: 0,
    token: () => TOKEN,
    bodyBytes: opts.bodyBytes ?? MCP_LIMITS.bodyBytes,
    concurrent: opts.concurrent ?? MCP_LIMITS.concurrent,
    timeoutMs: opts.timeoutMs ?? 5_000,
    rpc: { serverName: 'research-lab-test', serverVersion: '0.0.0', instructions: MCP_INSTRUCTIONS, tools: () => tools, onCall: (r) => calls.push(r) },
  });
  return running;
}
afterEach(async () => {
  await running?.close();
  running = null;
  calls.length = 0;
  written.length = 0;
});

const url = (s: RunningMcpServer) => new URL(`http://127.0.0.1:${s.port}/mcp`);
async function connect(s: RunningMcpServer, token = TOKEN) {
  const client = new Client({ name: 'interop-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url(s), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

/** Raw request (fetch cannot set Host or Origin). */
function raw(s: RunningMcpServer, o: { method?: string; headers?: Record<string, string>; body?: string | Buffer; path?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, path: o.path ?? '/mcp', method: o.method ?? 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...o.headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on('error', reject);
    req.end(o.body);
  });
}
const rpc = (method: string, params: unknown = {}, id: number | undefined = 1) => JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params });

describe('interop with the official client', () => {
  it('initializes, lists tools (read only), searches and opens a card', async () => {
    const s = await start();
    const client = await connect(s);
    expect(client.getServerVersion()).toMatchObject({ name: 'research-lab-test' });
    expect(client.getInstructions()).toContain('DATA');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_document', 'list_notes', 'read_note', 'read_pages', 'search_library']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.find((t) => t.name === 'get_document')!.inputSchema).toMatchObject({ type: 'object', required: ['docId'] });

    const found = await client.callTool({ name: 'search_library', arguments: { query: 'graphs' } });
    const data = JSON.parse((found.content as Array<{ text: string }>)[0]!.text) as { items: Array<{ id: string }> };
    // The folder rule of the in-app agent: the document of the folder that is not enabled does not exist here.
    expect(data.items.map((i) => i.id)).toEqual([ID_OPEN]);
    const card = await client.callTool({ name: 'get_document', arguments: { docId: ID_OPEN } });
    expect(JSON.parse((card.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ id: ID_OPEN, title: 'Open paper about graphs' });
    const refused = await client.callTool({ name: 'get_document', arguments: { docId: ID_PRIVATE } });
    expect(refused.isError).toBe(true);
    expect(JSON.parse((refused.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ code: 'FOLDER_NOT_AI_ENABLED' });
    const bad = await client.callTool({ name: 'get_document', arguments: { docId: 'nope' } });
    expect(bad.isError).toBe(true);
    // The log holds tool, outcome, code and ids, nothing else.
    expect(calls.map((c) => [c.tool, c.ok, c.code])).toEqual([['search_library', true, null], ['get_document', true, null], ['get_document', false, 'FOLDER_NOT_AI_ENABLED'], ['get_document', false, 'INVALID_REQUEST']]);
    expect(calls[0]!.docIds).toEqual([ID_OPEN]);
    expect(Object.keys(calls[0]!).sort()).toEqual(['code', 'docIds', 'ms', 'ok', 'tool']);
    await client.close();
  });

  it('lists write_ai_field only when writing is enabled, and it only proposes', async () => {
    const off = await start();
    const c1 = await connect(off);
    expect((await c1.listTools()).tools.map((t) => t.name)).not.toContain('write_ai_field');
    expect((await c1.callTool({ name: 'write_ai_field', arguments: { docId: ID_OPEN, field: 'summary', text: 'x' } }).catch((e: unknown) => e)) instanceof Error).toBe(true);
    await c1.close();
    await off.close();
    const on = await start({ write: true });
    const c2 = await connect(on);
    expect((await c2.listTools()).tools.map((t) => t.name)).toContain('write_ai_field');
    const r = await c2.callTool({ name: 'write_ai_field', arguments: { docId: ID_OPEN, field: 'summary', text: 'proposed text' } });
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ status: 'proposed' });
    expect(written).toEqual([`${ID_OPEN}:summary`]);
    expect((await c2.callTool({ name: 'write_ai_field', arguments: { docId: ID_PRIVATE, field: 'summary', text: 'x' } })).isError).toBe(true);
    await c2.close();
  });

  it('refuses a wrong token', async () => {
    const s = await start();
    await expect(connect(s, 'not-the-token')).rejects.toThrow();
  });
});

describe('request security', () => {
  it('refuses Origin, a foreign Host, a missing or wrong token, and bare methods', async () => {
    const s = await start();
    const init = rpc('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION });
    expect((await raw(s, { body: init })).status).toBe(200);
    expect((await raw(s, { body: init, headers: { Origin: 'https://example.invalid' } })).status).toBe(403);
    expect((await raw(s, { body: init, headers: { Origin: 'null' } })).status).toBe(403);
    expect((await raw(s, { body: init, headers: { Host: 'example.invalid' } })).status).toBe(403);
    expect((await raw(s, { body: init, headers: { Host: `127.0.0.1:${s.port + 1}` } })).status).toBe(403);
    expect((await raw(s, { body: init, headers: { Host: `localhost:${s.port}` } })).status).toBe(200);
    expect((await raw(s, { body: init, headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await raw(s, { body: init, headers: { Authorization: '' } })).status).toBe(401);
    const noAuth = await raw(s, { body: init, headers: { Authorization: 'Basic abc' } });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body).toBe(''); // no detail
    expect((await raw(s, { method: 'GET' })).status).toBe(405);
    expect((await raw(s, { method: 'DELETE' })).status).toBe(405);
    expect((await raw(s, { method: 'PUT', body: init })).status).toBe(405);
    expect((await raw(s, { path: '/other', body: init })).status).toBe(404);
    expect((await raw(s, { body: init, headers: { 'MCP-Protocol-Version': '1999-01-01' } })).status).toBe(400);
  });

  it('caps the body, answers malformed JSON with a parse error and notifications with 202', async () => {
    const s = await start({ bodyBytes: 2_000 });
    expect((await raw(s, { body: `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"${'a'.repeat(5_000)}"}}` })).status).toBe(413);
    const bad = await raw(s, { body: '{not json' });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error.code).toBe(-32700);
    expect((await raw(s, { body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status).toBe(202);
    expect(JSON.parse((await raw(s, { body: rpc('ping') })).body)).toMatchObject({ id: 1, result: {} });
    expect(JSON.parse((await raw(s, { body: rpc('nope') })).body).error.code).toBe(-32601);
    expect(JSON.parse((await raw(s, { body: rpc('tools/call', { name: 'zzz' }) })).body).error.code).toBe(-32602);
    expect(JSON.parse((await raw(s, { body: '{"foo":1}' })).body).error.code).toBe(-32600);
  });

  it('negotiates the protocol version', async () => {
    const s = await start();
    const ask = async (v: string) => JSON.parse((await raw(s, { body: rpc('initialize', { protocolVersion: v }) })).body).result.protocolVersion as string;
    expect(await ask('2025-03-26')).toBe('2025-03-26');
    expect(await ask('2024-11-05')).toBe('2024-11-05');
    expect(await ask('2099-01-01')).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('answers 429 beyond the allowed concurrent requests and times out a slow tool', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: McpTool = { name: 'slow', description: 'waits', inputSchema: { type: 'object' }, readOnly: true, run: async () => (await gate, { text: '{}', docIds: [] }) };
    const s = await start({ extra: [slow], concurrent: 2 });
    const call = rpc('tools/call', { name: 'slow', arguments: {} });
    const a = raw(s, { body: call });
    const b = raw(s, { body: call });
    await new Promise((r) => setTimeout(r, 100));
    expect((await raw(s, { body: call })).status).toBe(429);
    release();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    await s.close();
    const stuck: McpTool = { ...slow, run: (_a, ctx) => new Promise((_res, rej) => ctx.signal?.addEventListener('abort', () => rej(new Error('aborted')))) };
    const t = await start({ extra: [stuck], timeoutMs: 150 });
    expect((await raw(t, { body: call.replace('slow', 'slow') })).status).toBe(504);
  });

  it('listens on loopback only', async () => {
    const s = await start();
    const external = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal);
    if (!external) return; // a machine with no external interface has nothing to try
    const refused = await new Promise<string>((resolve) => {
      const sock = net.createConnection({ host: external.address, port: s.port });
      sock.once('connect', () => (sock.destroy(), resolve('connected')));
      sock.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
    });
    expect(refused).toBe('ECONNREFUSED');
  });

  it('a port in use rejects with EADDRINUSE', async () => {
    const s = await start();
    await expect(startMcpServer({ port: s.port, token: () => TOKEN, bodyBytes: 10, concurrent: 1, timeoutMs: 1000, rpc: { serverName: 'x', serverVersion: '0', instructions: '', tools: () => [] } })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('helpers', () => {
  it('compares secrets without leaking length and checks bearer and host forms', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(bearerOk('Bearer tok', 'tok')).toBe(true);
    expect(bearerOk('bearer tok', 'tok')).toBe(true);
    expect(bearerOk('Bearer tok extra', 'tok')).toBe(false);
    expect(bearerOk(undefined, 'tok')).toBe(false);
    expect(hostAllowed('127.0.0.1:5000', 5000)).toBe(true);
    expect(hostAllowed('LOCALHOST:5000', 5000)).toBe(true);
    expect(hostAllowed('localhost', 5000)).toBe(false);
    expect(hostAllowed('[::1]:5000', 5000)).toBe(false);
    expect(hostAllowed('evil.test:5000', 5000)).toBe(false);
    expect(checkRequest({ method: 'POST', url: '/mcp?x=1', headers: { host: '127.0.0.1:1', authorization: 'Bearer t' }, port: 1 }, 't')).toBeNull();
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(newToken());
  });
  it('writes the configuration lines as the Claude Code docs show them', () => {
    const name = serverNameFor('My Lab: Série 2');
    expect(name).toBe('research-lab-my-lab-serie-2');
    expect(serverNameFor('###')).toBe('research-lab');
    expect(cliConfig(name, 'http://127.0.0.1:5000/mcp', 'T')).toBe('claude mcp add --transport http research-lab-my-lab-serie-2 http://127.0.0.1:5000/mcp --header "Authorization: Bearer T"');
    expect(JSON.parse(jsonConfig(name, 'http://127.0.0.1:5000/mcp', 'T'))).toEqual({ mcpServers: { [name]: { type: 'http', url: 'http://127.0.0.1:5000/mcp', headers: { Authorization: 'Bearer T' } } } });
  });
  it('the call log is bounded, newest first, and restores only well-formed entries', () => {
    const log = createCallLog(3);
    for (let i = 0; i < 5; i++) log.add({ tool: `t${i}`, ok: true, ms: i, code: null, docIds: [] });
    expect(log.list(10, 0)).toMatchObject({ total: 3, items: [{ tool: 't4' }, { tool: 't3' }, { tool: 't2' }] });
    expect(log.list(1, 1).items[0]!.tool).toBe('t3');
    const again = createCallLog(10);
    again.restore([...log.snapshot(), { nope: 1 }, { tool: 'x', at: 'y', docIds: ['zz', '0000000000000001'], extra: 'dropped' }]);
    expect(again.list(10, 0).total).toBe(4);
    expect(JSON.stringify(again.snapshot())).not.toContain('dropped');
  });
});
