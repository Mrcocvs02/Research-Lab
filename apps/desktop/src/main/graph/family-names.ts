import { aiVisible } from '@rl/ai';
import { structuredSystem, type Lang } from '@rl/ai/analysis';
import { AppError } from '@rl/core';
import { z } from 'zod';
import { loadCtx } from '../ai/service.js';
import { clip, costs, modelOf, oneLine, send } from '../features/project/ai.js';
import type { MainServices } from '../ipc/handlers/services.js';
import { autoModel, scopeKey } from './family-run.js';
import { writeName, MAX_NAME } from './family-names-store.js';
import { loadModel, modelId } from './service.js';
import { loadView, titleOf } from './view.js';

/**
 * "Dai un nome con Claude" for the clusters of the automatic family (D-489), the same pattern as the manuscript proposals (D-416):
 * the exact text is shown first, with the model and the cost; only the top tags and the titles of papers in enabled folders leave
 * (tags counted on those papers alone); nothing is written by the send, each name is accepted by the user.
 */
export const NAMES_VERSION = 'family-names-v1';
export const NAMES_OUT_TOKENS = 400;
const MAX_CLUSTERS = 7;
const MAX_TITLES = 8;
const MAX_TAGS = 6;
type Scope = { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;

export const namesSchema = z.object({ names: z.array(z.object({ cluster: z.string(), name: z.string() })) });

export function namesSystem(language: Lang): string {
  return structuredSystem({
    version: NAMES_VERSION,
    role: 'You name groups of papers of a research library from their most recurring tags and the titles of some members.',
    output: 'JSON {"names": [{"cluster": "<cluster id, like C1>", "name": "<short name, two to four words>"}]}. One name per cluster.',
    rules: ['Use only the ids given; judge only from the tags and titles shown.', 'Names are short noun phrases that tell the groups apart; no quotes, no trailing punctuation.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');
export interface PromptCluster {
  key: string;
  tags: string[];
  titles: string[];
}
export const namesPrompt = (cs: readonly PromptCluster[]): string =>
  `${cs.map((c) => `<<<DATA cluster ${c.key}\ntags: ${strip(c.tags.join(', '))}\ntitles:\n${c.titles.map((t) => `- ${strip(t)}`).join('\n')}\nDATA>>>`).join('\n')}\nName the clusters.`;

/** Answer to (cluster id, name) pairs: unknown ids, repeats and empty names are dropped; names are one line of at most `MAX_NAME`. */
export function parseNames(raw: z.infer<typeof namesSchema>, keys: ReadonlyMap<string, string>): Array<{ cluster: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ cluster: string; name: string }> = [];
  for (const r of raw.names) {
    const cluster = keys.get(r.cluster);
    const name = clip(oneLine(r.name).replace(/^["‘’“”]+|["‘’“”.]+$/g, ''), MAX_NAME);
    if (!cluster || name === '' || seen.has(cluster)) continue;
    seen.add(cluster);
    out.push({ cluster, name });
  }
  return out;
}

async function gather(s: MainServices, scope: Scope) {
  const ctx = await loadCtx(s);
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const mem = await autoModel(s, view, scope);
  const clusters: PromptCluster[] = [];
  const keys = new Map<string, string>();
  const current = new Map<string, string>();
  const docIds: string[] = [];
  if (mem) {
    const members = new Map<string, string[]>();
    for (const [id, list] of mem.docs) for (const e of list) (members.get(e.cluster) ?? members.set(e.cluster, []).get(e.cluster)!).push(id);
    const order = [...members.keys()].sort((a, b) => members.get(b)!.length - members.get(a)!.length || (a < b ? -1 : 1)).slice(0, MAX_CLUSTERS);
    for (const id of order) {
      const recs = members.get(id)!.flatMap((d) => {
        const r = view.byId.get(d);
        return r && aiVisible(r.path, ctx.cfg) ? [r] : [];
      });
      if (recs.length === 0) continue;
      const tf = new Map<string, number>();
      for (const r of recs) for (const t of new Set(view.tagsOf(r))) tf.set(t, (tf.get(t) ?? 0) + 1);
      const tags = [...tf]
        .filter(([, c]) => c >= 2 || recs.length === 1)
        .map(([t, c]) => ({ t, s: (c / recs.length) * Math.log(1 + view.records.length / Math.max(1, view.tagCount(t))) }))
        .sort((a, b) => b.s - a.s || (a.t < b.t ? -1 : 1))
        .slice(0, MAX_TAGS)
        .map((x) => oneLine(view.lookup.tagLabel(x.t) ?? x.t));
      const shown = recs.slice(0, MAX_TITLES);
      const key = `C${clusters.length + 1}`;
      clusters.push({ key, tags, titles: shown.map((r) => clip(oneLine(titleOf(r)), 120)) });
      keys.set(key, id);
      current.set(id, mem.labels.get(id) ?? id);
      docIds.push(...shown.map((r) => r.id));
    }
  }
  return { ctx, clusters, keys, current, docIds };
}

export async function previewFamilyNames(s: MainServices, req: { model?: string | undefined; scope?: Scope }) {
  const g = await gather(s, req.scope);
  const model = modelOf(g.ctx, req.model);
  const text = g.clusters.length > 0 ? namesPrompt(g.clusters) : '';
  const k = await costs(g.ctx, model, text.length + namesSystem(g.ctx.cfg.language).length, NAMES_OUT_TOKENS);
  return { text, candidates: g.clusters.length, ...k };
}

/** Never writes: the dialog stores what the user accepts (`graph:acceptFamilyName`). */
export async function nameFamily(s: MainServices, req: { model?: string | undefined; scope?: Scope; confirmed: boolean }) {
  const g = await gather(s, req.scope);
  const model = modelOf(g.ctx, req.model);
  if (!req.confirmed) throw new AppError('CONFLICT', 'The send needs the confirmation of the user', { reason: 'needs-confirmation' });
  if (g.clusters.length === 0) return { items: [] };
  const system = namesSystem(g.ctx.cfg.language);
  const prompt = namesPrompt(g.clusters);
  const k = await costs(g.ctx, model, system.length + prompt.length, NAMES_OUT_TOKENS);
  const raw = await send(s, g.ctx, { purpose: 'family-names', model, system, prompt, schema: namesSchema, docIds: g.docIds }, k, req.confirmed);
  return { items: parseNames(raw, g.keys).map((x) => ({ ...x, current: g.current.get(x.cluster) ?? x.cluster })) };
}

/** The user accepted (or, with `name: null`, cleared) the name of one cluster of the automatic family. */
export async function acceptFamilyName(s: MainServices, req: { cluster: string; name: string | null; scope?: Scope }): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  const lm = await loadModel(s, rt);
  if (!lm) throw new AppError('NOT_FOUND', 'No model');
  await writeName(s, rt, modelId(lm.model), `${scopeKey(req.scope)}|${req.cluster}`, req.name === null ? null : oneLine(req.name));
  return { ok: true };
}
