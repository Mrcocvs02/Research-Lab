import { app, protocol, session, shell, net, type Session, type WebContents } from 'electron';
import { pathToFileURL } from 'node:url';
import { isAllowedExternalUrl } from '@rl/core';
import { DOC_SCHEME } from '@rl/core';
import { APP_ORIGIN, APP_SCHEME } from './app-info.js';
import { DEV_CSP, PROD_CSP } from './csp.js';
import { isTrustedUrlFor, resolveRendererFile } from './renderer-url.js';
import { getRuntime } from './runtime.js';

/** Must run before `app.whenReady()`. */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    // Bytes of the PDFs for the reader (range requests, fetched from the renderer origin). No bypassCSP: connect-src names it.
    { scheme: DOC_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

/** Origin the renderer is loaded from (validated dev server in a development run, custom scheme when built). */
export function rendererOrigin(): string {
  return getRuntime().rendererDevUrl ?? APP_ORIGIN;
}

export function isTrustedUrl(url: string): boolean {
  return isTrustedUrlFor(url, getRuntime().rendererDevUrl);
}

/** Serves the built renderer from `rendererDir` over `rl-app://app/`, with CSP, confined to that folder. */
export function serveRenderer(ses: Session, rendererDir: string): void {
  ses.protocol.handle(APP_SCHEME, async (request) => {
    const resolved = await resolveRendererFile(rendererDir, request.url);
    if (resolved.status !== 200) return new Response(resolved.status === 400 ? 'Bad request' : resolved.status === 403 ? 'Forbidden' : 'Not found', { status: resolved.status });
    const res = await net.fetch(pathToFileURL(resolved.file).toString(), { bypassCustomProtocolHandlers: true });
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', PROD_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });
}

/** Serves `rl-doc://` (see `doc-protocol.ts`) in the given session. */
export function serveDocuments(ses: Session, handler: (request: Request) => Promise<Response>): void {
  ses.protocol.handle(DOC_SCHEME, handler);
}

/** Session-wide hardening: deny every permission, add CSP to the dev server, block downloads of unknown origin. */
export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (getRuntime().rendererDevUrl) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] };
      callback({ responseHeaders: headers });
    });
  }
  // The app never downloads anything.
  ses.on('will-download', (event) => event.preventDefault());
}

/** Per-WebContents hardening: no navigation away, no new windows, no webviews, allowlisted external links. */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export function installGlobalSecurity(): void {
  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));
  app.on('session-created', hardenSession);
  hardenSession(session.defaultSession);
}
