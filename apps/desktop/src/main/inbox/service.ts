import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, open, readFile, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { activeTagNodes, cleanSuggestion, estimateCostFromModels, folderOf, inEnabledFolder, suggestPrompt, suggestSchema, suggestSystem, tagResolver, taxonomyBlock, type SuggestRaw } from '@rl/ai';
import { fetchWorkMetadata, WorkLookupError } from '@rl/citations';
import {
  AppError,
  documentIdFromHash,
  documentRecordSchema,
  INBOX_LIMITS,
  inboxMetadataSchema,
  relativePathSchema,
  SCHEMA_VERSION,
  type AiMeta,
  type AiNewTag,
  type DocumentId,
  type DocumentRecord,
  type InboxItem,
  type InboxMetadata,
  type LibraryConfig,
  type TaxonomyFile,
} from '@rl/core';
import { isInside, normalizeRelativePath, resolveInRoot, sha256File } from '@rl/core/node';
import { applyTaxonomyOps, createTextExtractor, type OrganizerStore } from '@rl/data';
import { availability, monthUsage, type AiCtx } from '../ai/service.js';
import { JOB_EXCERPT_CHARS } from '../ai/jobs.js';
import { trackAbort } from '../ai/abort-registry.js';
import { monthOf, usdOfUsage } from '../ai/usage.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { isValidCopyName, proposedFileName } from './names.js';
import { InboxStore, type Dropped, type Entry } from './store.js';

type Refused = { name: string; reason: 'not-pdf' | 'too-large' | 'not-found' | 'in-library' | 'already-queued' | 'limit' };
type Detected = Partial<InboxMetadata>;

const MAX_SIMILAR_TAGS = 8;
const SIMILAR_HITS = 5;

/* ------------------------------------------------ context ------------------------------------------------ */

interface Ctx {
  s: MainServices;
  rt: LibraryRuntime;
  cfg: LibraryConfig;
  root: string;
  dataDir: string;
  store: InboxStore;
}

async function openCtx(s: MainServices): Promise<Ctx> {
  const rt = await s.runtime.require();
  return {
    s,
    rt,
    cfg: await rt.store.readConfig(),
    root: (await s.libraries.profile(rt.libraryId)).rootPath,
    dataDir: await s.libraries.dataDir(rt.libraryId),
    store: new InboxStore(s.localDataDir, rt.libraryId),
  };
}

/* ----------------------------------------- snapshot of the library ----------------------------------------- */

const norm = (t: string) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const doiKey = (d: string) => d.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
const arxivBase = (id: string) => id.trim().replace(/^arxiv:\s*/i, '').replace(/v\d+$/i, '').toLowerCase();
const arxivVersion = (id: string) => /v(\d+)$/i.exec(id.trim())?.[1] ?? null;
const familyOf = (a: string) => norm(a.includes(',') ? a.split(',')[0]! : (a.trim().split(/\s+/).at(-1) ?? ''));

interface Snap {
  records: DocumentRecord[];
  byId: Map<string, DocumentRecord>;
  byHash: Map<string, DocumentRecord>;
  byDoi: Map<string, DocumentRecord[]>;
  byArxiv: Map<string, DocumentRecord[]>;
  byTitle: Map<string, DocumentRecord[]>;
  tax: TaxonomyFile;
  excluded: string[];
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);

async function snapshot(c: Ctx): Promise<Snap> {
  const records = await c.rt.store.documents.list();
  const snap: Snap = { records, byId: new Map(), byHash: new Map(), byDoi: new Map(), byArxiv: new Map(), byTitle: new Map(), tax: await c.rt.store.readTaxonomy(), excluded: c.cfg.excludedFolders };
  for (const r of records) {
    snap.byId.set(r.id, r);
    snap.byHash.set(r.hash, r);
    if (r.doi) push(snap.byDoi, doiKey(r.doi), r);
    if (r.arxivId) push(snap.byArxiv, arxivBase(r.arxivId), r);
    if (r.title && r.authors[0]) push(snap.byTitle, `${norm(r.title)}|${familyOf(r.authors[0])}`, r);
  }
  return snap;
}

/** Windows folders are case-insensitive: `private` is the excluded `Private`. */
const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** `folder` must already be normalised (`normalizeRelativePath`); the excluded entries are normalised the same way. */
const isExcluded = (folder: string, excluded: readonly string[]) => {
  const f = fold(folder);
  return excluded.some((raw) => {
    let e: string;
    try {
      e = normalizeRelativePath(raw);
    } catch {
      e = raw;
    }
    e = fold(e);
    return f === e || f.startsWith(`${e}/`);
  });
};

const BACKSLASH = String.fromCharCode(92);
/** Network and device paths (UNC, verbatim and device forms all start with two separators): resolving one would contact that host. */
const isNetworkPath = (p: string) => p.startsWith(BACKSLASH + BACKSLASH) || p.startsWith('//');

