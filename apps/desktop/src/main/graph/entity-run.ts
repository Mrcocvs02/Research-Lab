import { AppError, type DocumentRecord } from '@rl/core';
import { buildEntityNetwork, type EntityInput, type EntityNetwork, type EntityRequest } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { readAuthorAliases } from './author-aliases.js';
import { readLabels } from './labels-store.js';
import { loadModel, modelId, type LoadedModel } from './service.js';
import { loadView, scopeIds, type LibraryView } from './view.js';

/**
 * Entity networks and topic documents, loaded on first use as their own chunk so the start of the app does not pay for
 * them (D-449, N4). Everything is local and read-only; the answer is cached per library state.
 */
type Req = EntityRequest & { scope?: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined };

interface Entry {
  key: string;
  value: EntityNetwork;
}
const caches = new WeakMap<object, Map<string, Entry>>();
const MAX_CACHED = 12;

const excludes = (path: string, folders: readonly string[]): boolean => folders.some((f) => path === f || path.startsWith(`${f}/`));

/** Records usable for a network: present (the view drops missing ones) and outside the excluded folders. */
async function usable(rt: LibraryRuntime, view: LibraryView): Promise<DocumentRecord[]> {
  const cfg = await rt.store.readConfig().catch(() => null);
  const folders = (cfg?.excludedFolders ?? []).map((f) => f.replace(/\/+$/, '')).filter((f) => f !== '');
  return folders.length === 0 ? view.records : view.records.filter((r) => !excludes(r.path, folders));
}

/** Cluster id -> document ids of the model (documents the model knows, at any level). */
export async function topicDocIds(s: MainServices, topic: string): Promise<string[]> {
  const rt = await s.runtime.require();
  const lm = await loadModel(s, rt);
  if (!lm) return [];
  const m = lm.model;
  const at = m.clusters.findIndex((c) => c.id === topic);
  if (at < 0) return [];
  const view = await loadView(rt);
  const out: string[] = [];
  for (let i = 0; i < m.ids.length; i++) if ((m.cl[i] as number[]).includes(at) && view.byId.has(m.ids[i] as string)) out.push(m.ids[i] as string);
  return out;
}

export async function runEntityNetwork(s: MainServices, req: Req): Promise<EntityNetwork> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const { aliases, key: aliasKey } = await readAuthorAliases(rt);
  // The model matters to topics (clusters) and to authors (their main topic); a missing one only empties the topics.
  const lm: LoadedModel | null = req.mode === 'tag' ? null : await loadModel(s, rt);
  if (req.mode === 'topic' && !lm) return { nodes: [], edges: [], total: 0, truncated: false, documents: 0 };
  const cfg = await rt.store.readConfig().catch(() => null);
  const labels = lm && req.mode === 'topic' ? await readLabels(s, rt, modelId(lm.model)) : {};
  const labelSig = Object.entries(labels).reduce((n, [id, l]) => n + id.length + l.text.length, 0);
  const state = `${view.key}|${lm ? lm.key : '-'}|${aliasKey}|${labelSig}|${(cfg?.excludedFolders ?? []).join('\u0001')}`;
  const cacheKey = JSON.stringify([req.mode, req.level ?? 0, req.scope ?? null, req.years ?? null, req.minDocs, req.minWeight, req.limit]);
  let cache = caches.get(rt);
  if (!cache) caches.set(rt, (cache = new Map()));
  // Project membership is not part of the library state: a network scoped to a project is always computed.
  const cacheable = req.scope?.projectId === undefined;
  const hit = cacheable ? cache.get(cacheKey) : undefined;
  if (hit && hit.key === state) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit.value;
  }

  const wanted = await scopeIds(rt, view, req.scope);
  const records = (await usable(rt, view)).filter((r) => !wanted || wanted.has(r.id));
  const clusterMeta: EntityInput['clusters'][number][] = [];
  const docClusters = new Map<string, string[]>();
  if (lm) {
    const m = lm.model;
    const ids = m.clusters.map((c) => c.id);
    for (const c of m.clusters) clusterMeta.push({ id: c.id, level: c.level, parent: c.parent >= 0 ? (ids[c.parent] as string) : null, terms: c.terms.slice(0, 3), label: labels[c.id]?.text, centroid: { x: c.cx, y: c.cy } });
    for (let i = 0; i < m.ids.length; i++) docClusters.set(m.ids[i] as string, (m.cl[i] as number[]).map((c) => ids[c] as string));
  }
  const input: EntityInput = {
    docs: records.map((r) => ({ id: r.id, authors: r.authors, year: r.year, tags: view.tagsOf(r) })),
    tax: (view.tax?.nodes ?? []).map((n) => ({ id: n.id, label: n.label, parents: n.parents, implies: n.implies, status: n.status, color: n.color })),
    clusters: clusterMeta,
    docClusters,
  };
  let value: EntityNetwork;
  try {
    value = buildEntityNetwork(input, req, aliases);
  } catch (e) {
    throw new AppError('IO_ERROR', 'The network could not be computed', { reason: e instanceof Error ? e.message.slice(0, 100) : 'error' });
  }
  if (!cacheable) return value;
  cache.set(cacheKey, { key: state, value });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return value;
}
