import path from 'node:path';
import { z } from 'zod';
import { AppError, MCP_LIMITS, MCP_TOOL_NAMES, type LibraryConfig, type McpStatus } from '@rl/core';
import { atomicWriteJson, readJsonFile } from '@rl/core/node';
import { MASKED_TOKEN, MCP_INSTRUCTIONS, cliConfig, createCallLog, jsonConfig, newToken, serverNameFor, startMcpServer, type RunningMcpServer } from '@rl/mcp';
import type { MainServices } from '../ipc/handlers/services.js';
import { createMcpTools, listMcpTools } from './tools.js';

/** Secret (scope: the library) holding the bearer token of the server. */
export const MCP_TOKEN_SECRET = 'mcp-token';
const REQUEST_TIMEOUT_MS = 60_000;
const NOTIFY_GAP_MS = 2_000;
/** The copied line holds the token: the clipboard is emptied after this long, if it still holds that line. */
export const CLIPBOARD_CLEAR_MS = 60_000;

const localSchema = z.object({ port: z.number().int().min(1024).max(65535).nullable().default(null), log: z.array(z.unknown()).default([]) });

interface Running {
  libraryId: string;
  server: RunningMcpServer;
}
type CallLog = ReturnType<typeof createCallLog>;
interface Local {
  libraryId: string;
  port: number | null;
  log: CallLog;
}

interface State {
  chain: Promise<unknown>;
  running: Running | null;
  /** Why the active library's server is not running although enabled. */
  error: { libraryId: string; code: string; message: string } | null;
  token: string | null;
  tokenLib: string | null;
  /** Port and call log of this computer for one library (`<localDataDir>/mcp/<libraryId>.json`, never synced). */
  local: Local | null;
  /** The load of `local` in progress or done, so that two callers share one object (the log and the port are never split). */
  localLoad: { libraryId: string; promise: Promise<Local> } | null;
  /** Clears the clipboard when it still holds the token line (null when nothing is pending). */
  clipboard: { timer: NodeJS.Timeout; clear(): Promise<void> } | null;
  restart: boolean;
  timer: NodeJS.Timeout | null;
  lastCallAt: string | null;
}

const states = new WeakMap<object, State>();
const stateOf = (s: MainServices): State => {
  let st = states.get(s);
  if (!st) states.set(s, (st = { chain: Promise.resolve(), running: null, error: null, token: null, tokenLib: null, local: null, localLoad: null, clipboard: null, restart: false, timer: null, lastCallAt: null }));
  return st;
};

const safeName = (libraryId: string) => libraryId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
const localFile = (s: MainServices, libraryId: string) => path.join(s.localDataDir, 'mcp', `${safeName(libraryId)}.json`);

async function persist(s: MainServices, st: State): Promise<void> {
  const l = st.local;
  if (!l) return;
  await atomicWriteJson(localFile(s, l.libraryId), { port: l.port, log: l.log.snapshot() }).catch((e: unknown) => s.log.warn('could not save the MCP settings of this computer', { error: e }));
}

/** Port and log of `libraryId` on this computer (the previous library's are saved first). */
function localOf(s: MainServices, st: State, libraryId: string): Promise<Local> {
  // Registered before the first await: a concurrent caller (status, log, start) gets the same object.
  if (st.localLoad?.libraryId === libraryId) return st.localLoad.promise;
  const previous = st.localLoad?.promise;
  const promise = (async () => {
    await previous?.catch(() => {}); // loads of two libraries never overlap: `st.local` ends as the last one asked for
    await persist(s, st);
    const saved = await readJsonFile(localFile(s, libraryId), localSchema).catch(() => localSchema.parse({}));
    const log = createCallLog(MCP_LIMITS.logKept);
    log.restore(saved.log);
    const local = { libraryId, port: saved.port, log };
    st.local = local;
    st.lastCallAt = log.snapshot().at(-1)?.at ?? null;
    return local;
  })();
  const entry = { libraryId, promise };
  st.localLoad = entry;
  promise.catch(() => {
    if (st.localLoad === entry) st.localLoad = null;
  });
  return promise;
}

async function active(s: MainServices): Promise<{ id: string | null; config: LibraryConfig | null }> {
  try {
    const { activeLibraryId } = await s.libraries.list();
    if (!activeLibraryId) return { id: null, config: null };
    return { id: activeLibraryId, config: await s.libraries.getConfig(activeLibraryId).catch(() => null) };
  } catch {
    return { id: null, config: null };
  }
}

