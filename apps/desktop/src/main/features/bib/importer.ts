import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type DocumentRecord, type Note, type Project, type TaxonomyNode } from '@rl/core';
import type { OrganizerStore } from '@rl/data';
import { baseCitekey } from '@rl/export';
import { freeKey } from './keys.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { readBibtex } from './bibtex.js';
import { readCsl } from './csl.js';
import type { BibEntry, BibRead } from './entry.js';
import { buildIndex, resolveEntry, type Resolution } from './match.js';

const MAX_TEXT = 64 * 1024 * 1024;
const MAX_PDF = 2 * 1024 ** 3;
const KEY_OK = /^[A-Za-z0-9:_./+-]{1,100}$/;

interface Session {
  read: BibRead;
  res: Resolution[];
}
const sessions = new Map<string, Session>();

const notApproved = () => new AppError('INVALID_REQUEST', 'The file was not chosen with the file dialog', { reason: 'not-approved' });

/** Reads the source by its extension. The file is only read. */
export async function readSource(file: string, tmpRoot: string): Promise<BibRead> {
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) throw new AppError('NOT_FOUND', 'Not a file', { reason: 'not-a-file' });
  const ext = path.extname(file).toLowerCase();
  const base = path.dirname(file);
  if (ext === '.sqlite') return (await import('./zotero.js')).readZotero(file, tmpRoot);
  if (st.size > MAX_TEXT) throw new AppError('INVALID_REQUEST', 'The file is too large', { reason: 'too-large' });
  const text = await readFile(file, 'utf8');
  if (ext === '.json') return readCsl(text, base);
  if (ext === '.rdf' || ext === '.xml') return (await import('./rdf.js')).readRdf(text, base);
  return readBibtex(text, base);
}

/** Local on purpose: the main entry would otherwise carry helpers of @rl/core/node that only this lazy code uses. */
function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

async function hashPdf(abs: string): Promise<string | null> {
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile() || st.size > MAX_PDF || !/\.pdf$/i.test(abs)) return null;
  return sha256File(abs).catch(() => null);
}

export async function analyze(s: MainServices, req: { path: string }) {
  const file = s.approved.resolve(req.path, 'bib-source');
  if (file === null) throw notApproved();
  const read = await readSource(file, s.localDataDir);
  const rt = await s.runtime.require();
  const index = buildIndex(await rt.store.documents.list());
  const res: Resolution[] = [];
  for (const e of read.entries) res.push(await resolveEntry(e, { base: read.base, root: rt.store.rootPath, index, hashFile: hashPdf }));
  const previewId = randomUUID();
  sessions.set(previewId, { read, res });
  while (sessions.size > 2) sessions.delete(sessions.keys().next().value as string);
  const cols = new Map<string, number>();
  for (const e of read.entries) for (const c of e.collections) cols.set(c, (cols.get(c) ?? 0) + 1);
  return {
    previewId,
    source: read.source,
    entries: read.entries.length,
    inLibrary: res.filter((r) => r.kind === 'library').length,
    withFile: res.filter((r) => r.kind === 'external').length,
    noFile: res.filter((r) => r.kind === 'nofile').length,
    tags: new Set(read.entries.flatMap((e) => e.tags)).size,
    notes: read.entries.reduce((n, e) => n + e.notes.length, 0),
    collections: [...cols].slice(0, 500).map(([name, count]) => ({ name, count })),
  };
}

const hid = (prefix: string, text: string) => `${prefix}-${createHash('sha256').update(text.toLowerCase()).digest('hex').slice(0, 10)}`;
const label = (e: BibEntry) => (e.title ?? e.authors[0] ?? e.key ?? '?').slice(0, 300);

