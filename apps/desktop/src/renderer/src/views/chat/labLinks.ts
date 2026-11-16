/**
 * The only links of model output the chat acts on: `lab://doc/<id>?page=N`, `lab://note/<id>` (the file note of a
 * document) and `lab://project/<id>`. Anything else (another scheme, a malformed id, an extra path or query) is not a
 * link: `parseLabLink` returns null and the caller shows plain text. Nothing here ever builds a URL to navigate to.
 */
export type LabLink = { kind: 'doc'; docId: string; page?: number } | { kind: 'note'; docId: string } | { kind: 'project'; id: string };

const PAGE_MAX = 100_000;
const DOC = /^lab:\/\/doc\/([0-9a-f]{16})(?:\?page=([1-9][0-9]{0,5}))?$/;
const NOTE = /^lab:\/\/note\/([0-9a-f]{16})$/;
const PROJECT = /^lab:\/\/project\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

export function parseLabLink(href: string): LabLink | null {
  let m = DOC.exec(href);
  if (m) {
    const page = m[2] === undefined ? undefined : Number(m[2]);
    if (page !== undefined && page > PAGE_MAX) return null;
    return page === undefined ? { kind: 'doc', docId: m[1]! } : { kind: 'doc', docId: m[1]!, page };
  }
  m = NOTE.exec(href);
  if (m) return { kind: 'note', docId: m[1]! };
  m = PROJECT.exec(href);
  if (m) return { kind: 'project', id: m[1]! };
  return null;
}

/**
 * True when the link text written by the model already names the page of the link ("…, p. 3", "page 3", "pag. 3"):
 * the chip then shows the text as it is instead of adding the page a second time.
 */
export function labelNamesPage(label: string, page: number): boolean {
  return new RegExp(String.raw`(?:^|[^\p{L}])(?:p|pp|pg|pag|page|pages|pagina|pagine)\.?\s*${page}(?![0-9])`, 'iu').test(label);
}