/** Duplicate of a file already in the library (`same-file` > `same-work` > `version`); `selfId` is skipped (a library item is not its own duplicate). */
function duplicateOf(snap: Snap, who: { selfId: string | null; id: string; hash: string | null; metas: Detected[] }): InboxItem['duplicate'] {
  const other = (rs: DocumentRecord[] | undefined) => rs?.find((r) => r.id !== who.selfId && !r.missing);
  const view = (kind: 'same-file' | 'same-work' | 'version', r: DocumentRecord) => ({ kind, docId: r.id, title: r.title, path: r.path });
  if (who.hash) {
    const r = snap.byHash.get(who.hash) ?? snap.byId.get(who.id);
    if (r && r.id !== who.selfId) return view('same-file', r);
  }
  // The identifiers read from the file and those of the online record both count.
  for (const m of who.metas) {
    const byDoi = m.doi ? other(snap.byDoi.get(doiKey(m.doi))) : undefined;
    if (byDoi) return view('same-work', byDoi);
  }
  let versionOf: DocumentRecord | undefined;
  for (const m of who.metas) {
    if (!m.arxivId) continue;
    const v = arxivVersion(m.arxivId);
    for (const r of snap.byArxiv.get(arxivBase(m.arxivId)) ?? []) {
      if (r.id === who.selfId || r.missing) continue;
      const rv = r.arxivId ? arxivVersion(r.arxivId) : null;
      if (v && rv && v !== rv) versionOf ??= r;
      else return view('same-work', r);
    }
  }
  if (versionOf) return view('version', versionOf);
  for (const m of who.metas) {
    if (!m.title || !m.authors?.[0]) continue;
    const r = other(snap.byTitle.get(`${norm(m.title)}|${familyOf(m.authors[0])}`));
    if (r) return view('version', r);
  }
  return null;
}

/* ----------------------------------------------- proposals ----------------------------------------------- */

/** The non-excluded folder holding most documents that share the proposed tags; else the folder of the nearest document; else ''. */
function proposeFolder(snap: Snap, tagIds: readonly string[], nearFolder: string | undefined): string {
  if (tagIds.length > 0) {
    const want = new Set(tagIds);
    const score = new Map<string, number>();
    for (const r of snap.records) {
      if (r.missing) continue;
      const folder = folderOf(r.path);
      if (isExcluded(folder, snap.excluded)) continue;
      const shared = r.tags.filter((t) => want.has(t)).length;
      if (shared > 0) score.set(folder, (score.get(folder) ?? 0) + shared);
    }
    const best = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best) return best[0];
  }
  return nearFolder !== undefined && !isExcluded(nearFolder, snap.excluded) ? nearFolder : '';
}

const activeIds = (tax: TaxonomyFile) => new Set(tax.nodes.filter((n) => n.status === 'active').map((n) => n.id));

/** Tags of the most similar documents (the existing search over title and key terms), active nodes only. */
async function similarOf(c: Ctx, snap: Snap, meta: Detected): Promise<{ tags: string[]; nearFolder: string | undefined }> {
  const words = [...new Set(norm(meta.title ?? '').split(' ').filter((w) => w.length >= 4))].sort((a, b) => b.length - a.length).slice(0, 6);
  if (words.length === 0) return { tags: [], nearFolder: undefined };
  const page = await c.rt.search({ text: words.join(' OR '), limit: SIMILAR_HITS });
  const hits = page.hits.filter((h) => !snap.byId.get(h.docId)?.inbox);
  const count = new Map<string, number>();
  for (const h of hits) for (const t of new Set(h.directTags ?? h.tags)) count.set(t, (count.get(t) ?? 0) + 1);
  const need = hits.length >= 2 ? 2 : 1;
  const active = activeIds(snap.tax);
  const tags = [...count].filter(([t, n]) => n >= need && active.has(t)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_SIMILAR_TAGS).map(([t]) => t);
  return { tags, nearFolder: hits[0] ? folderOf(hits[0].path) : undefined };
}

const metaOf = (entry: Entry, detected: Detected): Detected => (entry.metadata ? { ...detected, ...entry.metadata } : detected);
const compact = (m: Detected): Detected => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))) as Detected;

function proposalOf(snap: Snap, entry: Entry, meta: Detected, fileName: string | null) {
  const tagIds = entry.ai ? entry.ai.tagIds : entry.similar;
  return {
    ...(fileName !== null ? { name: proposedFileName(meta, fileName), folder: proposeFolder(snap, tagIds, entry.nearFolder) } : {}),
    tagIds: tagIds.slice(0, 100),
    newTags: entry.ai?.newTags ?? [],
    tagsFrom: entry.ai ? ('ai' as const) : tagIds.length > 0 ? ('similar' as const) : ('none' as const),
  };
}

const droppedView = (snap: Snap, d: Dropped): InboxItem => {
  const meta = metaOf(d.entry, d.detected);
  return {
    id: d.id,
    kind: 'dropped',
    fileName: d.fileName,
    size: d.size,
    addedAt: d.addedAt,
    detected: compact(d.detected),
    lookup: d.entry.lookup,
    metadata: d.entry.metadata,
    duplicate: duplicateOf(snap, { selfId: null, id: d.id, hash: d.hash, metas: [d.detected, meta] }),
    proposal: proposalOf(snap, d.entry, meta, d.fileName),
  };
};

const detectedOfRecord = (r: DocumentRecord): Detected => compact({ title: r.title, authors: r.authors, year: r.year, doi: r.doi, arxivId: r.arxivId });
const defaultEntry = (hasRef: boolean): Entry => ({ lookup: { state: hasRef ? 'pending' : 'skipped' }, metadata: null, similar: [] });

const libraryView = (snap: Snap, r: DocumentRecord, entry: Entry): InboxItem => {
  const detected = detectedOfRecord(r);
  const meta = metaOf(entry, detected);
  return {
    id: r.id as DocumentId,
    kind: 'library',
    fileName: path.posix.basename(r.path),
    path: r.path,
    size: r.size,
    addedAt: r.inbox?.since ?? r.addedAt,
    detected,
    lookup: entry.lookup,
    metadata: entry.metadata,
    duplicate: duplicateOf(snap, { selfId: r.id, id: r.id, hash: null, metas: [detected, meta] }),
    proposal: proposalOf(snap, entry, meta, null),
  };
};

/* --------------------------------------------- online lookup --------------------------------------------- */

