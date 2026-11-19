import { arxivFromDoi, asObj, encodePath, findOwned, openAlexLink, pathDoi, type Net, type OwnedIndex } from '@rl/citations';
import { isClassic, specificity } from './generality.js';
import { DISCOVER_LIMITS, type DiscoverCandidate, type DiscoverReason } from '@rl/core';

/**
 * The discovery engine (feature 41, 42, D-392, D-396): candidate works from OpenAlex, ranked from the citation graph alone.
 * No Claude, no download of any file: only JSON answers of `api.openalex.org`, through the shared throttled client. A
 * candidate already in the library is never returned. Pure apart from the injected client, so it is tested with a fake one.
 * Loaded on demand (dynamic import behind the IPC handler).
 */
const OA = 'https://api.openalex.org';
const FIELDS = 'id,doi,title,publication_year,authorships,primary_location,locations,referenced_works,cited_by_count';
const LIST_BYTES = 4 * 1024 * 1024;
const q = encodeURIComponent;
type Obj = Record<string, unknown>;

/** A bridge below this score is weak: bibliometrically it shares only the general topic (works both cite). */
export const BRIDGE_THRESHOLD = 0.7;
/** The most citing works read per document, and the candidates whose details are read. */
const CITING_PER_DOC = 100;
const DETAIL_CAP = 120;
const BATCH = 50;

export interface Deps {
  net: Pick<Net, 'json'>;
  owned: OwnedIndex;
  signal?: AbortSignal | undefined;
  /** Filled by `extend` for the PRISMA counts of a project (D-439). */
  stats?: { cited: number; citing: number; duplicates: number } | undefined;
  now?: () => Date;
}

/** A library document as the engine needs it: what identifies it online. */
export interface Seed {
  docId: string;
  title: string;
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  /** The OpenAlex id stored by an earlier citation refresh, when there is one. */
  externalId?: string | null | undefined;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const workId = (u: unknown): string | null => (typeof u === 'string' ? (/W\d{1,15}$/.exec(u)?.[0] ?? null) : null);
const results = (v: unknown): Obj[] => arr(asObj(v)['results']).map(asObj);
const get = (deps: Deps, url: string) => deps.net.json(url, deps.signal, LIST_BYTES);

/** The OpenAlex id of a document: the stored one, else from its DOI (or arXiv DOI). Null when it has no identifier (or OpenAlex does not know it). */
export async function resolveSeed(deps: Deps, s: Seed): Promise<string | null> {
  if (s.externalId && /^W\d{1,15}$/.test(s.externalId)) return s.externalId;
  const doi = s.doi?.trim() || (s.arxivId ? `10.48550/arXiv.${s.arxivId.replace(/^arxiv:\s*/i, '').replace(/v\d+$/i, '')}` : '');
  const path = pathDoi(arxivFromDoi(doi) ? `10.48550/arXiv.${arxivFromDoi(doi)}` : doi);
  if (!path) return null;
  return workId(asObj(await get(deps, `${OA}/works/doi:${encodePath(path)}?select=id`))['id']);
}

async function details(deps: Deps, ids: string[]): Promise<Obj[]> {
  const out: Obj[] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(...results(await get(deps, `${OA}/works?filter=${q(`openalex_id:${ids.slice(i, i + BATCH).join('|')}`)}&per-page=${BATCH}&select=${FIELDS}`)));
  return out;
}

const citingOf = async (deps: Deps, id: string): Promise<Obj[]> => results(await get(deps, `${OA}/works?filter=${q(`cites:${id}`)}&per-page=${CITING_PER_DOC}&sort=cited_by_count:desc&select=${FIELDS}`));

/** What the graph says about one side of a search (one document, or a set): who it cites, who cites it. */
interface Side {
  ids: Set<string>;
  /** Work id to the number of documents of the side that cite it (`refs`) or are cited by it (`citing`). */
  refs: Map<string, number>;
  citing: Map<string, number>;
  known: Map<string, Obj>;
}

async function readSide(deps: Deps, ids: string[]): Promise<Side> {
  const side: Side = { ids: new Set(ids), refs: new Map(), citing: new Map(), known: new Map() };
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const id of ids) {
    const me = asObj(await get(deps, `${OA}/works/${id}?select=id,referenced_works`));
    for (const r of new Set(arr(me['referenced_works']).map(workId))) if (r) bump(side.refs, r);
    for (const w of await citingOf(deps, id)) {
      const wid = workId(w['id']);
      if (!wid) continue;
      bump(side.citing, wid);
      side.known.set(wid, w);
    }
  }
  return side;
}

