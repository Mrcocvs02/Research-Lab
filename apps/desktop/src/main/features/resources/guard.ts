import { isIP } from 'node:net';

export interface GuardOptions {
  /** Tests only: a local server stands in for the site. Never set by the app. */
  allowLocal?: boolean;
}

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: 'invalid' | 'not-http' | 'credentials' | 'private-host' };

/** Whether an IPv4 or IPv6 literal belongs to the machine, a private network, a link-local range or another non-public block. */
export function isPrivateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (kind === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPrivateAddress(mapped[1]!);
    // A mapped address in hex form (::ffff:7f00:1) is refused whole: nothing public is written that way.
    return h === '::' || h === '::1' || h.startsWith('::ffff:') || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('ff');
  }
  return false;
}

/**
 * Checks an address typed by the user before the app contacts it: http or https only, no user name or password, and a
 * host that is not the machine itself or a private network (names such as `localhost`, `*.local`, `*.internal`, single
 * labels and IP literals included). A name that resolves to a private address is caught by `checkResolved`.
 */
export function checkPublicUrl(input: string, o: GuardOptions = {}): UrlVerdict {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not-http' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (o.allowLocal) return { ok: true, url };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || isPrivateAddress(host)) return { ok: false, reason: 'private-host' };
  if (isIP(host.replace(/^\[|\]$/g, '')) === 0) {
    // Not an IP literal: a real name has a dot, and these suffixes never name a public site.
    if (!host.includes('.') || /\.(localhost|local|internal|lan|home|corp|intranet|test|invalid)$/.test(host)) return { ok: false, reason: 'private-host' };
    // Numeric forms the URL parser did not normalise to a dotted quad.
    if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/i.test(host)) return { ok: false, reason: 'private-host' };
  }
  return { ok: true, url };
}

/** After the name is resolved: every address must be public. */
export function checkResolved(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
}