async function lookupEntry(s: MainServices, ref: { doi?: string | undefined; arxivId?: string | undefined }): Promise<Pick<Entry, 'lookup' | 'metadata'>> {
  const checkedAt = new Date().toISOString();
  if (!ref.doi && !ref.arxivId) return { lookup: { state: 'skipped' }, metadata: null };
  const finish = (source: 'openalex' | 'arxiv', raw: unknown) => {
    const p = inboxMetadataSchema.safeParse(raw);
    return p.success ? { lookup: { state: 'found' as const, source, checkedAt }, metadata: p.data } : { lookup: { state: 'error' as const, checkedAt }, metadata: null };
  };
  if (s.metadataFile) {
    // Test hook (development run with RL_E2E=1 only): a file replaces the network.
    let table: Record<string, unknown> = {};
    try {
      table = JSON.parse(await readFile(s.metadataFile, 'utf8')) as Record<string, unknown>;
    } catch {
      return { lookup: { state: 'error', checkedAt }, metadata: null };
    }
    const byDoi = ref.doi ? table[`doi:${doiKey(ref.doi)}`] : undefined;
    if (byDoi) return finish('openalex', byDoi);
    const byArxiv = ref.arxivId ? table[`arxiv:${arxivBase(ref.arxivId)}`] : undefined;
    if (byArxiv) return finish('arxiv', byArxiv);
    return { lookup: { state: 'not-found', checkedAt }, metadata: null };
  }
  if (s.isOnline && !s.isOnline()) return { lookup: { state: 'offline' }, metadata: null };
  try {
    const r = await fetchWorkMetadata(ref, { fetch: s.fetch ?? fetch });
    if (!r) return { lookup: { state: 'not-found', checkedAt }, metadata: null };
    return finish(r.source, { ...r.metadata, abstract: r.metadata.abstract?.slice(0, INBOX_LIMITS.abstract) ?? null });
  } catch (e) {
    if (e instanceof WorkLookupError) return { lookup: { state: 'error', checkedAt }, metadata: null };
    throw e;
  }
}

/* -------------------------------------------- background work -------------------------------------------- */

let background: Promise<unknown> = Promise.resolve();
const inflight = new Set<string>();
const retried = new Set<string>();

/** Resolves when the lookups scheduled so far are done (tests). */
export async function whenInboxIdle(): Promise<void> {
  let last: Promise<unknown>;
  do {
    last = background;
    await last.catch(() => undefined);
  } while (last !== background);
}

function schedule(c: Ctx, key: string, job: () => Promise<void>, onFail?: () => Promise<void>): void {
  if (inflight.has(key)) return;
  inflight.add(key);
  background = background
    .then(job)
    .catch(async (e: unknown) => {
      c.s.log.warn('inbox lookup failed', { error: e });
      // A failed enrichment leaves a negative entry: the next listing must not schedule it again (no reload loop).
      await onFail?.().catch(() => undefined);
    })
    .finally(() => {
      inflight.delete(key);
      void emitChanged(c.s);
    });
}

async function emitChanged(s: MainServices): Promise<void> {
  try {
    const c = await openCtx(s);
    const file = await c.store.read();
    const flagged = (await c.rt.store.documents.list()).filter((r) => r.inbox && !r.missing).length;
    if (file.flagged !== flagged) await c.store.update((d) => void (d.flagged = flagged));
    s.emit('inbox:changed', { count: Math.min(INBOX_LIMITS.items, file.items.length + flagged) });
  } catch {
    /* no library open: nobody listens */
  }
}

async function enrich(c: Ctx, target: { kind: 'dropped'; id: string } | { kind: 'library'; id: string }, relookup: boolean): Promise<void> {
  const file = await c.store.read();
  const dropped = target.kind === 'dropped' ? file.items.find((i) => i.id === target.id) : undefined;
  const rec = target.kind === 'library' ? await c.rt.store.documents.get(target.id as DocumentId) : null;
  if (!dropped && !rec) return;
  const detected = dropped ? dropped.detected : detectedOfRecord(rec!);
  const prev = dropped ? dropped.entry : (file.cache[target.id] ?? defaultEntry(Boolean(detected.doi || detected.arxivId)));
  const looked = relookup || prev.lookup.state === 'pending' || prev.lookup.state === 'offline' ? await lookupEntry(c.s, { doi: detected.doi ?? undefined, arxivId: detected.arxivId ?? undefined }) : { lookup: prev.lookup, metadata: prev.metadata };
  const meta = looked.metadata ? { ...detected, ...looked.metadata } : detected;
  const snap = await snapshot(c);
  const sim = await similarOf(c, snap, meta).catch(() => ({ tags: [] as string[], nearFolder: undefined }));
  await c.store.update((draft) => {
    const entry: Entry = { ...prev, ...looked, similar: sim.tags, ...(sim.nearFolder !== undefined ? { nearFolder: sim.nearFolder } : {}) };
    if (dropped) {
      const d = draft.items.find((i) => i.id === dropped.id);
      if (d) d.entry = entry;
    } else draft.cache[target.id] = entry;
  });
}

/* ----------------------------------------------------- list ----------------------------------------------------- */

/**
 * The badge: dropped items of the local queue plus the flagged library files remembered from the last listing or
 * recount. Reads no document (unless `recount`) and never looks anything up online.
 */
export async function countInbox(s: MainServices, recount: boolean): Promise<{ count: number; dropped: number; library: number }> {
  const c = await openCtx(s);
  const file = await c.store.read();
  let flagged = file.flagged ?? 0;
  if (recount) {
    flagged = (await c.rt.store.documents.list()).filter((r) => r.inbox && !r.missing).length;
    if (file.flagged !== flagged) await c.store.update((d) => void (d.flagged = flagged));
  }
  return { count: Math.min(INBOX_LIMITS.items, file.items.length + flagged), dropped: file.items.length, library: flagged };
}

