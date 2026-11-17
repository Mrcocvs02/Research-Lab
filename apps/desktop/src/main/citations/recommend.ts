import { AppError, WATCH_FILE_LIMITS, type CitationLink, type DocumentId } from '@rl/core';
import { bestKey, findOwned, linkKeys } from '@rl/citations';
import type { MainServices } from '../ipc/handlers/services.js';
import type { DomainHandlers } from '../ipc/types.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { citationsVersion, documentsKey, ownedIndex, updateWatch, type Res } from './context.js';

const CITING_SHOWN = 20;
/** Authors kept per work in the aggregate (the list shows three and "et al."). */
const AUTHORS_KEPT = 4;
const AGGREGATE_TTL_MS = 10 * 60_000;

interface Entry {
  link: CitationLink;
  keys: Set<string>;
  /** Library documents that cite the work (every one, in file order). */
  citing: string[];
}

/** Everything `readNext` needs of the stored files, computed once and reused until a citation file or a document changes. */
interface Aggregate {
  /** `${citation writes}|${documents key}|${number of files}`. */
  key: string;
  at: number;
  entries: Entry[];
  /** Documents with at least one stored reference. */
  withRefs: Set<string>;
}
const aggregates = new WeakMap<LibraryRuntime, Aggregate>();

/** Richer links first: the one that has a title is what is shown. */
const better = (a: CitationLink, b: CitationLink) => !a.title && Boolean(b.title);

/** A link without what the aggregate does not need (matching, dates, long author lists, the cited-by half of the file is never read here). */
const compactLink = (l: CitationLink): CitationLink => {
  const { matchedDocId: _m, ...rest } = l;
  return { ...rest, authors: l.authors.slice(0, AUTHORS_KEPT), matchedDocId: null };
};

async function aggregate(rt: LibraryRuntime): Promise<Aggregate> {
  const store = rt.store;
  const existing = new Set(await store.documents.listIds());
  const ids = await store.citations.listIds();
  const key = `${citationsVersion(rt)}|${documentsKey(rt)}|${ids.length}`;
  const hit = aggregates.get(rt);
  if (hit && hit.key === key && Date.now() - hit.at < AGGREGATE_TTL_MS) return hit;
  const ix = await ownedIndex(rt);
  const byKey = new Map<string, Entry>();
  const entries: Entry[] = [];
  const withRefs = new Set<string>();
  for (const file of await store.citations.list()) {
    if (!existing.has(file.docId) || file.references.length === 0) continue;
    withRefs.add(file.docId);
    for (const link of file.references) {
      const keys = linkKeys(link);
      if (keys.length === 0 || findOwned(ix, link, file.docId)) continue;
      // The same work under two keys (a DOI by one source, only the arXiv id by another) is one entry.
      const found = [...new Set(keys.map((k) => byKey.get(k)).filter((x): x is Entry => x !== undefined))];
      let e = found[0];
      for (const o of found.slice(1)) {
        // Two entries that turn out to be one work: the first absorbs the second.
        for (const k of o.keys) {
          e!.keys.add(k);
          byKey.set(k, e!);
        }
        for (const id of o.citing) if (!e!.citing.includes(id)) e!.citing.push(id);
        if (better(e!.link, o.link)) e!.link = o.link;
        o.citing = [];
      }
      if (!e) {
        e = { link: compactLink(link), keys: new Set(), citing: [] };
        entries.push(e);
      } else if (better(e.link, link)) e.link = compactLink(link);
      for (const k of keys) {
        e.keys.add(k);
        byKey.set(k, e);
      }
      if (e.citing[e.citing.length - 1] !== file.docId && !e.citing.includes(file.docId)) e.citing.push(file.docId);
    }
  }
  const made: Aggregate = { key, at: Date.now(), entries: entries.filter((e) => e.citing.length > 0), withRefs };
  aggregates.set(rt, made);
  return made;
}

/** "Read next": works cited by at least `minCiting` library documents (of the scope) and not in the library; offline, from the stored citation files. */
export async function readNext(s: MainServices, req: { limit: number; minCiting: number; projectId?: string | undefined; folder?: string | undefined }): Res<DomainHandlers<'recommend'>['recommend:readNext']> {
  const rt = await s.runtime.require();
  const store = rt.store;
  let scope: Set<string> | null = null;
  if (req.projectId) {
    const p = await store.projects.get(req.projectId);
    if (!p) throw new AppError('NOT_FOUND', 'Unknown project');
    scope = new Set(p.members.map((m) => m.docId));
  } else if (req.folder) {
    const folder = req.folder.replace(/\/+$/, '');
    scope = new Set((await store.documents.list()).filter((d) => d.path === folder || d.path.startsWith(`${folder}/`)).map((d) => d.id));
  }
  const agg = await aggregate(rt);
  const dismissed = new Set((await store.readWatch()).dismissedRecommendations);
  const documentsWithCitations = scope === null ? agg.withRefs.size : [...agg.withRefs].filter((id) => scope.has(id)).length;
  const ranked: Array<{ key: string; e: Entry; inScope: string[] }> = [];
  for (const e of agg.entries) {
    // A bare OpenAlex id (no title: the source could not give the work) is a count, not something to read.
    if (!e.link.title || [...e.keys].some((k) => dismissed.has(k))) continue;
    const inScope = scope === null ? e.citing : e.citing.filter((id) => scope.has(id));
    if (inScope.length >= req.minCiting) ranked.push({ key: bestKey(e.keys), e, inScope });
  }
  ranked.sort((a, b) => b.inScope.length - a.inScope.length || b.e.citing.length - a.e.citing.length || (b.e.link.year ?? 0) - (a.e.link.year ?? 0) || (a.key < b.key ? -1 : 1));
  const top = ranked.slice(0, req.limit);
  const titles = new Map<string, string | null>();
  const need = [...new Set(top.flatMap((r) => [...r.inScope, ...r.e.citing].slice(0, CITING_SHOWN)))];
  for (let i = 0; i < need.length; i += 32) {
    await Promise.all(need.slice(i, i + 32).map(async (id) => void titles.set(id, (await store.documents.get(id as DocumentId).catch(() => null))?.title ?? null)));
  }
  return {
    documentsWithCitations,
    items: top.map(({ key, e, inScope }) => {
      const { matchedDocId: _m, checkedAt: _c, ...work } = e.link;
      const shown = [...new Set([...inScope, ...e.citing])].slice(0, CITING_SHOWN);
      return { key, work, citing: shown.map((id) => ({ docId: id as DocumentId, title: titles.get(id) ?? null })), citingCount: e.citing.length, score: inScope.length };
    }),
  };
}

/** Hides a recommendation under every key the work has (so its twin keyed differently by another source stays hidden too). */
export async function dismissRecommendation(s: MainServices, key: string): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  const entry = (await aggregate(rt).catch(() => null))?.entries.find((e) => e.keys.has(key));
  const keys = new Set([key, ...(entry ? entry.keys : [])]);
  await updateWatch(rt, (w) => {
    const have = new Set(w.dismissedRecommendations);
    w.dismissedRecommendations = [...w.dismissedRecommendations, ...[...keys].filter((k) => !have.has(k))].slice(-WATCH_FILE_LIMITS.dismissedRecommendations);
  });
  return { ok: true };
}