export async function mcpStatus(s: MainServices): Promise<McpStatus> {
  const st = stateOf(s);
  const { id, config } = await active(s);
  const local = id ? await localOf(s, st, id).catch(() => null) : null;
  const running = st.running && st.running.libraryId === id ? st.running : null;
  const port = running ? running.server.port : (local?.port ?? null);
  const writeEnabled = config?.mcp.writeEnabled ?? false;
  const error = id && st.error?.libraryId === id && !running ? { code: st.error.code, message: st.error.message } : null;
  return {
    enabled: config?.mcp.enabled ?? false,
    writeEnabled,
    running: running !== null,
    port,
    url: running ? `http://127.0.0.1:${running.server.port}/mcp` : null,
    error,
    tools: MCP_TOOL_NAMES.filter((n) => writeEnabled || n !== 'write_ai_field'),
    calls: local?.log.snapshot().length ?? 0,
    lastCallAt: local ? st.lastCallAt : null,
  };
}

async function notify(s: MainServices): Promise<void> {
  const st = stateOf(s);
  if (st.timer) {
    clearTimeout(st.timer);
    st.timer = null;
  }
  s.emit('mcp:changed', await mcpStatus(s));
}

/** Calls are counted for the window at most every 2 s, and saved with them. */
function touch(s: MainServices, st: State): void {
  if (st.timer) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    void persist(s, st);
    void notify(s).catch(() => {});
  }, NOTIFY_GAP_MS);
  st.timer.unref();
}

async function tokenOf(s: MainServices, st: State, libraryId: string): Promise<string> {
  if (st.token && st.tokenLib === libraryId) return st.token;
  const scope = { kind: 'library', libraryId } as const;
  let token = await s.secrets.get(scope, MCP_TOKEN_SECRET);
  if (!token || token.length < 20) {
    token = newToken();
    await s.secrets.set(scope, MCP_TOKEN_SECRET, token);
  }
  st.token = token;
  st.tokenLib = libraryId;
  return token;
}

async function stop(s: MainServices, st: State): Promise<void> {
  const r = st.running;
  st.running = null;
  if (r) await r.server.close().catch((e: unknown) => s.log.warn('closing the MCP server failed', { error: e }));
  st.token = null;
  st.tokenLib = null;
  await persist(s, st);
}

async function start(s: MainServices, st: State, libraryId: string, config: LibraryConfig): Promise<void> {
  const fail = (code: string, message: string) => void (st.error = { libraryId, code, message });
  try {
    await tokenOf(s, st, libraryId);
  } catch (e) {
    const err = AppError.from(e);
    s.log.warn('the MCP token is not available', { error: e });
    return fail(err.code === 'SECRET_UNAVAILABLE' ? 'SECRET_UNAVAILABLE' : 'TOKEN_FAILED', err.code === 'SECRET_UNAVAILABLE' ? 'Secure storage is not available: the server cannot start' : 'The access token could not be prepared');
  }
  const local = await localOf(s, st, libraryId);
  const writeEnabled = async () => (await s.libraries.getConfig(libraryId).catch(() => null))?.mcp.writeEnabled ?? false;
  const all = createMcpTools({ s, libraryId, writeEnabled });
  try {
    const server = await startMcpServer({
      port: local.port ?? 0,
      token: () => st.token ?? '',
      rpc: {
        serverName: serverNameFor(config.name),
        serverVersion: s.appInfo?.().version ?? '0.0.0',
        instructions: MCP_INSTRUCTIONS,
        tools: () => listMcpTools(all, writeEnabled),
        onCall: (rec) => {
          local.log.add(rec);
          st.lastCallAt = new Date().toISOString();
          touch(s, st);
        },
      },
      bodyBytes: MCP_LIMITS.bodyBytes,
      concurrent: MCP_LIMITS.concurrent,
      timeoutMs: REQUEST_TIMEOUT_MS,
      onRefused: (r) => s.log.info('MCP request refused', { status: r.status, reason: r.reason }),
    });
    st.running = { libraryId, server };
    st.error = null;
    if (local.port !== server.port) {
      local.port = server.port;
      await persist(s, st);
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code === 'EADDRINUSE') fail('PORT_IN_USE', `The port ${local.port ?? ''} is in use by another program: choose another port`.replace('port  ', 'port '));
    else if (code === 'EACCES') fail('PORT_DENIED', 'The system does not allow this port: choose another one');
    else {
      s.log.warn('the MCP server could not start', { error: e });
      fail('LISTEN_FAILED', 'The server could not start');
    }
  }
}

async function apply(s: MainServices, st: State): Promise<void> {
  const { id, config } = await active(s);
  const want = id !== null && config?.mcp.enabled === true ? id : null;
  if (st.running && (st.running.libraryId !== want || st.restart)) await stop(s, st);
  st.restart = false;
  if (want === null || config === null) {
    st.error = null;
    return;
  }
  if (!st.running) await start(s, st, want, config);
}