/** Lists the inbox. Online lookups of flagged library files start here, so only when the Inbox view is open or on an explicit action. */
export async function listInbox(s: MainServices): Promise<{ items: InboxItem[] }> {
  const c = await openCtx(s);
  const file = await c.store.read();
  const snap = await snapshot(c);
  const items: InboxItem[] = file.items.map((d) => droppedView(snap, d));
  const flagged = snap.records.filter((r) => r.inbox && !r.missing).sort((a, b) => (a.inbox!.since < b.inbox!.since ? 1 : -1));
  for (const r of flagged) {
    const cached = file.cache[r.id];
    const entry = cached ?? defaultEntry(Boolean(r.doi || r.arxivId));
    // First time listed (or offline before and online now): the lookup runs once, in the background.
    const online = !s.isOnline || s.isOnline() || Boolean(s.metadataFile);
    const again = cached?.lookup.state === 'offline' && online && !retried.has(r.id);
    if ((!cached && !retried.has(r.id)) || again) {
      retried.add(r.id);
      schedule(
        c,
        `lib:${r.id}`,
        () => enrich(c, { kind: 'library', id: r.id }, false),
        () => c.store.update((d) => void (d.cache[r.id] ??= { lookup: { state: 'error', checkedAt: new Date().toISOString() }, metadata: null, similar: [] })),
      );
    }
    items.push(libraryView(snap, r, entry));
  }
  const total = Math.min(INBOX_LIMITS.items, items.length);
  if (file.flagged !== flagged.length) await c.store.update((d) => void (d.flagged = flagged.length));
  return { items: items.slice(0, total) };
}

/* ------------------------------------------------------ add ------------------------------------------------------ */

async function readHeader(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fh.read(buf, 0, 5, 0);
    return buf.subarray(0, bytesRead).toString('latin1');
  } finally {
    await fh.close();
  }
}

/**
 * `trusted`: the paths come from the dialog main itself showed (`inbox:choose`). Paths from the renderer (`inbox:add`)
 * are untrusted: a network or device path is never opened (merely resolving it would contact that host) and the file
 * must have the `.pdf` extension.
 */
export async function addToInbox(s: MainServices, paths: readonly string[], trusted = false): Promise<{ added: InboxItem[]; refused: Refused[] }> {
  const c = await openCtx(s);
  const rootReal = await realpath(c.root).catch(() => c.root);
  const refused: Refused[] = [];
  const added: Dropped[] = [];
  const snap0 = await snapshot(c);
  const flagged = snap0.records.filter((r) => r.inbox && !r.missing).length;
  for (const p of paths) {
    const name = path.basename(p).slice(0, 260) || 'file';
    const refuse = (reason: Refused['reason']) => void refused.push({ name, reason });
    if (!path.isAbsolute(p) || (!trusted && isNetworkPath(p))) {
      refuse('not-found');
      continue;
    }
    if (!trusted && !p.toLowerCase().endsWith('.pdf')) {
      refuse('not-pdf');
      continue;
    }
    let real: string;
    let st;
    try {
      real = await realpath(p);
      st = await stat(real);
    } catch {
      refuse('not-found');
      continue;
    }
    if (!st.isFile()) {
      refuse('not-found');
      continue;
    }
    if (isInside(rootReal.toLowerCase(), real.toLowerCase())) {
      refuse('in-library');
      continue;
    }
    if (st.size > INBOX_LIMITS.fileBytes) {
      refuse('too-large');
      continue;
    }
    if ((await readHeader(real).catch(() => '')) !== '%PDF-') {
      refuse('not-pdf');
      continue;
    }
    const hash = await sha256File(real).catch(() => null);
    if (!hash) {
      refuse('not-found');
      continue;
    }
    const id = documentIdFromHash(hash);
    // Text and identifiers: read by the scan worker (never pdf.js on the main thread); the text lands in the cache by hash.
    const res = await c.rt.extractFile(path.dirname(real), path.basename(real), hash).catch(() => null);
    // The worker reads the file itself: when what it read is not what was hashed, the file changed in between; refuse it.
    if (res?.ok && res.readHash !== undefined && res.readHash !== hash) {
      refuse('not-found');
      continue;
    }
    const m = res?.ok ? res.meta : undefined;
    const detected: Detected = compact({
      title: m?.title ?? null,
      authors: m?.authors ?? [],
      year: m?.year ?? null,
      doi: m?.doi ?? null,
      arxivId: m?.arxivId ? `${m.arxivId}${m.arxivVersion ? `v${m.arxivVersion}` : ''}` : null,
    });
    const item: Dropped = {
      id,
      srcPath: real,
      fileName: path.basename(real).slice(0, 260),
      size: st.size,
      addedAt: new Date().toISOString(),
      hash,
      detected,
      entry: defaultEntry(Boolean(detected.doi || detected.arxivId)),
    };
    let outcome: Refused['reason'] | 'ok' = 'ok';
    await c.store.update((draft) => {
      if (draft.items.some((i) => i.id === id)) outcome = 'already-queued';
      else if (draft.items.length + flagged + added.length >= INBOX_LIMITS.items) outcome = 'limit';
      else draft.items.push(item);
    });
    if (outcome !== 'ok') {
      refuse(outcome);
      continue;
    }
    added.push(item);
  }
  const snap = await snapshot(c);
  for (const d of added) schedule(c, `drop:${d.id}`, () => enrich(c, { kind: 'dropped', id: d.id }, false));
  if (added.length > 0) void emitChanged(s);
  return { added: added.map((d) => droppedView(snap, d)), refused };
}