/** Fills a field only when it is empty or still holds what the app took from the file itself (D-071); the user's own values stay. */
export function mergeFields(d: DocumentRecord, e: BibEntry): DocumentRecord {
  const x = d.extracted;
  const out: DocumentRecord = { ...d, ref: { ...d.ref } };
  if (e.title !== null && (d.title === null || d.title === x?.title)) out.title = e.title;
  if (e.authors.length > 0 && (d.authors.length === 0 || (x?.authors && JSON.stringify(d.authors) === JSON.stringify(x.authors)))) out.authors = e.authors;
  if (e.year !== null && (d.year === null || d.year === x?.year)) out.year = e.year;
  if (e.doi !== null && (d.doi === null || d.doi === x?.doi)) out.doi = e.doi;
  if (e.arxivId !== null && (d.arxivId === null || d.arxivId === x?.arxivId)) out.arxivId = e.arxivId;
  if (e.venue !== null && !d.ref.venue && !d.ref.venueId) out.ref.venue = e.venue;
  if (e.venueRef !== null && !d.ref.venueRef) out.ref.venueRef = e.venueRef;
  return out;
}

export interface ImportRequest {
  previewId: string;
  collections: 'projects' | 'tags' | 'ignore';
  tags: boolean;
  notes: boolean;
  queueFiles: boolean;
}

/** Sends PDF paths to the inbox (given by the caller, which already has it: the lazy code does not import it). */
export type QueueFiles = (paths: string[]) => Promise<{ added: unknown[]; refused: Array<{ name: string; reason: string }> }>;

