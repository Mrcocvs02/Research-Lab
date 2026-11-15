/** Hosts the app may open in the system browser (https only, subdomains included). */
export const DEFAULT_EXTERNAL_HOSTS: readonly string[] = [
  'doi.org',
  'arxiv.org',
  'openalex.org',
  'orcid.org',
  'semanticscholar.org',
  'github.com',
  'anthropic.com',
];

/** True when `url` is https, has no credentials, and its host is (a subdomain of) an allowed host. */
export function isAllowedExternalUrl(url: string, allowedHosts: readonly string[] = DEFAULT_EXTERNAL_HOSTS): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}