export async function chooseForInbox(s: MainServices) {
  const picked = (await s.pickPdfFiles?.()) ?? [];
  if (picked.length === 0) return { added: [], refused: [] };
  return addToInbox(s, picked.slice(0, INBOX_LIMITS.addBatch), true);
}

/* ------------------------------------------------ lookup, dismiss ------------------------------------------------ */

async function findItem(c: Ctx, id: string): Promise<{ dropped?: Dropped; rec?: DocumentRecord }> {
  const file = await c.store.read();
  const dropped = file.items.find((i) => i.id === id);
  if (dropped) return { dropped };
  const rec = await c.rt.store.documents.get(id as DocumentId).catch(() => null);
  if (rec?.inbox && !rec.missing) return { rec };
  throw new AppError('NOT_FOUND', 'Unknown inbox item');
}

async function viewOf(c: Ctx, id: string): Promise<InboxItem> {
  const f = await findItem(c, id);
  const snap = await snapshot(c);
  if (f.dropped) return droppedView(snap, (await c.store.read()).items.find((i) => i.id === id) ?? f.dropped);
  return libraryView(snap, f.rec!, (await c.store.read()).cache[id] ?? defaultEntry(Boolean(f.rec!.doi || f.rec!.arxivId)));
}

export async function lookupItem(s: MainServices, id: string): Promise<InboxItem> {
  const c = await openCtx(s);
  const f = await findItem(c, id);
  await enrich(c, f.dropped ? { kind: 'dropped', id } : { kind: 'library', id }, true);
  void emitChanged(s);
  return viewOf(c, id);
}

export async function dismissItem(s: MainServices, id: string): Promise<{ ok: true }> {
  tagRuns.get(id)?.abort();
  const c = await openCtx(s);
  const f = await findItem(c, id);
  if (f.dropped) await c.store.update((d) => void (d.items = d.items.filter((i) => i.id !== id)));
  else {
    await c.rt.store.documents.update(id as DocumentId, (cur) => {
      if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
      const { inbox: _gone, ...rest } = cur;
      return { ...rest, updatedAt: new Date().toISOString() } as DocumentRecord;
    });
    c.rt.organizer.invalidate();
    await c.rt.reindexDocuments([id as DocumentId]).catch(() => undefined);
    s.emit('library:changed', { kind: 'documents', ids: [id] });
    await c.store.update((d) => void delete d.cache[id]);
  }
  void emitChanged(s);
  return { ok: true as const };
}

/* ------------------------------------------------------- tags with the AI ------------------------------------------------------- */

const stripMarkers = (t: string) => t.replace(/<<<DATA|DATA>>>|<<<TAXONOMY|TAXONOMY>>>/g, '[marker removed]');
const clipText = (t: string, n: number) => (t.length > n ? t.slice(0, n) : t);

/** What would be sent for an item: the online record (title, authors, abstract) when found, else the first pages. Delimited DATA. */
async function dataBlock(c: Ctx, f: { dropped?: Dropped; rec?: DocumentRecord }, entry: Entry): Promise<string> {
  const detected = f.dropped ? f.dropped.detected : detectedOfRecord(f.rec!);
  const meta = metaOf(entry, detected);
  const head = [meta.title ? `title: ${meta.title}` : '', meta.authors?.length ? `authors: ${meta.authors.slice(0, 8).join('; ')}` : '', meta.year ? `year: ${meta.year}` : '', meta.venue ? `venue: ${meta.venue}` : ''].filter(Boolean).join('\n');
  let body = '';
  if (entry.metadata?.abstract) body = `abstract: ${clipText(entry.metadata.abstract, JOB_EXCERPT_CHARS)}`;
  else {
    try {
      const ex = createTextExtractor({ cacheDir: c.rt.textCacheDir });
      const text = f.dropped ? await ex.extract(path.dirname(f.dropped.srcPath), path.basename(f.dropped.srcPath), { hash: f.dropped.hash }) : await ex.extract(c.root, f.rec!.path, { hash: f.rec!.hash });
      let budget = JOB_EXCERPT_CHARS;
      const parts: string[] = [];
      for (const p of text.pages.slice(0, 3)) {
        if (budget <= 0) break;
        const t = p.text.slice(0, budget);
        budget -= t.length;
        parts.push(`[page ${p.page}]\n${t}`);
      }
      body = parts.join('\n');
    } catch (e) {
      c.s.log.warn('page text unavailable for the inbox', { error: e });
    }
  }
  return `<<<DATA document\n${stripMarkers(`${head}\n${body}`.trim())}\nDATA>>>`;
}

async function tagsPrep(c: Ctx, id: string, folderReq: string | undefined) {
  const f = await findItem(c, id);
  const file = await c.store.read();
  const entry = f.dropped ? f.dropped.entry : (file.cache[id] ?? defaultEntry(false));
  let folder: string;
  let fileName: string;
  if (f.dropped) {
    const snap = await snapshot(c);
    fileName = proposedFileName(metaOf(entry, f.dropped.detected), f.dropped.fileName);
    folder = folderReq ?? proposeFolder(snap, entry.ai ? entry.ai.tagIds : entry.similar, entry.nearFolder);
  } else {
    folder = folderOf(f.rec!.path);
    fileName = path.posix.basename(f.rec!.path);
  }
  const rel = folder ? `${folder}/${fileName}` : fileName;
  // The folder gate, before anything is read for the model.
  if (!inEnabledFolder(rel, c.cfg.aiEnabledFolders)) throw new AppError('FOLDER_NOT_AI_ENABLED', 'The target folder is not enabled for AI', { folder });
  const tax = await c.rt.store.readTaxonomy();
  const nodes = activeTagNodes(tax);
  const block = await dataBlock(c, f, entry);
  const system = suggestSystem(['tags'], c.cfg.language);
  const prompt = suggestPrompt(['tags'], block, nodes);
  return { f, entry, folder, tax, system, prompt };
}

