import { randomUUID } from 'node:crypto';
import { AppError, contentHashOf, type DocumentRecord } from '@rl/core';
import { readCachedText } from '@rl/data';
import { GRAPH_K, analyze, citationKey, modelVector, neighborsOf, resolveAuthor, type AuthorAliases, type SparseVec } from '@rl/graph';
import { readAuthorAliases } from '../../graph/author-aliases.js';
import { GRAPH_PAGES, GRAPH_TEXT_CHARS, toGraphDoc } from '../../graph/inputs.js';
import { loadModel, type LoadedModel } from '../../graph/service.js';
import { loadView, scopeIds, titleOf, type LibraryView } from '../../graph/view.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { KEY_CAP, normalThreshold, passes, scorePair, thresholdFor, type DocFeatures, type Scored, type Strictness } from './score.js';
import { linkReasonsSchema, type DocLink, type LinkReasons } from './schema.js';
import { mutateLinks, ordered, pairKey, readLinks } from './store.js';

/**
 * "Find links" (§18.2, D-479, D-480): the links between a source document and its targets, scored with the signals of the
 * Map. Loaded on first use (the lazy `doclinks` chunk); nothing here calls Claude or the network.
 */

/** Without a model the text signal is computed for the source and its targets only: this many documents at most. */
const NO_MODEL_MAX = 500;
/** Most links one search adds (the strongest); the rest are listed as below the threshold. */
const MAX_ADDED = 200;
const MAX_BELOW = 20;
/** Documents of the library whose neighbours give the normal threshold. */
const SAMPLE_DOCS = 3000;
/** More authors than this is a consortium: it says nothing about two papers. */
const CONSORTIUM = 30;
const ROOT_SHARE = 0.3;
const MAX_LINKS = 50_000;

type Targets = { docIds: string[] } | { projectId: string } | { folder: string } | { tagId: string } | { all: true };

