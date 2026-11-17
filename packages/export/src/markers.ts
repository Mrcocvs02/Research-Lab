import { sha256, stripMarkers } from './text.js';

/**
 * Generated parts of a file sit between marker lines; whatever is outside them belongs to the user and is never touched.
 * Two spellings: an HTML comment (Markdown body) and a `#` comment (inside a YAML frontmatter fence).
 */
export type MarkerStyle = 'html' | 'yaml';

export interface Part {
  name: string;
  style?: MarkerStyle;
  /** Content between the markers, without the marker lines. */
  body: string;
}

const begin = (p: Part) => (p.style === 'yaml' ? `# rl:begin ${p.name}` : `<!-- rl:begin ${p.name} -->`);
const end = (p: Part) => (p.style === 'yaml' ? `# rl:end ${p.name}` : `<!-- rl:end ${p.name} -->`);
const trimEnd = (s: string) => s.replace(/\n+$/, '');

/** The block of a part as written in a file. */
export const renderPart = (p: Part): string => `${begin(p)}\n${trimEnd(p.body)}\n${end(p)}`;

export const partHash = (body: string): string => sha256(trimEnd(body));

interface Found {
  innerStart: number;
  innerStop: number;
}

/** Line-based search of the first complete `begin ... end` pair of a part. */
function find(text: string, p: Part): Found | null {
  const b = begin(p);
  const e = end(p);
  let at = 0;
  let innerStart = -1;
  for (;;) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    const line = text.slice(at, nl).replace(/\r$/, '');
    if (innerStart < 0) {
      if (line === b && nl < text.length) innerStart = nl + 1;
    } else if (line === e) {
      return { innerStart, innerStop: Math.max(innerStart, at - 1) };
    }
    if (nl >= text.length) return null;
    at = nl + 1;
  }
}

/** Current content of a part in `text` (null when its markers are missing). */
export function readPart(text: string, p: Pick<Part, 'name' | 'style'>): string | null {
  const f = find(text, { ...p, body: '' });
  return f === null ? null : text.slice(f.innerStart, f.innerStop).replace(/\r\n/g, '\n');
}

export type MergeStatus = 'new' | 'unchanged' | 'updated' | 'kept-edited';

export interface MergeResult {
  status: MergeStatus;
  /** Text to write (the existing text for `unchanged` and `kept-edited`). */
  text: string;
  /** Hash of every generated part of the file as it is on disk after the merge. */
  hashes: Record<string, string>;
}

/**
 * Merges the generated `parts` into `existing` (null: the file does not exist yet; `fresh` lays a new file out).
 * `known` holds the hashes of the parts as the previous export wrote them: when a part on disk no longer matches, the user
 * edited inside it and the whole file is kept as it is (`kept-edited`). A file that exists with no known hashes is not
 * ours: kept too. A part whose markers the user deleted stays deleted; a part that is new to the file is appended.
 */
export function mergeParts(
  existing: string | null,
  parts: readonly Part[],
  known: Readonly<Record<string, string>> | undefined,
  fresh: (parts: readonly Part[]) => string,
): MergeResult {
  const clean = parts.map((p) => ({ ...p, body: stripMarkers(p.body) }));
  if (existing === null) return { status: 'new', text: fresh(clean), hashes: Object.fromEntries(clean.map((p) => [p.name, partHash(p.body)])) };
  if (!known) return { status: 'kept-edited', text: existing, hashes: {} };
  let text = existing;
  const hashes: Record<string, string> = {};
  let changed = false;
  for (const p of clean) {
    const f = find(text, p);
    if (!f) {
      if (known[p.name] === undefined) {
        text = `${text.replace(/\n*$/, '\n\n')}${renderPart(p)}\n`;
        hashes[p.name] = partHash(p.body);
        changed = true;
      }
      continue;
    }
    const current = text.slice(f.innerStart, f.innerStop).replace(/\r\n/g, '\n');
    const knownHash = known[p.name];
    if (knownHash === undefined || partHash(current) !== knownHash) return { status: 'kept-edited', text: existing, hashes: { ...known } };
    const next = partHash(p.body);
    hashes[p.name] = next;
    if (next !== knownHash) {
      text = `${text.slice(0, f.innerStart)}${trimEnd(p.body)}${text.slice(f.innerStop)}`;
      changed = true;
    }
  }
  return { status: changed ? 'updated' : 'unchanged', text: changed ? text : existing, hashes };
}

/** Lays parts out one after the other, separated by a blank line. */
export const layoutParts = (parts: readonly Part[]): string => `${parts.map(renderPart).join('\n\n')}\n`;
