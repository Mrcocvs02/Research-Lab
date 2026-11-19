import type { DocumentId } from '@rl/core';
import { buildEvidence, findPath, neighborsOf, similarityThreshold, topWeights, type EvidenceEdge, type EvidenceInput, type Strictness } from '@rl/graph';
import { readLinks } from '../features/doclinks/store.js';
import type { MainServices } from '../ipc/handlers/services.js';
import { drift, loadModel, modelId } from './service.js';
import { loadView, scopeIds } from './view.js';

/**
 * Evidence between papers for the Map (D-499, sections 19.2.3, 19.2.5), loaded on first use as its own chunk. Citations, the user's links and
 * the similarity of the model give the pairs; the threshold tau comes from the library and the strictness. Nothing is written.
 */
type Scope = { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;
interface Gathered {
  input: EvidenceInput;
  /** Top similarity weights of the scope, ascending (what tau is read from). */
  weights: number[];
  docs: number;
}

/** Papers whose citation files are read (one small file each); beyond this only the citations the model saw (`direct`) count. */
const MAX_CITATION_READS = 2000;
const BATCH = 32;
let last: { key: string; value: Gathered } | null = null;

async function gather(s: MainServices, scope: Scope): Promise<Gathered> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const lm = await loadModel(s, rt);
  const wanted = await scopeIds(rt, view, scope);
  const links = await readLinks(rt.store.dataDir);
  const key = `${view.key}|${lm ? modelId(lm.model) : ''}|${JSON.stringify(scope ?? null)}|${links.links.length}`;
  // A project's membership is not part of the library state: that scope is never reused.
  if (last && last.key === key && scope?.projectId === undefined) return last.value;
  const inScope = (id: string): boolean => view.byId.has(id) && (!wanted || wanted.has(id));
  const input: { similar: Array<{ a: string; b: string; w: number }>; cites: Array<[string, string]>; links: Array<[string, string]> } = { similar: [], cites: [], links: [] };
  const perDoc: number[][] = [];
  if (lm) {
    const m = lm.model;
    const stale = new Set(drift(view, m, lm.index).pending.map((r) => r.id));
    const ok = (id: string): boolean => !stale.has(id) && inScope(id);
    for (let i = 0; i < m.ids.length; i++) {
      const a = m.ids[i] as string;
      if (!ok(a)) continue;
      const ws: number[] = [];
      for (const nb of neighborsOf(m, i)) {
        const b = m.ids[nb.j] as string;
        if (!ok(b)) continue;
        ws.push(nb.score);
        if (a < b) input.similar.push({ a, b, w: nb.score });
        else input.similar.push({ a: b, b: a, w: nb.score });
        if (nb.direct) input.cites.push([a, b]);
      }
      perDoc.push(ws);
    }
  }
  const ids = view.records.map((r) => r.id).filter(inScope);
  if (ids.length <= MAX_CITATION_READS) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const files = await Promise.all(ids.slice(i, i + BATCH).map((id) => rt.store.citations.get(id as DocumentId).catch(() => null)));
      files.forEach((f, k) => {
        const id = ids[i + k] as string;
        for (const l of f?.references ?? []) if (l.matchedDocId && l.matchedDocId !== id && inScope(l.matchedDocId)) input.cites.push([id, l.matchedDocId]);
      });
    }
  }
  for (const l of links.links) if (inScope(l.a) && inScope(l.b)) input.links.push([l.a, l.b]);
  const value: Gathered = { input, weights: topWeights(perDoc), docs: ids.length };
  last = { key, value };
  return value;
}

const tauOf = (g: Gathered, strictness: Strictness): number => similarityThreshold(g.weights, strictness, g.docs);

/** `graph:evidence`: the threshold and the edges (at most 5 per paper). */
export async function runEvidence(s: MainServices, req: { scope?: Scope; strictness: Strictness }): Promise<{ tau: number; edges: EvidenceEdge[] }> {
  const g = await gather(s, req.scope);
  const tau = tauOf(g, req.strictness);
  return { tau, edges: buildEvidence(g.input, tau) };
}

/** `graph:path`: the shortest chain of evidence from a paper to another, over the whole library. */
export async function runPath(s: MainServices, req: { a: string; b: string; strictness: Strictness }): Promise<{ tau: number; steps: EvidenceEdge[] }> {
  const g = await gather(s, undefined);
  const tau = tauOf(g, req.strictness);
  return { tau, steps: findPath(g.input, tau, req.a, req.b) };
}
