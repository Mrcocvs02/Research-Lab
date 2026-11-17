import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RPC, handleRpc, rpcError, type RpcContext, type RpcResponse } from './protocol.js';
import { checkRequest } from './security.js';

export interface McpServerOptions {
  /** Port to listen on; 0 lets the system pick a free one. */
  port: number;
  /** The token requests must carry, read at each request (a rotation applies at once). */
  token(): string | Promise<string>;
  rpc: Omit<RpcContext, 'signal'>;
  bodyBytes: number;
  /** Requests handled at once (more get 429) and, across all requests, messages run at once (a batch counts per message). */
  concurrent: number;
  /** Most messages of a batch (default 20): a larger one is refused with an error. */
  batchMax?: number;
  /** A request that takes longer is answered with an error and its tools are told to stop. */
  timeoutMs: number;
  /** A refused request (status and reason only, never headers or the token). */
  onRefused?(info: { status: number; reason: string }): void;
}

export interface RunningMcpServer {
  port: number;
  close(): Promise<void>;
}

const CLOSE_GRACE_MS = 500;

const send = (res: http.ServerResponse, status: number, body?: unknown, extra: Record<string, string> = {}) => {
  if (res.headersSent || res.writableEnded) return;
  // A `Connection: close` answer must also end the connection: the client may still be sending a body we will not read.
  if (extra.Connection === 'close') {
    // Response first (a hard reset could discard it), then the connection goes: a client that keeps sending is cut after a short grace.
    res.once('finish', () => {
      const socket = res.socket;
      socket?.end();
      setTimeout(() => socket?.destroy(), CLOSE_GRACE_MS).unref();
    });
  }
  const data = body === undefined ? undefined : JSON.stringify(body);
  res.writeHead(status, { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : { 'Content-Length': 0 }), 'Cache-Control': 'no-store', ...extra });
  res.end(data);
};

/** Reads the body up to `limit` bytes; resolves null when it is larger (the request is then dropped). */
function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return resolve(null);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        chunks.length = 0;
        req.removeAllListeners('data');
        resolve(null); // not drained: the caller answers and closes the connection
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Streamable HTTP, stateless, JSON responses only: POST `/mcp` with one JSON-RPC message (or a batch). Binds 127.0.0.1.
 * Everything else is refused before the body is read (see `checkRequest`). Rejects with the listen error (`EADDRINUSE`).
 */
export function startMcpServer(o: McpServerOptions): Promise<RunningMcpServer> {
  let inflight = 0;
  let port = 0;
  const batchMax = o.batchMax ?? 20;
  // Messages run at most `concurrent` at a time over all requests: a batch cannot multiply the cap.
  let running = 0;
  const waiting: Array<() => void> = [];
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= o.concurrent) await new Promise<void>((go) => waiting.push(go));
    else running++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next(); // the slot passes to the next message
      else running--;
    }
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const refusal = checkRequest({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, port }, await o.token());
        if (refusal) {
          o.onRefused?.(refusal);
          return send(res, refusal.status, undefined, { Connection: 'close', ...(refusal.status === 405 ? { Allow: 'POST' } : {}) });
        }
        if (inflight >= o.concurrent) {
          return send(res, 429, undefined, { 'Retry-After': '1', Connection: 'close' });
        }
        inflight++;
        const abort = new AbortController();
        const timer = setTimeout(() => {
          abort.abort();
          send(res, 504, rpcError(null, RPC.internal, 'The request took too long'));
        }, o.timeoutMs);
        try {
          const raw = await readBody(req, o.bodyBytes);
          if (raw === null) return send(res, 413, undefined, { Connection: 'close' });
          let message: unknown;
          try {
            message = JSON.parse(raw.toString('utf8'));
          } catch {
            return send(res, 400, rpcError(null, RPC.parse, 'Parse error'));
          }
          const ctx: RpcContext = { ...o.rpc, signal: abort.signal };
          if (Array.isArray(message) && message.length > batchMax) return send(res, 400, rpcError(null, RPC.invalidRequest, `Batch too large: at most ${batchMax} messages`));
          const out: Array<RpcResponse | null> = Array.isArray(message)
            ? message.length === 0
              ? [rpcError(null, RPC.invalidRequest, 'Empty batch')]
              : await Promise.all(message.map((m) => slot(async () => (abort.signal.aborted ? rpcError(null, RPC.internal, 'The request took too long') : handleRpc(m, ctx)))))
            : [await slot(() => handleRpc(message, ctx))];
          const answers = out.filter((r): r is RpcResponse => r !== null);
          if (answers.length === 0) return send(res, 202);
          send(res, 200, Array.isArray(message) ? answers : answers[0]);
        } finally {
          clearTimeout(timer);
          inflight--;
        }
      } catch {
        send(res, 500, rpcError(null, RPC.internal, 'Internal error'));
      }
    })();
  });
  server.requestTimeout = o.timeoutMs + 5_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', () => {
      server.off('error', reject);
      port = (server.address() as AddressInfo).port;
      server.on('error', () => {});
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