/**
 * Makes the server match the library that is open now: running when `library.json` says `mcp.enabled`, stopped otherwise,
 * on a library switch, when the library is forgotten, and at quit (`stopMcp`). Serialised; never throws (a port in use is
 * a status error, not a crash).
 */
export function reconcileMcp(s: MainServices): Promise<void> {
  const st = stateOf(s);
  const run = async () => {
    try {
      await apply(s, st);
    } catch (e) {
      s.log.warn('the MCP server could not be updated', { error: e });
    }
    await notify(s).catch(() => {});
  };
  const next = st.chain.then(run, run);
  st.chain = next.catch(() => {});
  return next;
}

/** App quit: stops the server and saves the log. */
export async function stopMcp(s: MainServices): Promise<void> {
  const st = stateOf(s);
  await st.chain;
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
  await st.clipboard?.clear(); // the token must not outlive the app on the clipboard
  await stop(s, st);
}

const requireActive = async (s: MainServices): Promise<string> => {
  const { id } = await active(s);
  if (!id) throw new AppError('LIBRARY_NOT_ACTIVE', 'No active library');
  return id;
};

export async function setEnabled(s: MainServices, enabled: boolean): Promise<McpStatus> {
  const id = await requireActive(s);
  await s.libraries.setConfig({ mcp: { enabled } }, id);
  await reconcileMcp(s);
  return mcpStatus(s);
}

export async function setWriteEnabled(s: MainServices, writeEnabled: boolean): Promise<McpStatus> {
  const id = await requireActive(s);
  await s.libraries.setConfig({ mcp: { writeEnabled } }, id);
  await notify(s);
  return mcpStatus(s);
}

export async function setPort(s: MainServices, port: number | null): Promise<McpStatus> {
  const id = await requireActive(s);
  const st = stateOf(s);
  const local = await localOf(s, st, id);
  local.port = port;
  await persist(s, st);
  if (st.running?.libraryId === id) st.restart = true;
  await reconcileMcp(s);
  return mcpStatus(s);
}

export async function rotateToken(s: MainServices): Promise<McpStatus> {
  const id = await requireActive(s);
  const st = stateOf(s);
  // Serialised with start and stop so that the cache and the store never disagree.
  const run = async () => {
    const token = newToken();
    await s.secrets.set({ kind: 'library', libraryId: id }, MCP_TOKEN_SECRET, token);
    // The running server's token callback reads this cache: only the library it serves may change it (else `start` reads the store).
    if (!st.running || st.running.libraryId === id) {
      st.token = token;
      st.tokenLib = id;
    }
  };
  const next = st.chain.then(run, run);
  st.chain = next.catch(() => {});
  await next;
  await notify(s);
  return mcpStatus(s);
}

/** Empties the clipboard after `CLIPBOARD_CLEAR_MS`, but only when it still holds `line` (the user may have copied something else). */
function scheduleClipboardClear(s: MainServices, st: State, line: string): void {
  if (st.clipboard) clearTimeout(st.clipboard.timer); // a new copy restarts the countdown
  const clipboard = s.clipboard;
  if (!clipboard) return;
  const clear = (): Promise<void> => {
    if (st.clipboard) clearTimeout(st.clipboard.timer);
    st.clipboard = null;
    return Promise.resolve()
      .then(() => clipboard.readText())
      .then((now) => {
        if (now === line) clipboard.writeText('');
      })
      .catch((e: unknown) => s.log.warn('could not clear the clipboard', { error: e }));
  };
  const timer = setTimeout(clear, CLIPBOARD_CLEAR_MS);
  timer.unref();
  st.clipboard = { timer, clear };
}

/** Writes the line (or JSON) for Claude Code to the clipboard in the main process and returns it with the token masked. */
export async function copyConfig(s: MainServices, format: 'cli' | 'json'): Promise<{ preview: string }> {
  const st = stateOf(s);
  await st.chain;
  const { id, config } = await active(s);
  const r = st.running;
  if (!id || !config || !r || r.libraryId !== id || !st.token) throw new AppError('CONFLICT', 'The server is not running', { reason: 'not-running' });
  if (!s.clipboard) throw new AppError('NOT_IMPLEMENTED', 'The clipboard is not available');
  const name = serverNameFor(config.name);
  const url = `http://127.0.0.1:${r.server.port}/mcp`;
  const make = format === 'cli' ? cliConfig : jsonConfig;
  const line = make(name, url, st.token);
  s.clipboard.writeText(line);
  scheduleClipboardClear(s, st, line);
  return { preview: make(name, url, MASKED_TOKEN) };
}

export async function mcpLog(s: MainServices, limit: number, offset: number) {
  const st = stateOf(s);
  const { id } = await active(s);
  if (!id) return { items: [], total: 0 };
  const local = await localOf(s, st, id);
  return local.log.list(limit, offset);
}
