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

/** Control characters and bidirectional marks: never kept in text that comes from a remote source or a synced file. */
// eslint-disable-next-line no-control-regex
export const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

/** A DOI as the registry writes it: `10.` + 4 to 9 digits, `/`, then a suffix without whitespace, control or bidi characters. */
// eslint-disable-next-line no-control-regex
export const DOI_SHAPE = /^10\.\d{4,9}\/[^\s\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]+$/;

/** True for a well-formed DOI (no `doi:` or URL prefix) whose path has no `.` or `..` segment. */
export function isValidDoi(doi: string): boolean {
  return doi.length <= 300 && DOI_SHAPE.test(doi) && !doi.split('/').some((s) => s === '.' || s === '..');
}

/** An arXiv identifier, new (`2401.01234`) or old (`hep-th/9901001`, `math.GT/0309136`) form, optional version. */
export const ARXIV_SHAPE = /^(?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;

/** An OpenAlex work id. */
export const OPENALEX_WORK_SHAPE = /^W\d+$/;
