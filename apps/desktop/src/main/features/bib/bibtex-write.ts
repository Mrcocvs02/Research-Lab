import type { DocumentRecord } from '@rl/core';

export const GENERATED_LINE = '% Generato da Research Lab: le modifiche qui verranno sovrascritte';

/** A BibTeX field value: braces kept when balanced, LaTeX specials escaped. */
export function esc(s: string): string {
  let depth = 0;
  let balanced = true;
  for (const c of s) {
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) balanced = false;
  }
  balanced = balanced && depth === 0;
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_]/g, '\\$&')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/[{}]/g, (c) => (balanced ? c : `\\${c}`));
}

export type BibDoc = Pick<DocumentRecord, 'title' | 'authors' | 'year' | 'doi' | 'arxivId' | 'ref'>;

const PROCEEDINGS = /proceedings|conference|workshop|symposium|congress|meeting/i;

export function bibtexEntry(d: BibDoc, key: string): string {
  const venue = d.ref.venue ?? null;
  const type = venue === null ? 'misc' : PROCEEDINGS.test(venue) ? 'inproceedings' : 'article';
  const lines: Array<[string, string]> = [];
  if (d.title) lines.push(['title', `{${esc(d.title)}}`]);
  if (d.authors.length > 0) lines.push(['author', `{${d.authors.map(esc).join(' and ')}}`]);
  if (d.year !== null) lines.push(['year', `{${d.year}}`]);
  if (venue !== null) lines.push([type === 'inproceedings' ? 'booktitle' : 'journal', `{${esc(venue)}}`]);
  if (d.ref.venueRef) lines.push(['note', `{${esc(d.ref.venueRef)}}`]);
  if (d.doi) lines.push(['doi', `{${d.doi.replace(/[{}\\]/g, '')}}`]);
  if (d.arxivId) lines.push(['eprint', `{${d.arxivId.replace(/[{}\\]/g, '')}}`], ['archiveprefix', '{arXiv}']);
  return `@${type}{${key},\n${lines.map(([k, v]) => `  ${k} = ${v}`).join(',\n')}\n}\n`;
}

/** The whole file: the generated-by line, then the entries in key order. */
export function bibtexFile(docs: ReadonlyArray<{ doc: BibDoc; key: string }>): string {
  const body = [...docs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((x) => bibtexEntry(x.doc, x.key));
  return `${GENERATED_LINE}\n\n${body.join('\n')}`;
}