export interface FoundLink {
  id?: string;
  docId: string;
  title: string;
  year: number | null;
  weight: number;
  reasons: LinkReasons;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

async function resolveTargets(s: MainServices, view: LibraryView, sourceId: string, targets: Targets): Promise<DocumentRecord[]> {
  let wanted: Set<string> | null;
  if ('docIds' in targets) wanted = new Set(targets.docIds);
  else if ('all' in targets) wanted = null;
  else wanted = await scopeIds(await s.runtime.require(), view, targets);
  return view.records.filter((r) => r.id !== sourceId && (!wanted || wanted.has(r.id)));
}

/** Weight of each tag: the accepted score (D-447), else 1 for a tag set by hand. */
function tagWeights(rec: DocumentRecord): Map<string, number> {
  const scores = new Map((rec.ai.suggestedTagScores?.value ?? []).map((t) => [t.id, t.weight]));
  return new Map(rec.tags.map((id) => [id, scores.get(id) ?? 1]));
}

function authorsOf(rec: DocumentRecord, aliases: AuthorAliases): Map<string, string> {
  const out = new Map<string, string>();
  if (rec.authors.length > CONSORTIUM) return out;
  for (const name of rec.authors) {
    const k = resolveAuthor(name, aliases);
    if (k !== '' && !out.has(k)) out.set(k, name);
  }
  return out;
}

/** The threshold of the Map: median score of the first `GRAPH_K` neighbours of documents of the model. */
function mapThreshold(lm: LoadedModel | null): number {
  if (!lm) return normalThreshold([]);
  const m = lm.model;
  const step = Math.max(1, Math.floor(m.ids.length / SAMPLE_DOCS));
  const scores: number[] = [];
  for (let i = 0; i < m.ids.length; i += step) for (const n of neighborsOf(m, i).slice(0, GRAPH_K)) scores.push(n.score);
  return normalThreshold(scores);
}

export async function findLinks(s: MainServices, req: { sourceId: string; targets: Targets; strictness: Strictness }) {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const src = view.byId.get(req.sourceId);
  if (!src) throw new AppError('NOT_FOUND', 'Unknown document');
  const file = await readLinks(rt.store.dataDir);
  const have = new Set(file.links.map((l) => pairKey(l.a, l.b)));
  const dismissed = new Set(file.dismissed.map((d) => pairKey(d.a, d.b)));
  let existing = 0;
  let dismissedN = 0;
  const targets: DocumentRecord[] = [];
  for (const r of await resolveTargets(s, view, src.id, req.targets)) {
    const k = pairKey(src.id, r.id);
    if (have.has(k)) existing++;
    else if (dismissed.has(k)) dismissedN++;
    else targets.push(r);
  }
  const lm = await loadModel(s, rt);
  const inModel = lm?.index.has(src.id) === true;
  if (!inModel && targets.length + 1 > NO_MODEL_MAX) throw new AppError('INVALID_REQUEST', 'The graph is needed to search so many documents', { reason: 'needs-graph', limit: NO_MODEL_MAX });

  // Text vectors: the model's, else computed for the source and its targets.
  const vecs = new Map<string, SparseVec>();
  let terms: readonly string[] = [];
  if (lm && inModel) {
    terms = lm.model.vocab;
    for (const r of [src, ...targets]) {
      const at = lm.index.get(r.id);
      if (at !== undefined) vecs.set(r.id, modelVector(lm.model, at));
    }
  } else if (targets.length > 0) {
    const recs = [src, ...targets];
    const docs = [];
    for (const r of recs) {
      const cached = await readCachedText(rt.textCacheDir, contentHashOf(r), GRAPH_PAGES);
      docs.push(toGraphDoc(r, view.lookup, { abstract: cached?.meta.abstract, text: cached ? cached.pages.map((p) => p.text).join('\n').slice(0, GRAPH_TEXT_CHARS) : undefined }));
    }
    const a = await analyze(docs);
    terms = a.vocab.terms;
    recs.forEach((r, i) => vecs.set(r.id, a.vectors[i] as SparseVec));
  }

  // Citations: keys and direct links, and how many documents share each key.
  const refs = new Map<string, Set<string>>();
  const cites = new Map<string, Set<string>>();
  const citedBy = new Map<string, Set<string>>();
  const keyCount = new Map<string, number>();
  const need = new Set([src.id, ...targets.map((r) => r.id)]);
  const matched = (list: ReadonlyArray<{ matchedDocId?: string | null | undefined }>) => new Set(list.map((l) => l.matchedDocId).filter((x): x is string => !!x));
  for (const f of await rt.store.citations.list().catch(() => [])) {
    const keys = new Set<string>();
    for (const [list, prefix] of [[f.references, 'r:'], [f.citedBy, 'c:']] as const) {
      for (const l of list) {
        const key = citationKey(l);
        if (key) keys.add(prefix + key);
      }
    }
    for (const k of keys) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    const id = f.docId as string;
    if (!need.has(id)) continue;
    refs.set(id, keys);
    cites.set(id, matched(f.references));
    citedBy.set(id, matched(f.citedBy));
  }

  const roots = new Set((view.tax?.nodes ?? []).filter((n) => n.parents.length === 0).map((n) => n.id));
  const total = Math.max(1, view.records.length);
  const skipTag = (t: string) => roots.has(t) || view.tagCount(t) / total > ROOT_SHARE;
  const { aliases } = await readAuthorAliases(rt);
  const none = new Set<string>();
  const feat = (r: DocumentRecord): DocFeatures => ({
    id: r.id,
    vec: vecs.get(r.id) ?? null,
    refs: refs.get(r.id) ?? none,
    cites: cites.get(r.id) ?? none,
    citedBy: citedBy.get(r.id) ?? none,
    tags: tagWeights(r),
    authors: authorsOf(r, aliases),
  });
  const ctx = { terms, keyCap: (k: string) => (keyCount.get(k) ?? 0) > KEY_CAP, skipTag, tagLabel: (t: string) => view.lookup.tagLabel(t) ?? t };

  const threshold = thresholdFor(mapThreshold(lm), req.strictness);
  const sf = feat(src);
  const scored: Array<{ rec: DocumentRecord; sc: Scored }> = targets.map((r) => ({ rec: r, sc: scorePair(sf, feat(r), ctx) }));
  scored.sort((x, y) => y.sc.score - x.sc.score || (x.rec.id < y.rec.id ? -1 : 1));
  const good = scored.filter((x) => passes(x.sc, threshold)).slice(0, MAX_ADDED);
  const chosen = new Set(good.map((x) => x.rec.id));
  const below = scored.filter((x) => !chosen.has(x.rec.id) && x.sc.score > 0).slice(0, MAX_BELOW);

  const runId = randomUUID();
  const at = new Date().toISOString();
  const item = (x: { rec: DocumentRecord; sc: Scored }, id?: string): FoundLink => ({ ...(id ? { id } : {}), docId: x.rec.id, title: titleOf(x.rec), year: x.rec.year ?? null, weight: round2(x.sc.score), reasons: x.sc.reasons });
  const added: FoundLink[] = await mutateLinks(rt.store.dataDir, (f) => {
    const out: FoundLink[] = [];
    const known = new Set(f.links.map((l) => pairKey(l.a, l.b)));
    for (const x of good) {
      if (f.links.length >= MAX_LINKS) break;
      if (known.has(pairKey(src.id, x.rec.id))) continue;
      const id = randomUUID();
      f.links.push({ id, ...ordered(src.id, x.rec.id), weight: round2(x.sc.score), reasons: x.sc.reasons, origin: 'finder', runId, at } as DocLink);
      out.push(item(x, id));
    }
    return { changed: out.length > 0, value: out };
  });
  return { runId, threshold, added, below: below.map((x) => item(x)), scanned: targets.length, skipped: { dismissed: dismissedN, existing } };
}

/** The links of a document with the other document's title (documents no longer in the library are left out). */
export async function linksOfDoc(s: MainServices, docId: string, view?: LibraryView) {
  const rt = await s.runtime.require();
  const v = view ?? (await loadView(rt));
  const file = await readLinks(rt.store.dataDir);
  const items = [];
  for (const l of file.links) {
    if (l.a !== docId && l.b !== docId) continue;
    const other = v.byId.get(l.a === docId ? l.b : l.a);
    if (other) items.push({ id: l.id, docId: other.id, title: titleOf(other), weight: l.weight, reasons: l.reasons, origin: l.origin });
  }
  return items.sort((x, y) => y.weight - x.weight || (x.docId < y.docId ? -1 : 1));
}

export async function listLinks(s: MainServices, req: { docId: string }) {
  return { items: await linksOfDoc(s, req.docId) };
}

/** Removes links: remembered as dismissed so a new search does not bring them back (`forget`: the undo of a search, not remembered). */
export async function removeLinks(s: MainServices, req: { ids: string[]; forget?: boolean | undefined }) {
  const rt = await s.runtime.require();
  const ids = new Set(req.ids);
  const at = new Date().toISOString();
  const removed = await mutateLinks(rt.store.dataDir, (f) => {
    const gone = f.links.filter((l) => ids.has(l.id));
    if (gone.length === 0) return { changed: false, value: 0 };
    f.links = f.links.filter((l) => !ids.has(l.id));
    if (!req.forget) {
      const known = new Set(f.dismissed.map((d) => pairKey(d.a, d.b)));
      for (const l of gone) if (!known.has(pairKey(l.a, l.b)) && f.dismissed.length < MAX_LINKS) f.dismissed.push({ a: l.a, b: l.b, at });
    }
    return { changed: true, value: gone.length };
  });
  return { removed };
}

/** A link by hand: also when the pair was dismissed (it leaves the dismissed list). */
export async function addLink(s: MainServices, req: { a: string; b: string; weight: number; reasons: Record<string, unknown> }) {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  if (req.a === req.b || !view.byId.has(req.a) || !view.byId.has(req.b)) throw new AppError('NOT_FOUND', 'Unknown document');
  const reasons = linkReasonsSchema.parse(req.reasons);
  const pair = ordered(req.a, req.b);
  const key = pairKey(req.a, req.b);
  return mutateLinks(rt.store.dataDir, (f) => {
    const hit = f.links.find((l) => pairKey(l.a, l.b) === key);
    if (hit) return { changed: false, value: { id: hit.id, created: false } };
    if (f.links.length >= MAX_LINKS) throw new AppError('INVALID_REQUEST', 'Too many links');
    f.dismissed = f.dismissed.filter((d) => pairKey(d.a, d.b) !== key);
    const id = randomUUID();
    f.links.push({ id, ...pair, weight: round2(req.weight), reasons, origin: 'user', runId: 'user', at: new Date().toISOString() } as DocLink);
    return { changed: true, value: { id, created: true } };
  });
}
