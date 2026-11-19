import path from 'node:path';
import { AppError, type ImportIdAddResult, type ImportIdItem, type InboxMetadata } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { lookupEntry } from '../../inbox/service.js';
import { addReferences, allStored } from '../resources/service.js';
import { downloadArxivPdf } from './download.js';
import { parseLines, type ParsedLine } from './parse.js';

type Found = { state: 'recognized'; meta: InboxMetadata } | { state: 'not-found' } | { state: 'offline'; error: boolean };

/** What the last resolve found, so that "Add" does not ask the services again (a few minutes, a few dozen entries). */
const recent = new Map<string, { at: number; meta: InboxMetadata }>();
const KEEP_MS = 10 * 60_000;
const keyOf = (kind: string, id: string) => `${kind}:${id.toLowerCase()}`;

const arxivBase = (id: string) => id.toLowerCase().replace(/v\d+$/, '');

async function look(s: MainServices, p: { kind: 'doi' | 'arxiv'; id: string }): Promise<Found> {
  const cached = recent.get(keyOf(p.kind, p.id));
  if (cached && Date.now() - cached.at < KEEP_MS) return { state: 'recognized', meta: cached.meta };
  const r = await lookupEntry(s, p.kind === 'doi' ? { doi: p.id } : { arxivId: p.id });
  if (r.lookup.state === 'found' && r.metadata) {
    recent.set(keyOf(p.kind, p.id), { at: Date.now(), meta: r.metadata });
    while (recent.size > 60) recent.delete(recent.keys().next().value as string);
    return { state: 'recognized', meta: r.metadata };
  }
  if (r.lookup.state === 'not-found' || r.lookup.state === 'skipped') return { state: 'not-found' };
  return { state: 'offline', error: r.lookup.state === 'error' };
}

async function existing(s: MainServices) {
  const rt = await s.runtime.require();
  const docs = await rt.store.documents.list();
  const res = await allStored(s);
  const doc = (kind: 'doi' | 'arxiv', id: string) =>
    docs.find((d) => (kind === 'doi' ? d.doi?.toLowerCase() === id.toLowerCase() : d.arxivId !== null && arxivBase(d.arxivId) === arxivBase(id)));
  const resource = (kind: 'doi' | 'arxiv', id: string) => res.find((r) => (kind === 'doi' ? r.doi?.toLowerCase() === id.toLowerCase() : r.arxivId !== null && arxivBase(r.arxivId) === arxivBase(id)));
  return (kind: 'doi' | 'arxiv', id: string): ImportIdItem['existing'] | undefined => {
    const d = doc(kind, id);
    if (d) return { kind: 'document', id: d.id, title: d.title };
    const r = resource(kind, id);
    return r ? { kind: 'resource', id: r.id, title: r.title } : undefined;
  };
}

export async function resolve(s: MainServices, req: { text: string }): Promise<{ items: ImportIdItem[] }> {
  const lines = parseLines(req.text);
  const known = await existing(s);
  const items: ImportIdItem[] = [];
  for (const l of lines) {
    if (l.kind === null) {
      items.push({ input: l.input, kind: null, id: null, state: 'invalid', ...(l.reason ? { reason: l.reason } : {}), canDownload: false });
      continue;
    }
    const base = { input: l.input, kind: l.kind, id: l.id!, canDownload: l.kind === 'arxiv' };
    const dup = known(l.kind, l.id!);
    if (dup) {
      items.push({ ...base, state: 'in-library', existing: dup, canDownload: false });
      continue;
    }
    const f = await look(s, { kind: l.kind, id: l.id! });
    if (f.state === 'recognized') items.push({ ...base, state: 'recognized', metadata: { title: f.meta.title, authors: f.meta.authors.slice(0, 20), year: f.meta.year, venue: f.meta.venue } });
    else if (f.state === 'not-found') items.push({ ...base, state: 'not-found', canDownload: false });
    else items.push({ ...base, state: 'offline', ...(f.error ? { reason: 'error' } : {}), canDownload: false });
  }
  return { items };
}

export type QueueFiles = (paths: string[]) => Promise<{ added: unknown[]; refused: Array<{ name: string; reason: string }> }>;

/**
 * Adds the recognised entries. Without the PDF an entry becomes a data-only "reference" (status "Senza file"). With
 * `downloadPdf` (the user ticked it), the open arXiv PDF is downloaded into the app's local data and queued in the inbox,
 * where the user still confirms the name and the folder; the inbox item carries the same record, so no reference is made.
 */
export async function add(s: MainServices, req: { entries: Array<{ kind: 'doi' | 'arxiv'; id: string }>; downloadPdf: boolean }, queueFiles: QueueFiles): Promise<ImportIdAddResult> {
  const lines: ParsedLine[] = parseLines(req.entries.map((e) => (e.kind === 'doi' ? `doi:${e.id}` : `arxiv:${e.id}`)).join('\n'));
  const known = await existing(s);
  let skipped = 0;
  let queued = 0;
  let failedDownloads = 0;
  const refs: Parameters<typeof addReferences>[1] = [];
  for (const l of lines) {
    if (l.kind === null || known(l.kind, l.id!)) {
      skipped++;
      continue;
    }
    const f = await look(s, { kind: l.kind, id: l.id! });
    if (f.state !== 'recognized') {
      if (f.state === 'offline') throw new AppError('NETWORK_ERROR', 'The online source cannot be reached', { reason: 'offline' });
      skipped++;
      continue;
    }
    if (req.downloadPdf && l.kind === 'arxiv') {
      try {
        const file = await downloadArxivPdf(l.id!, path.join(s.localDataDir, 'downloads'), s.fetch ?? fetch);
        const r = await queueFiles([file]);
        if (r.added.length > 0) {
          queued++;
          continue;
        }
        failedDownloads++;
      } catch (e) {
        s.log.warn('downloading an arXiv PDF failed', { error: e });
        failedDownloads++;
      }
    }
    refs.push({ kind: l.kind, id: l.id!, title: f.meta.title, authors: f.meta.authors, year: f.meta.year, doi: f.meta.doi, arxivId: f.meta.arxivId });
  }
  const added = await addReferences(s, refs);
  return { added: added + queued, skipped, queued, failedDownloads };
}
