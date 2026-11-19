import { isIP } from 'node:net';

export interface GuardOptions {
  /** Tests only: a local server stands in for the site. Never set by the app. */
  allowLocal?: boolean;
}

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: 'invalid' | 'not-http' | 'credentials' | 'private-host' };

/** The eight 16-bit groups of an IPv6 literal (a trailing dotted quad is accepted), or null when it is not well formed. */
function groups6(h: string): number[] | null {
  let t = h.split('%')[0]!;
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(t);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((n) => n > 255)) return null;
    t = `${t.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const all = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** Whether an IPv4 or IPv6 literal belongs to the machine, a private network, a link-local range or another non-public block. */
export function isPrivateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b, c] = h.split('.').map(Number) as [number, number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 ||
      // 192.0.0.0/24 (protocol assignments), the documentation blocks and the 198.18.0.0/15 benchmarking range.
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)
    );
  }
  if (kind === 6) {
    const g = groups6(h);
    // Not parsable: refused whole.
    if (g === null) return true;
    const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
    if (allZeroTo(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
    if (allZeroTo(5) && (g[5] === 0xffff || g[5] === 0)) return isPrivateAddress(v4of(g[6]!, g[7]!)); // ::ffff:a.b.c.d and the deprecated ::a.b.c.d
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(v4of(g[6]!, g[7]!)); // NAT64 64:ff9b::/96
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48, local-use NAT64
    if (g[0] === 0x2002) return isPrivateAddress(v4of(g[1]!, g[2]!)); // 6to4 2002::/16
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
    return (g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0 || (g[0]! & 0xff00) === 0xff00;
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
