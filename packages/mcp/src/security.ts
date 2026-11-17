import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SUPPORTED_PROTOCOL_VERSIONS } from './protocol.js';

/** Constant-time comparison of two secrets of any length (both are hashed first, so the length does not leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** 32 random bytes, base64url. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export interface RequestFacts {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** Port the server listens on. */
  port: number;
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `Host` must be the loopback address or `localhost` with the server's port (anything else is a DNS rebinding attempt). */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/** `Authorization: Bearer <token>`. */
export function bearerOk(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const m = /^Bearer[ ]+(\S+)$/i.exec(header);
  return m !== null && safeEqual(m[1] as string, token);
}

export interface Refusal {
  status: 400 | 401 | 403 | 404 | 405;
  /** Short reason for the local log only; never sent to the client. */
  reason: 'host' | 'origin' | 'auth' | 'path' | 'method' | 'version';
}

/**
 * The checks before a request is read: host, origin, token, path, method, protocol version header, in that order. A refusal
 * says nothing about why (the status code only), so that a failed guess learns nothing.
 */
export function checkRequest(req: RequestFacts, token: string): Refusal | null {
  if (!hostAllowed(one(req.headers['host']), req.port)) return { status: 403, reason: 'host' };
  // A browser page always sends Origin on cross-site requests; Claude Code never does.
  if (req.headers['origin'] !== undefined) return { status: 403, reason: 'origin' };
  if (!bearerOk(one(req.headers['authorization']), token)) return { status: 401, reason: 'auth' };
  if (req.url.split('?')[0] !== '/mcp') return { status: 404, reason: 'path' };
  if (req.method !== 'POST') return { status: 405, reason: 'method' };
  const v = one(req.headers['mcp-protocol-version']);
  if (v !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(v)) return { status: 400, reason: 'version' };
  return null;
}
