import { blank, cleanAuthors, cleanList, clip, LIMITS, normArxiv, normDoi, yearOf, type BibEntry, type BibRead } from './entry.js';

/** A minimal XML tree: enough for Zotero RDF. No entity beyond the five and numeric ones, no DTD, no external reference. */
interface Node {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

const MAX_NODES = 2_000_000;
const MAX_DEPTH = 64;

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] ?? '';
  });
}

function parseXml(xml: string): Node {
  const root: Node = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: Node[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?!--)[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let nodes = 0;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3] !== undefined) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
      } else {
        if (++nodes > MAX_NODES || stack.length > MAX_DEPTH) throw new Error('xml-too-big');
        const attrs: Record<string, string> = {};
        for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? '');
        const node: Node = { name: m[3], attrs, children: [], text: '' };
        top.children.push(node);
        if (m[5] !== '/') stack.push(node);
      }
    }
  }
  return root;
}

const child = (n: Node, name: string): Node | undefined => n.children.find((c) => c.name === name);
const kids = (n: Node, name: string): Node[] => n.children.filter((c) => c.name === name);
const textOf = (n: Node | undefined): string | null => (n ? clip(n.text) : null);
const find = (n: Node, name: string): Node | undefined => {
  for (const c of n.children) {
    if (c.name === name) return c;
    const d = find(c, name);
    if (d) return d;
  }
  return undefined;
};

function htmlToText(h: string): string {
  const plain = h
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => (e.toLowerCase() === 'nbsp' ? ' ' : decode(`&${e};`)));
  return plain.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

const refOf = (n: Node): string | null => {
  const r = n.attrs['rdf:resource'] ?? null;
  return r === null ? null : r.replace(/^#/, '');
};

/** Zotero RDF (File > Export > Zotero RDF): items, attachments, notes (Memo) and collections. Minimal. */
export function readRdf(xml: string, base: string): BibRead {
  let tree: Node;
  try {
    tree = parseXml(xml);
  } catch {
    return { source: 'rdf', entries: [], base, skipped: [{ label: 'file', reason: 'invalid' }] };
  }
  const rdf = find(tree, 'rdf:RDF');
  if (!rdf) return { source: 'rdf', entries: [], base, skipped: [{ label: 'file', reason: 'invalid' }] };
  const byId = new Map<string, Node>();
  for (const n of rdf.children) {
    const id = n.attrs['rdf:about'];
    if (id) byId.set(id.replace(/^#/, ''), n);
  }
  const attachments = new Set<string>();
  const memos = new Set<string>();
  for (const [id, n] of byId) {
    if (n.name === 'z:Attachment') attachments.add(id);
    else if (n.name === 'bib:Memo') memos.add(id);
  }
  const collections = rdf.children.filter((n) => n.name === 'z:Collection');
  const entries: BibEntry[] = [];
  const skipped: BibRead['skipped'] = [];
  const entryOf = new Map<string, BibEntry>();
  for (const [id, n] of byId) {
    if (attachments.has(id) || memos.has(id) || n.name === 'z:Collection' || n.name === 'z:Feed' || entries.length >= LIMITS.entries) continue;
    const e = blank();
    e.title = textOf(child(n, 'dc:title'));
    const names: string[] = [];
    for (const group of [child(n, 'bib:authors'), child(n, 'bib:editors')]) {
      if (!group) continue;
      for (const p of group.children.flatMap((s) => (s.name === 'rdf:Seq' ? s.children : [s]))) {
        const person = p.name === 'rdf:li' ? (p.children[0] ?? p) : p;
        const sur = textOf(child(person, 'foaf:surname'));
        const given = textOf(child(person, 'foaf:givenName') ?? child(person, 'foaf:givenname'));
        if (sur !== null) names.push(given ? `${sur}, ${given}` : sur);
      }
      if (names.length > 0) break;
    }
    e.authors = cleanAuthors(names);
    e.year = yearOf(textOf(child(n, 'dc:date')));
    const part = child(n, 'dcterms:isPartOf');
    const container = part ? (part.children[0] ?? null) : null;
    e.venue = clip(textOf(container ? child(container, 'dc:title') : undefined), 500);
    const vol = container ? textOf(child(container, 'prism:volume')) : null;
    const num = container ? textOf(child(container, 'prism:number')) : null;
    const pages = textOf(child(n, 'bib:pages'));
    e.venueRef = clip([vol && `vol. ${vol}`, num && `no. ${num}`, pages && `pp. ${pages}`].filter(Boolean).join(', '), 500);
    const ids = kids(n, 'dc:identifier').map((x) => (find(x, 'rdf:value')?.text ?? x.text).trim());
    e.doi = normDoi(ids.find((x) => /10\.\d{4,9}\//.test(x)) ?? null);
    e.arxivId = normArxiv(ids.find((x) => /arxiv/i.test(x)) ?? null);
    e.tags = cleanList(kids(n, 'dc:subject').map((x) => x.text));
    for (const link of n.children) {
      const r = refOf(link) ?? (link.children[0] ? refOf(link.children[0]) : null);
      if (r === null) continue;
      if (attachments.has(r)) {
        const f = child(byId.get(r)!, 'rdf:resource');
        const p = f?.attrs['rdf:resource'];
        if (p) e.files.push(p.replace(/^file:\/\//, ''));
      } else if (memos.has(r)) {
        const t = clip(htmlToText(find(byId.get(r)!, 'rdf:value')?.text ?? ''), LIMITS.notes);
        if (t) e.notes.push(t);
      }
    }
    // Memos can also be nested in the item (`<dcterms:isReferencedBy><bib:Memo>`).
    for (const memo of n.children.flatMap((c) => c.children).filter((c) => c.name === 'bib:Memo')) {
      const t = clip(htmlToText(find(memo, 'rdf:value')?.text ?? ''), LIMITS.notes);
      if (t) e.notes.push(t);
    }
    if (e.title === null && e.authors.length === 0) {
      skipped.push({ label: id, reason: 'empty' });
      continue;
    }
    entries.push(e);
    entryOf.set(id, e);
  }
  for (const c of collections) {
    const name = clip(textOf(child(c, 'dc:title')), 300);
    if (name === null) continue;
    for (const part of kids(c, 'dcterms:hasPart')) {
      const e = entryOf.get(refOf(part) ?? '');
      if (e && !e.collections.includes(name)) e.collections.push(name);
    }
  }
  return { source: 'rdf', entries, base, skipped: skipped.slice(0, 500) };
}