async function previewOf(c: Ctx, id: string, model: string, p: { folder: string; system: string; prompt: string }) {
  if (!c.cfg.ai.models.some((m) => m.id === model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  const est = estimateCostFromModels(c.cfg.ai.models, { model, promptChars: p.system.length + p.prompt.length, expectedOutputTokens: 300 });
  const monthUsd = (await monthUsage(c.rt, monthOf(new Date()))).usd;
  const cap = c.cfg.ai.usageCap.monthlyUsd;
  return {
    monthUsd,
    est,
    preview: {
      model,
      allowed: [id as DocumentId],
      refused: [] as Array<{ docId: string; reason: 'folder-not-enabled' | 'missing' | 'unknown' }>,
      folders: [p.folder],
      approxInputTokens: est.inputTokens,
      estimatedUsd: est.usd,
      needsConfirmation: c.cfg.ai.confirmBeforeSend,
      overCap: cap !== null && monthUsd + (est.usd ?? 0) > cap,
    },
  };
}

export async function previewTags(s: MainServices, req: { id: string; model: string; folder?: string | undefined }) {
  const c = await openCtx(s);
  const p = await tagsPrep(c, req.id, req.folder);
  return (await previewOf(c, req.id, req.model, p)).preview;
}

/** Tag proposals in flight, by item: removing the item (confirm, dismiss) cancels its call. */
const tagRuns = new Map<string, AbortController>();

export async function proposeTags(s: MainServices, aiCtx: AiCtx, req: { id: string; model: string; reasoning: 'low' | 'medium' | 'high'; folder?: string | undefined; confirmed: boolean }): Promise<InboxItem> {
  const c = await openCtx(s);
  const { cfg } = c;
  const { provider } = aiCtx;
  if (!cfg.ai.models.some((m) => m.id === req.model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  const monthUsd = (await monthUsage(c.rt, monthOf(new Date()))).usd;
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && monthUsd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached', { monthUsd, capUsd: cap });
  const av = await availability(s, provider);
  if (!av.available || !provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });
  const prep = await tagsPrep(c, req.id, req.folder);
  const { preview, est } = await previewOf(c, req.id, req.model, prep);
  if (cap !== null && preview.overCap) throw new AppError('AI_BUDGET_EXCEEDED', 'This send would go over the monthly AI spending cap', { monthUsd, capUsd: cap, estimatedUsd: preview.estimatedUsd });
  if (preview.needsConfirmation && !req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation', preview });
  const deviceId = (await s.settings.get()).deviceId;
  const sendLog = (inTok: number, outTok: number | undefined, usd: number | null) =>
    c.rt.store.appendLog({
      type: 'ai-send',
      at: new Date().toISOString(),
      deviceId,
      provider: provider.id,
      model: req.model,
      purpose: 'inbox:tags',
      docIds: [req.id as DocumentId],
      folders: [prep.folder],
      approxInputTokens: inTok,
      ...(outTok !== undefined ? { approxOutputTokens: outTok } : {}),
      ...(usd !== null ? { estimatedCostUsd: usd } : {}),
      confirmed: req.confirmed,
    });
  // Cancellable: the library switch, quit, and the removal of the item end the call (and the Claude process with it).
  const run = trackAbort();
  tagRuns.get(req.id)?.abort();
  tagRuns.set(req.id, run.controller);
  let result;
  try {
    result = await provider.completeStructured({ model: req.model, reasoning: req.reasoning, system: prep.system, prompt: prep.prompt, schema: suggestSchema(['tags']), source: 'inbox:tags', signal: run.controller.signal });
  } catch (e) {
    const d = AppError.from(e).details;
    if (d?.['sent'] !== false) await sendLog(est.inputTokens, undefined, null).catch(() => undefined);
    throw e;
  } finally {
    run.release();
    if (tagRuns.get(req.id) === run.controller) tagRuns.delete(req.id);
  }
  await sendLog(result.usage.inputTokens, result.usage.outputTokens, usdOfUsage(cfg.ai.models, req.model, result.usage));
  if (run.controller.signal.aborted) throw new AppError('CANCELLED', 'Cancelled');
  const clean = cleanSuggestion(result.value as SuggestRaw, ['tags'], prep.tax);
  const meta: AiMeta = { ...result.meta, source: 'inbox:tags' };
  const ai = { tagIds: clean.tags ?? [], newTags: clean.newTags ?? [], meta };
  await c.store.update((draft) => {
    if (prep.f.dropped) {
      const d = draft.items.find((i) => i.id === req.id);
      if (d) d.entry = { ...d.entry, ai };
    } else draft.cache[req.id] = { ...(draft.cache[req.id] ?? defaultEntry(false)), ai };
  });
  void emitChanged(s);
  return viewOf(c, req.id);
}

/* ------------------------------------------------------ confirm ------------------------------------------------------ */

type ConfirmReq = {
  id: string;
  name?: string | undefined;
  folder?: string | undefined;
  tagIds: string[];
  newTags: AiNewTag[];
  metadata: Partial<Omit<InboxMetadata, 'abstract' | 'publication'>>;
  allowDuplicate: boolean;
};

const EXTRACTABLE = ['title', 'authors', 'year', 'doi', 'arxivId'] as const;

export async function confirmItem(s: MainServices, req: ConfirmReq): Promise<{ docId: DocumentId; path: string; changeId: string | null }> {
  tagRuns.get(req.id)?.abort();
  const c = await openCtx(s);
  const f = await findItem(c, req.id);
  const file = await c.store.read();
  const entry = f.dropped ? f.dropped.entry : (file.cache[req.id] ?? defaultEntry(false));
  const snap = await snapshot(c);
  const detected = f.dropped ? f.dropped.detected : detectedOfRecord(f.rec!);
  const meta = metaOf(entry, detected);

  // 1. Duplicates: the same file never; the same work or another version only when the user says so.
  const dup = duplicateOf(snap, { selfId: f.rec?.id ?? null, id: req.id, hash: f.dropped?.hash ?? null, metas: [detected, meta] });
  if (dup && (dup.kind === 'same-file' || !req.allowDuplicate)) throw new AppError('CONFLICT', 'This file is already in the library', { conflict: 'duplicate', kind: dup.kind, docId: dup.docId });

  // 2. Tags and new nodes, checked before any file is touched.
  const resolve = tagResolver(snap.tax);
  const tagIds: string[] = [];
  for (const t of req.tagIds) {
    if (!snap.tax.nodes.some((n) => n.id === t)) throw new AppError('NOT_FOUND', 'Unknown tag', { tag: t });
    const r = resolve(t);
    if (!r) throw new AppError('INVALID_REQUEST', 'A deprecated tag cannot be added', { tag: t });
    if (!tagIds.includes(r)) tagIds.push(r);
  }
  for (const n of req.newTags) {
    if (n.parentId !== null && !snap.tax.nodes.some((x) => x.id === n.parentId && x.status !== 'deprecated')) throw new AppError('INVALID_REQUEST', 'The parent of a new tag does not exist', { parentId: n.parentId });
  }

  let docId = req.id as DocumentId;
  let relPath: string;
  /** What this call created (the copy, the record, new nodes): undone, newest first, when the confirmation fails before it is committed. */
  const undo: Array<() => Promise<unknown>> = [];
  const rollback = async () => {
    for (const u of undo.reverse()) await u().catch((e: unknown) => s.log.warn('could not undo a failed inbox confirmation', { error: e }));
  };
  const now = new Date().toISOString();
  const store = c.rt.store as OrganizerStore;

  if (f.dropped) {
    // 3. The copy: the ONE write outside the data folder (D-217). New file, never overwriting, original untouched.
    // The folder is normalised FIRST (`.`, `./x`, `a//b`, trailing slashes, reserved names), and every check below, the
    // stored path and the copy use that one form: a variant of an excluded folder cannot slip past a string compare.
    let folder: string;
    try {
      folder = normalizeRelativePath(req.folder ?? proposeFolder(snap, tagIds, entry.nearFolder));
    } catch {
      throw new AppError('INVALID_REQUEST', 'The folder is not valid', { reason: 'name' });
    }
    const name = req.name ?? proposedFileName(meta, f.dropped.fileName);
    if (!isValidCopyName(name)) throw new AppError('INVALID_REQUEST', 'The file name is not valid', { reason: 'name' });
    relPath = folder ? `${folder}/${name}` : name;
    if (!relativePathSchema.safeParse(relPath).success) throw new AppError('INVALID_REQUEST', 'The path is not valid', { reason: 'name' });
    if (isExcluded(folder, c.cfg.excludedFolders)) throw new AppError('INVALID_REQUEST', 'The folder is excluded from the library', { reason: 'excluded' });
    const folderAbs = await resolveInRoot(c.root, folder);
    const fst = await stat(folderAbs).catch(() => null);
    if (!fst?.isDirectory()) throw new AppError('NOT_FOUND', 'The target folder does not exist', { folder });
    // The data folder as it really is on disk (a junction or a substituted drive in the root path must not hide it).
    const dataReal = await realpath(c.dataDir).catch(() => c.dataDir);
    if (isInside(dataReal, folderAbs) || isInside(c.dataDir, folderAbs)) throw new AppError('INVALID_REQUEST', 'The data folder cannot receive files', { reason: 'data-folder' });
    const dst = await resolveInRoot(c.root, relPath);
    try {
      await copyFile(f.dropped.srcPath, dst, fsConstants.COPYFILE_EXCL);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new AppError('CONFLICT', 'A file with this name already exists in the folder', { conflict: 'exists', reason: 'exists' });
      if (code === 'ENOENT') throw new AppError('NOT_FOUND', 'The original file is no longer there');
      throw new AppError('IO_ERROR', 'The file could not be copied', { code: code ?? 'unknown' });
    }
    undo.push(() => unlink(dst));
    // The copy is ours: verify it; on a mismatch delete only the file just created.
    const got = await sha256File(dst).catch(() => null);
    if (got !== f.dropped.hash) {
      await unlink(dst).catch(() => undefined);
      throw new AppError('IO_ERROR', 'The copy does not match the original (it may have changed); nothing was added', { reason: 'hash-mismatch' });
    }
    const cst = await stat(dst);
    // 4. Index that one file directly, so the watcher and the next scan see it as known (never as new).
    const rec = documentRecordSchema.parse({ schemaVersion: SCHEMA_VERSION, id: docId, hash: f.dropped.hash, path: relPath, size: cst.size, mtimeMs: cst.mtimeMs, addedAt: now, updatedAt: now });
    try {
      let made = false;
      await c.rt.store.documents.update(docId, (cur) => {
        if (!cur) made = true;
        return cur ?? rec;
      });
      if (made) undo.push(() => c.rt.store.documents.remove(docId));
    } catch (e) {
      await rollback();
      throw e;
    }
  } else {
    relPath = f.rec!.path;
    docId = f.rec!.id as DocumentId;
  }

  // 5. Metadata, tags, AI review and the inbox flag: ONE logged change.
  const changeId = `chg-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const cs = store.withChange({ changeId, summary: `Added to the library from the inbox: ${path.posix.basename(relPath)}`.slice(0, 480) });
  const idByLabel = new Map<string, string>();
  for (const n of snap.tax.nodes) for (const t of [n.label, ...n.aliases]) idByLabel.set(norm(t), n.id);
  const create = [...new Map(req.newTags.filter((t) => !idByLabel.has(norm(t.label))).map((t) => [norm(t.label), t])).entries()];
  const createdIds: string[] = [];
  /** A failure up to the document write undoes what this call made; after that write the confirmation stands. */
  const guard = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      await rollback();
      throw e;
    }
  };
  if (create.length > 0) {
    await guard(() => cs.updateTaxonomy((cur) => {
      const ops = create.map(([, t]) => ({ op: 'create' as const, label: t.label, ...(t.parentId ? { parents: [t.parentId] } : {}), ...(t.aliases.length ? { aliases: t.aliases } : {}) }));
      const r = applyTaxonomyOps(cur, ops, new Map(), now);
      for (const x of r.created) {
        const node = r.taxonomy.nodes.find((n) => n.id === x.id);
        if (node) node.origin = 'ai';
        idByLabel.set(create[x.index]![0], x.id);
        createdIds.push(x.id);
      }
      return r.taxonomy;
    }));
    if (createdIds.length > 0) undo.push(() => cs.updateTaxonomy((cur) => ({ ...cur, nodes: cur.nodes.filter((n) => !createdIds.includes(n.id)) })));
  }
  const newTagNodeIds = req.newTags.map((t) => idByLabel.get(norm(t.label))).filter((x): x is string => x !== undefined);
  const reviewed: Array<{ key: 'suggestedTags' | 'suggestedNewTags'; before: unknown; after: unknown }> = [];
  await guard(() => cs.documents.update(docId, (cur) => {
    if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
    const next: DocumentRecord = { ...cur, ref: { ...cur.ref }, tags: [...cur.tags], ai: { ...cur.ai } };
    const md = req.metadata;
    if (md.title !== undefined) next.title = md.title?.trim() || null;
    if (md.authors !== undefined) next.authors = md.authors.map((a) => a.trim()).filter(Boolean);
    if (md.year !== undefined) next.year = md.year;
    if (md.doi !== undefined) next.doi = md.doi ? doiKey(md.doi) : null;
    if (md.arxivId !== undefined) next.arxivId = md.arxivId?.trim() || null;
    if (md.venue !== undefined) {
      if (md.venue?.trim()) next.ref.venue = md.venue.trim();
      else delete next.ref.venue;
    }
    // A value the user confirms beats the one read from the file: the guess is dropped from `extracted` when equal.
    if (cur.extracted) {
      const ex = { ...cur.extracted };
      for (const k of EXTRACTABLE) if (md[k] !== undefined && ex[k] !== undefined && JSON.stringify(ex[k]) === JSON.stringify(next[k])) delete ex[k];
      if (Object.keys(ex).length === 0) delete next.extracted;
      else next.extracted = ex;
    }
    for (const t of [...tagIds, ...newTagNodeIds]) if (!next.tags.includes(t)) next.tags.push(t);
    if (entry.ai) {
      const review = { status: 'accepted' as const, at: now };
      if (entry.ai.tagIds.length > 0) {
        const kept = tagIds.filter((t) => entry.ai!.tagIds.includes(t));
        const whole = kept.length === entry.ai.tagIds.length;
        const field = { value: kept, meta: entry.ai.meta, review: whole ? review : { status: 'edited' as const, at: now, originalValue: entry.ai.tagIds } };
        reviewed.push({ key: 'suggestedTags', before: cur.ai.suggestedTags ?? null, after: field });
        next.ai.suggestedTags = field;
      }
      if (entry.ai.newTags.length > 0) {
        const same = JSON.stringify(req.newTags.map((t) => [t.label, t.parentId, t.aliases])) === JSON.stringify(entry.ai.newTags.map((t) => [t.label, t.parentId, t.aliases]));
        const field = { value: req.newTags, meta: entry.ai.meta, review: same ? review : { status: 'edited' as const, at: now, originalValue: entry.ai.newTags } };
        reviewed.push({ key: 'suggestedNewTags', before: cur.ai.suggestedNewTags ?? null, after: field });
        next.ai.suggestedNewTags = field;
      }
    }
    delete next.inbox;
    next.updatedAt = now;
    return next;
  }));
  const deviceId = (await s.settings.get()).deviceId;
  for (const r of reviewed) {
    await cs
      .appendLog({ type: 'change', at: now, deviceId, actor: 'user', target: { kind: 'document', id: docId }, action: 'ai.review', before: { ai: { [r.key]: r.before } }, after: { ai: { [r.key]: r.after } } })
      .catch((e: unknown) => s.log.warn('could not log the review of an inbox item', { error: e }));
  }
  c.rt.organizer.invalidate();
  await c.rt.reindexDocuments([docId]).catch((e: unknown) => s.log.warn('index refresh after the inbox failed', { error: e }));
  if (f.dropped) {
    await c.store.update((d) => void (d.items = d.items.filter((i) => i.id !== req.id))).catch((e: unknown) => s.log.warn('could not leave the inbox queue', { error: e }));
    // The text of the new file is read and indexed by the next (targeted) scan; the file is known already, so it does not land in the inbox.
    c.rt.startScan?.({ paths: [relPath] });
  } else await c.store.update((d) => void delete d.cache[req.id]).catch((e: unknown) => s.log.warn('could not clear an inbox cache entry', { error: e }));
  if (createdIds.length > 0) s.emit('library:changed', { kind: 'taxonomy' });
  s.emit('library:changed', { kind: 'documents', ids: [docId] });
  void emitChanged(s);
  return { docId, path: relPath, changeId };
}