function make(deps: Deps, w: Obj, score: number, reasons: DiscoverReason[], weak = false, classic = false): DiscoverCandidate | null {
  const link = openAlexLink(w, (deps.now?.() ?? new Date()).toISOString());
  const key = link.externalId;
  if (!key || !/^W\d{1,15}$/.test(key) || !link.title) return null;
  // Already in the library: not a candidate (by DOI, arXiv id, or title with year and author).
  if (findOwned(deps.owned, link)) {
    if (deps.stats) deps.stats.duplicates++;
    return null;
  }
  return {
    key,
    title: link.title,
    authors: link.authors.slice(0, 6),
    year: link.year ?? null,
    venue: link.venue ?? null,
    doi: link.doi ?? null,
    arxivId: link.arxivId ?? null,
    score: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100,
    reasons,
    state: 'new',
    weak,
    ...(classic ? { classic: true } : {}),
    fresh: false,
    summary: null,
  };
}

/** Candidates for the ids given, with details read for the ones the side already knows nothing about. */
async function build(deps: Deps, ranked: Array<{ id: string; score: number; reasons: DiscoverReason[]; weak?: boolean }>, known: Map<string, Obj>, coverage?: Map<string, number>): Promise<DiscoverCandidate[]> {
  const top = ranked.slice(0, DETAIL_CAP);
  const need = top.filter((r) => !known.has(r.id)).map((r) => r.id);
  const got = new Map(known);
  for (const w of await details(deps, need)) {
    const id = workId(w['id']);
    if (id) got.set(id, w);
  }
  const now = deps.now?.() ?? new Date();
  // Down-rank what everybody cites (old, enormously cited): the detail read here has the counts the lists lack.
  const adjusted = top.map((r) => {
    const w = got.get(r.id);
    const stats = { year: typeof w?.['publication_year'] === 'number' ? (w['publication_year'] as number) : null, cited: asNumber(w?.['cited_by_count']) };
    return { r, w, factor: specificity(stats, now, coverage?.get(r.id) ?? 0), classic: isClassic(stats, now) };
  });
  adjusted.sort((x, y) => y.r.score * y.factor - x.r.score * x.factor || (x.r.id < y.r.id ? -1 : 1));
  const out: DiscoverCandidate[] = [];
  for (const a of adjusted) {
    const c = a.w ? make(deps, a.w, a.r.score * a.factor, a.r.reasons, a.r.weak ?? false, a.classic) : null;
    if (c) out.push(c);
  }
  return out.slice(0, DISCOVER_LIMITS.candidates);
}

const byScore = <T extends { score: number; id: string; pop: number }>(a: T, b: T) => b.score - a.score || b.pop - a.pop || (a.id < b.id ? -1 : 1);

/**
 * "Estendi la bibliografia": the works cited by the given documents and the works that cite them, not in the library. A
 * candidate cited by 4 of 12 documents and citing 3 of them says so ("cited-by-owned" 4 of 12, "cites-owned" 3 of 12).
 */
export async function extend(deps: Deps, ids: string[]): Promise<DiscoverCandidate[]> {
  const side = await readSide(deps, ids);
  const n = ids.length;
  const all = new Set([...side.refs.keys(), ...side.citing.keys()]);
  if (deps.stats) {
    const both = [...side.refs.keys()].filter((id) => side.citing.has(id) && !side.ids.has(id)).length;
    deps.stats.cited = [...side.refs.keys()].filter((id) => !side.ids.has(id)).length;
    deps.stats.citing = [...side.citing.keys()].filter((id) => !side.ids.has(id)).length;
    deps.stats.duplicates += both;
  }
  const ranked = [...all]
    .filter((id) => !side.ids.has(id))
    .map((id) => {
      const a = side.refs.get(id) ?? 0;
      const b = side.citing.get(id) ?? 0;
      const reasons: DiscoverReason[] = [...(a ? [{ code: 'cited-by-owned' as const, n: a, of: n }] : []), ...(b ? [{ code: 'cites-owned' as const, n: b, of: n }] : [])];
      return { id, score: Math.min(1, (a + b) / (2 * n)), reasons, pop: asNumber(side.known.get(id)?.['cited_by_count']) };
    })
    .sort(byScore);
  // With one document everything has the same coverage: the order then leans on how cited the work is (already in `pop`).
  const max = Math.max(0.0001, ...ranked.map((r) => r.score));
  const coverage = new Map(ranked.map((r) => [r.id, (side.refs.get(r.id) ?? 0) / n]));
  return build(deps, ranked.map((r) => ({ ...r, score: r.score / max })), side.known, n >= 3 ? coverage : undefined);
}

