import { app, protocol, session, shell, net, type Session, type WebContents } from 'electron';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { isAllowedExternalUrl } from '@rl/core';
import { isInside } from '@rl/core/node';
import { APP_ORIGIN, APP_SCHEME } from './app-info.js';
import { DEV_CSP, PROD_CSP } from './csp.js';

/** Must run before `app.whenReady()`. */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Node's `URL.origin` is "null" for custom schemes, so build the origin by hand. */
function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Origin the renderer is loaded from (dev server in dev, custom scheme when built). */
export function rendererOrigin(): string {
  const dev = process.env.ELECTRON_RENDERER_URL;
  return (dev ? originOf(dev) : null) ?? APP_ORIGIN;
}

export function isTrustedUrl(url: string): boolean {
  return originOf(url) === rendererOrigin();
}

/** Serves the built renderer from `rendererDir` over `rl-app://app/`, with CSP, confined to that folder. */
export function serveRenderer(ses: Session, rendererDir: string): void {
  ses.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const file = path.resolve(rendererDir, `.${rel === '/' ? '/index.html' : rel}`);
    if (!isInside(rendererDir, file)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', PROD_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });
}

/** Session-wide hardening: deny every permission, add CSP to the dev server, block downloads of unknown origin. */
export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (process.env.ELECTRON_RENDERER_URL) {
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