export async function importRun(s: MainServices, req: ImportRequest, queueFiles: QueueFiles) {
  const session = sessions.get(req.previewId);
  if (!session) throw new AppError('NOT_FOUND', 'The analysis is gone: choose the file again', { reason: 'expired' });
  const rt = await s.runtime.require();
  const changeId = `chg-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const cs = (rt.store as unknown as OrganizerStore).withChange({ changeId, summary: 'Import from Zotero or BibTeX' });
  const { read, res } = session;
  const notImported: Array<{ label: string; reason: string }> = [...read.skipped];
  const all = await rt.store.documents.list();
  const usedKeys = new Set(all.flatMap((d) => (d.citeKey ? [d.citeKey] : [])));
  const touched = new Set<string>();
  const byDoc = new Map<string, BibEntry[]>();
  const queue: string[] = [];
  read.entries.forEach((e, i) => {
    const r = res[i]!;
    if (r.kind === 'library') byDoc.set(r.docId, [...(byDoc.get(r.docId) ?? []), e]);
    else if (r.kind === 'external') {
      if (req.queueFiles) queue.push(...r.files);
      else notImported.push({ label: label(e), reason: 'not-queued' });
    } else notImported.push({ label: label(e), reason: 'no-file' });
  });

  // 1. Fields and cite keys of the documents already in the library.
  const final = new Map<string, DocumentRecord>();
  for (const [docId, es] of byDoc) {
    await cs.documents.update(docId, (cur) => {
      if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
      let next = cur;
      for (const e of es) next = mergeFields(next, e);
      if (!next.citeKey) {
        const wanted = es.map((e) => e.key).find((k): k is string => k !== null && KEY_OK.test(k) && !usedKeys.has(k));
        const key = wanted ?? freeKey(baseCitekey(next), usedKeys);
        usedKeys.add(key);
        next = { ...next, citeKey: key };
      }
      final.set(docId, next);
      return JSON.stringify(next) === JSON.stringify(cur) ? cur : { ...next, updatedAt: new Date().toISOString() };
    });
    touched.add(docId);
  }

  // 2. Tags (and, by choice, collections) to taxonomy nodes.
  let tagged = 0;
  const wanted = new Map<string, Set<string>>(); // label -> doc ids
  const addLabel = (l: string, docId: string) => wanted.set(l, (wanted.get(l) ?? new Set()).add(docId));
  for (const [docId, es] of byDoc) {
    for (const e of es) {
      if (req.tags) for (const t of e.tags) addLabel(t, docId);
      if (req.collections === 'tags') for (const c of e.collections) addLabel(c, docId);
    }
  }
  // Imported tag names resolve to the vocabulary with the sure rules (D-497): a variant goes to the canonical tag and becomes its alias,
  // the rest become new loose tags (origin `import`, convention name, the original as alias). Collections kept as tags sit under a
  // "Collezioni" family. Documents get the provenance `import` (D-494).
  const tagSummary = { total: 0, known: 0, merged: 0, fresh: 0 };
  if (wanted.size > 0) {
    const { resolveIncomingLabels, conventionName } = await import('@rl/data/tag-vocabulary');
    const tagLabels = new Set<string>();
    const colLabels = new Set<string>();
    for (const es of byDoc.values()) for (const e of es) {
      if (req.tags) for (const t of e.tags) tagLabels.add(t);
      if (req.collections === 'tags') for (const c of e.collections) colLabels.add(c);
    }
    const nodeOf = new Map<string, string>(); // incoming label -> node id (tags and collections are separate namespaces below)
    const colOf = new Map<string, string>();
    await cs.updateTaxonomy((tax) => {
      const nodes = tax.nodes.map((n) => ({ ...n }));
      const newId = (l: string) => {
        let id = hid('tag', l);
        for (let n = 2; nodes.some((x) => x.id === id); n++) id = `${hid('tag', l)}-${n}`;
        return id;
      };
      const now = new Date().toISOString();
      const r = resolveIncomingLabels([...tagLabels], nodes);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const exactIds = new Set<string>();
      for (const [l, id] of Object.entries(r.matched)) {
        nodeOf.set(l, id);
        if (r.aliasAdds.some((x) => x.alias === l)) {
          const n = byId.get(id)!;
          if (n.aliases.length < 50 && l.length <= 200) n.aliases = [...n.aliases, l];
          tagSummary.merged++;
        } else {
          exactIds.add(l);
          tagSummary.known++;
        }
      }
      for (const l of r.fresh) {
        const id = newId(l);
        const name = conventionName(l).slice(0, 200) || l.slice(0, 200);
        const node: TaxonomyNode = { id, label: name, parents: [], aliases: name === l ? [] : [l.slice(0, 200)], implies: [], status: 'active', origin: 'import', createdAt: now };
        nodes.push(node);
        byId.set(id, node);
        nodeOf.set(l, id);
        tagSummary.fresh++;
      }
      // Spelling duplicates of one fresh label (the resolver lists it once) share its node.
      for (const l of tagLabels) if (!nodeOf.has(l)) {
        const twin = [...tagLabels].find((x) => nodeOf.has(x) && x.normalize('NFKD').toLowerCase() === l.normalize('NFKD').toLowerCase());
        if (twin) nodeOf.set(l, nodeOf.get(twin)!);
      }
      tagSummary.total = tagLabels.size;
      if (colLabels.size > 0) {
        let fam = nodes.find((n) => n.status !== 'deprecated' && n.parents.length === 0 && n.label.toLowerCase() === 'collezioni');
        if (!fam) {
          fam = { id: newId('collezioni'), label: 'Collezioni', parents: [], aliases: [], implies: [], status: 'active', origin: 'import', family: 'many', createdAt: now };
          nodes.push(fam);
        }
        for (const l of colLabels) {
          const hit = nodes.find((n) => n.status !== 'deprecated' && n.parents.includes(fam!.id) && n.label.toLowerCase() === l.toLowerCase());
          if (hit) colOf.set(l, hit.id);
          else {
            const id = newId(`collezioni/${l}`);
            nodes.push({ id, label: l.slice(0, 200), parents: [fam.id], aliases: [], implies: [], status: 'active', origin: 'import', createdAt: now });
            colOf.set(l, id);
          }
        }
      }
      return JSON.stringify(nodes) === JSON.stringify(tax.nodes) ? tax : { ...tax, nodes };
    });
    for (const [docId, es] of byDoc) {
      const ids = new Set<string>();
      for (const e of es) {
        if (req.tags) for (const t of e.tags) ids.add(nodeOf.get(t)!);
        if (req.collections === 'tags') for (const c of e.collections) ids.add(colOf.get(c)!);
      }
      await cs.documents.update(docId, (cur) => {
        if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
        const add = [...ids].filter((id) => id && !cur.tags.includes(id));
        if (add.length === 0) return cur;
        tagged += add.length;
        const tagOrigin = { ...cur.tagOrigin };
        for (const id of add) tagOrigin[id] = 'import';
        return { ...cur, tags: [...cur.tags, ...add], tagOrigin, updatedAt: new Date().toISOString() };
      });
    }
  }

  // 3. Collections to projects.
  let projects = 0;
  if (req.collections === 'projects') {
    const members = new Map<string, Set<string>>();
    for (const [docId, es] of byDoc) for (const e of es) for (const c of e.collections) members.set(c, (members.get(c) ?? new Set()).add(docId));
    const existing = await cs.projects.list();
    for (const [name, docs] of members) {
      const now = new Date().toISOString();
      const same = existing.find((p) => p.name.toLowerCase() === name.toLowerCase() && p.status !== 'archived');
      const ids = same ? [] : await cs.projects.listIds();
      const id = same?.id ?? ((): string => {
        let x = hid('col', name);
        for (let n = 2; ids.includes(x); n++) x = `${hid('col', name)}-${n}`;
        return x;
      })();
      await cs.projects.update(id, (cur) => {
        const base: Project = cur ?? { schemaVersion: 1, id, revision: 0, kind: 'collection', name: name.slice(0, 200), description: '', status: 'active', members: [], notes: '', readingPlan: [], createdAt: now, updatedAt: now };
        const have = new Set(base.members.map((m) => m.docId));
        const add = [...docs].filter((d) => !have.has(d));
        return { ...base, members: [...base.members, ...add.map((docId) => ({ docId, addedAt: now }))], updatedAt: now };
      });
      projects++;
    }
  }

  // 4. Notes onto the documents' file notes (never replacing what the user wrote).
  let notes = 0;
  if (req.notes) {
    for (const [docId, es] of byDoc) {
      const texts = es.flatMap((e) => e.notes);
      if (texts.length === 0) continue;
      const now = new Date().toISOString();
      const cur = await rt.store.notes.get(docId);
      const fresh = texts.filter((t) => !cur?.body.includes(t));
      if (fresh.length === 0) continue;
      const body = (cur ? `${cur.body.trimEnd()}\n\n---\n\n` : '') + fresh.join('\n\n');
      const note: Note = { frontmatter: { docId, scope: 'file', createdAt: cur?.frontmatter.createdAt ?? now, updatedAt: now }, body };
      await rt.store.notes.put(note);
      notes += fresh.length;
    }
  }

  // 5. Files outside the library go through the inbox (the user confirms where they are copied).
  let queued = 0;
  if (queue.length > 0) {
    const r = await queueFiles([...new Set(queue)]);
    queued = r.added.length;
    for (const x of r.refused) notImported.push({ label: x.name, reason: x.reason });
  }

  const ids = [...touched];
  await rt.reindexDocuments(ids as never[]).catch((e: unknown) => s.log.warn('index refresh after an import failed', { error: e }));
  s.emit('library:changed', { kind: 'documents', ...(ids.length <= 500 ? { ids } : {}) });
  if (wanted.size > 0) s.emit('library:changed', { kind: 'taxonomy' });
  if (projects > 0) s.emit('library:changed', { kind: 'projects' });
  sessions.delete(req.previewId);
  return { changeId: ids.length + projects > 0 ? changeId : null, updated: ids.length, tagged, projects, notes, queued, notImported: notImported.slice(0, 500), ...(tagSummary.total > 0 ? { tagSummary } : {}) };
}