const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * "Trova un ponte": works that link the two sides. Kinds of link: it cites both sides, both sides cite it, or it sits on the
 * shortest path (it cites one side and the other side cites it). Only the citation graph is used; the strong ones score from
 * 0.7, a work that is only cited by both is weak (it shares the general topic, nothing more).
 */
export async function bridge(deps: Deps, a: string[], b: string[]): Promise<DiscoverCandidate[]> {
  const [sa, sb] = [await readSide(deps, a), await readSide(deps, b)];
  const total = a.length + b.length;
  const known = new Map([...sa.known, ...sb.known]);
  const own = new Set([...sa.ids, ...sb.ids]);
  const ids = new Set([...sa.citing.keys(), ...sb.citing.keys(), ...sa.refs.keys(), ...sb.refs.keys()]);
  const ranked: Array<{ id: string; score: number; reasons: DiscoverReason[]; weak: boolean; pop: number }> = [];
  for (const id of ids) {
    if (own.has(id)) continue;
    const reasons: DiscoverReason[] = [];
    let sum = 0;
    let touched = 0;
    const [ca, cb, ra, rb] = [sa.citing.get(id) ?? 0, sb.citing.get(id) ?? 0, sa.refs.get(id) ?? 0, sb.refs.get(id) ?? 0];
    if (ca && cb) {
      reasons.push({ code: 'cites-both', n: ca + cb, of: total });
      sum += 1;
      touched = Math.max(touched, ca + cb);
    }
    if (ra && rb) {
      reasons.push({ code: 'cited-by-both', n: ra + rb, of: total });
      sum += 0.6;
      touched = Math.max(touched, ra + rb);
    }
    // It cites one side and the other side cites it: a step on the shortest path A -> bridge -> B (or B -> bridge -> A).
    const pathA = ca && rb ? ca + rb : 0;
    const pathB = cb && ra ? cb + ra : 0;
    if (pathA || pathB) {
      reasons.push({ code: 'path', n: Math.max(pathA, pathB), of: total });
      sum += 0.8;
      touched = Math.max(touched, pathA, pathB);
    }
    if (reasons.length === 0) continue;
    const score = Math.min(1, sum) * (0.5 + 0.5 * Math.min(1, touched / total));
    ranked.push({ id, score, reasons, weak: score < BRIDGE_THRESHOLD, pop: asNumber(known.get(id)?.['cited_by_count']) });
  }
  ranked.sort(byScore);
  return build(deps, ranked, known);
}

/** "Da una domanda": OpenAlex works for the question, best first, with the relevance normalised to the best one. */
export async function question(deps: Deps, text: string): Promise<DiscoverCandidate[]> {
  const found = results(await get(deps, `${OA}/works?search=${q(text.slice(0, DISCOVER_LIMITS.queryChars))}&per-page=${BATCH}&select=${FIELDS},relevance_score`));
  const best = Math.max(0.0001, ...found.map((w) => asNumber(w['relevance_score'])));
  const out: DiscoverCandidate[] = [];
  found.forEach((w, i) => {
    const rel = asNumber(w['relevance_score']);
    // Without a relevance score the position stands for it.
    const c = make(deps, w, rel > 0 ? rel / best : 1 - i / (found.length + 1), [{ code: 'search', n: i + 1 }]);
    if (c) out.push(c);
  });
  return out.slice(0, DISCOVER_LIMITS.candidates);
}

/** The text of an abstract from OpenAlex's inverted index (word to positions), capped. Empty when there is none. */
export function abstractText(index: unknown, max = 2400): string {
  const words: string[] = [];
  for (const [word, pos] of Object.entries(asObj(index))) for (const p of arr(pos)) if (typeof p === 'number' && p >= 0 && p < 5000) words[p] = word;
  return words.filter((w) => w !== undefined).join(' ').slice(0, max);
}

/** The public abstracts of works (a read of OpenAlex, nothing is stored here). */
export async function abstracts(deps: Deps, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const w of results(await get(deps, `${OA}/works?filter=${q(`openalex_id:${ids.slice(i, i + BATCH).join('|')}`)}&per-page=${BATCH}&select=id,abstract_inverted_index`))) {
      const id = workId(w['id']);
      const t = abstractText(w['abstract_inverted_index']);
      if (id && t !== '') out.set(id, t);
    }
  }
  return out;
}
