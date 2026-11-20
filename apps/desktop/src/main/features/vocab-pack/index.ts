import { AppError, type PackListResult, type PackPreview, type PackSearchItem, type TaxonomyOp } from '@rl/core';
import type { VocabPackState } from '@rl/core/vocab';
import { normalizeName } from '@rl/data';
import { conceptPath, matchPack, packRef, type PackMatchInput } from '@rl/data/pack-match';
import { settle } from '../../ipc/handlers/organize-handlers.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { conceptLabel, freshNodeId, linkedConcepts, materialization } from './materialize.js';
import { loadPack, readIndex, type LoadedPack } from './packs.js';
import { emptyState, readState, writeState } from './state.js';

/**
 * The field vocabulary (D-516 .. D-518, section 20.1), loaded on demand behind the `vocabPack:*` handlers: the list with its suggestion, the
 * local preview, turning a pack on as ONE undoable change, turning it off, the search of the tag picker and the materialization of a concept.
 * Nothing here sends anything anywhere.
 */

type Rt = Awaited<ReturnType<MainServices['runtime']['require']>>;
/** A pack that recognises at least this share of the tags (and a few of them) is suggested, once. */
const SUGGEST_SHARE = 0.2;
const SUGGEST_MIN = 5;
const MAX_REJECTED = 5000;

const languageOf = async (s: MainServices): Promise<'it' | 'en'> => ((await s.settings.get()).uiLanguage === 'en' ? 'en' : 'it');

async function inputOf(rt: Rt, loaded: LoadedPack, state: VocabPackState, chosen?: Record<string, string>): Promise<PackMatchInput> {
  const tax = await rt.store.readTaxonomy();
  const docs = (await rt.store.documents.list()).filter((d) => !d.missing);
  return {
    packId: loaded.pack.id,
    nodes: tax.nodes.map((n) => ({ id: n.id, label: n.label, aliases: n.aliases, parents: n.parents, status: n.status, family: n.family, pack: n.pack })),
    docs: docs.map((d) => ({ id: d.id, tags: d.tags })),
    families: loaded.families,
    concepts: loaded.concepts,
    rejected: state.packId === loaded.pack.id ? state.rejected : [],
    chosenFamilies: chosen,
  };
}

export async function list(s: MainServices, req: { dismiss?: boolean | undefined }): Promise<PackListResult> {
  const rt = await s.runtime.require();
  const packs = await readIndex();
  const st = await readState(rt.store.dataDir);
  const active = st.packId === '' ? null : { packId: st.packId, packVersion: st.packVersion };
  if (req.dismiss === true && st.suggested !== true) await writeState(rt.store.dataDir, { ...st, suggested: true });
  let suggest: string | null = null;
  if (active === null && st.suggested !== true && req.dismiss !== true && packs.length > 0) {
    const nodes = (await rt.store.readTaxonomy()).nodes.length;
    if (nodes >= SUGGEST_MIN) {
      for (const p of packs) {
        const r = matchPack(await inputOf(rt, await loadPack(p.id), st));
        if (r.recognized >= SUGGEST_MIN && r.tags > 0 && r.recognized / r.tags >= SUGGEST_SHARE) {
          suggest = p.id;
          break;
        }
      }
    }
  }
  return { packs, active, suggest };
}

export async function preview(s: MainServices, req: { packId: string }): Promise<PackPreview> {
  const rt = await s.runtime.require();
  const loaded = await loadPack(req.packId);
  const r = matchPack(await inputOf(rt, loaded, await readState(rt.store.dataDir)));
  return { recognized: r.recognized, tags: r.tags, papersWithTopic: r.papersWithTopic, papers: r.papers, conflicts: r.conflicts, families: r.families, matches: r.matches, distinct: r.distinct, place: r.place };
}

const invalid = (message: string, details: Record<string, unknown> = {}) => new AppError('INVALID_REQUEST', message, details);

export async function enable(
  s: MainServices,
  req: { packId: string; families: Record<string, string>; accept: { matches: Array<{ nodeId: string; conceptId: string; useFieldName?: boolean | undefined }>; place: Array<{ nodeId: string; parentId: string | null }> }; reject: string[][] },
): Promise<{ changeId: string | null; linked: number; placed: number }> {
  const rt = await s.runtime.require();
  const loaded = await loadPack(req.packId);
  const dataDir = rt.store.dataDir;
  const before = await readState(dataDir);
  if (before.packId !== '') throw invalid('A field vocabulary is already in use', { reason: 'already-active', packId: before.packId });
  const lang = await languageOf(s);
  const tax = await rt.store.readTaxonomy();
  const byId = new Map(tax.nodes.map((n) => [n.id, n]));
  const taken = new Set(tax.nodes.map((n) => n.id));

  // Family pairing: a root of the library (one that exists) or `later`.
  const families: Record<string, string> = {};
  for (const f of loaded.families) {
    const v = req.families[f.id] ?? 'later';
    if (v !== 'later' && !(byId.get(v)?.parents.length === 0 && byId.get(v)?.family !== undefined && byId.get(v)?.family !== 'keywords')) throw invalid('A family is paired with something that is not a family root', { family: f.id });
    families[f.id] = v;
  }
  const state: VocabPackState = { ...before, packId: loaded.pack.id, packVersion: loaded.pack.version, enabledAt: new Date().toISOString(), families, changeIds: [] };

  const ops: TaxonomyOp[] = [];
  const conceptOfNode = new Map<string, string>();
  const usedConcepts = new Set<string>();
  for (const m of req.accept.matches) {
    const node = byId.get(m.nodeId);
    const concept = loaded.byId.get(m.conceptId);
    if (!node || !concept) throw invalid('A tag or a concept is not there', { nodeId: m.nodeId, conceptId: m.conceptId });
    if (node.pack !== undefined || conceptOfNode.has(node.id) || usedConcepts.has(concept.id)) continue;
    conceptOfNode.set(node.id, concept.id);
    usedConcepts.add(concept.id);
    ops.push({ op: 'setPack', id: node.id, pack: packRef(loaded.pack.id, concept.id) });
    const field = conceptLabel(concept, lang);
    const variants = [concept.label, ...(concept.labelIt ? [concept.labelIt] : [])];
    if (m.useFieldName === true) {
      ops.push({ op: 'rename', id: node.id, label: field }, { op: 'setAliases', id: node.id, aliases: [node.label, ...node.aliases] });
    } else ops.push({ op: 'setAliases', id: node.id, aliases: [...node.aliases, ...variants] });
  }

  // Placement: shallow concepts first, so that a parent is placed before its children; a family still `later` gets its root now.
  const depthOf = (id: string): number => {
    let d = 0;
    for (let c = loaded.byId.get(id); c?.parent !== undefined && d < 8; c = loaded.byId.get(c.parent)) d++;
    return d;
  };
  let placed = 0;
  const roots = new Map<string, string>();
  const places = req.accept.place.filter((p) => conceptOfNode.has(p.nodeId)).sort((a, b) => depthOf(conceptOfNode.get(a.nodeId) as string) - depthOf(conceptOfNode.get(b.nodeId) as string));
  for (const p of places) {
    if (!byId.has(p.nodeId)) throw invalid('A tag to place is not there', { nodeId: p.nodeId });
    let parent = p.parentId;
    if (parent !== null && !byId.has(parent)) throw invalid('The parent of a tag to place is not there', { parentId: parent });
    if (parent === null) {
      const fam = loaded.byId.get(conceptOfNode.get(p.nodeId) as string)?.family ?? '';
      const fixed = families[fam];
      if (fixed !== undefined && fixed !== 'later') parent = fixed;
      else {
        let id = roots.get(fam);
        if (id === undefined) {
          const f = loaded.families.find((x) => x.id === fam);
          id = freshNodeId(f?.label ?? fam, taken);
          ops.push({ op: 'create', id, label: f?.label ?? fam }, { op: 'setFamily', id, family: f?.singleValue ? 'one' : 'many' });
          roots.set(fam, id);
          state.families[fam] = id;
        }
        parent = id;
      }
    }
    ops.push({ op: 'move', id: p.nodeId, parents: [parent] });
    placed++;
  }

  let changeId: string | null = null;
  if (ops.length > 0) {
    const r = await rt.organizer.applyTaxonomy(ops, tax.revision, { summary: `Field vocabulary: ${conceptOfNode.size} tags linked` });
    await settle(s, rt, r, [{ kind: 'taxonomy' }]);
    changeId = r.changeId;
    state.changeIds = [r.changeId];
  }
  const seen = new Set(state.rejected.map(([a, b]) => `${a}\u0000${b}`));
  for (const [n, c] of req.reject) if (n !== undefined && c !== undefined && !seen.has(`${n}\u0000${c}`)) state.rejected.push([n, c]);
  state.rejected = state.rejected.slice(-MAX_REJECTED);
  await writeState(dataDir, state);
  return { changeId, linked: conceptOfNode.size, placed };
}

export async function disable(s: MainServices, req: { undo: boolean }): Promise<{ undone: number; stopped?: string }> {
  const rt = await s.runtime.require();
  const st = await readState(rt.store.dataDir);
  if (st.packId === '') return { undone: 0 };
  let undone = 0;
  let stopped: string | undefined;
  const left = [...st.changeIds];
  if (req.undo) {
    // Later change first, like `undoRun`; it stops, with the reason, when a change after it touches the same tags.
    const settled = new Set<string>();
    for (const id of [...st.changeIds].reverse()) {
      try {
        const r = await rt.organizer.undo(id, settled);
        for (const d of r.docIds) settled.add(d);
        await settle(s, rt, r, [{ kind: 'taxonomy' }, { kind: 'documents' }]);
        undone++;
        left.pop();
      } catch (e) {
        const err = AppError.from(e);
        if (err.code !== 'CONFLICT' && err.code !== 'INVALID_REQUEST' && err.code !== 'NOT_FOUND') throw e;
        stopped = err.message;
        break;
      }
    }
  }
  if (stopped === undefined) await writeState(rt.store.dataDir, { ...emptyState(), suggested: true });
  else await writeState(rt.store.dataDir, { ...st, changeIds: left });
  return { undone, ...(stopped !== undefined ? { stopped } : {}) };
}

const words = (q: string): string[] => normalizeName(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export async function search(s: MainServices, req: { q: string; limit?: number | undefined }): Promise<{ items: PackSearchItem[] }> {
  const rt = await s.runtime.require();
  const st = await readState(rt.store.dataDir);
  if (st.packId === '') throw invalid('No field vocabulary is in use', { reason: 'no-pack' });
  const loaded = await loadPack(st.packId);
  const lang = await languageOf(s);
  const q = words(req.q);
  if (q.length === 0) return { items: [] };
  const linked = linkedConcepts(await rt.store.readTaxonomy(), st.packId);
  const fams = new Map(loaded.families.map((f) => [f.id, f]));
  const hits: Array<{ score: number; c: (typeof loaded.concepts)[number] }> = [];
  for (const c of loaded.concepts) {
    if (linked.has(c.id)) continue;
    let best = 0;
    for (const form of [c.label, ...(c.labelIt ? [c.labelIt] : []), ...c.aliases]) {
      const n = normalizeName(form);
      const toks = words(form);
      // Every typed word starts a word of the name (3), or is inside it (1): all of them must be found.
      const parts: number[] = q.map((w) => (toks.some((t) => t.startsWith(w)) ? 3 : n.includes(w) ? 1 : 0));
      if (parts.every((x) => x > 0)) best = Math.max(best, parts.reduce((a, b) => a + b, 0) + (n === q.join(' ') ? 5 : 0) + (n.startsWith(q.join(' ')) ? 2 : 0));
    }
    if (best > 0) hits.push({ score: best, c });
  }
  hits.sort((a, b) => b.score - a.score || a.c.label.length - b.c.label.length || (a.c.id < b.c.id ? -1 : 1));
  const concepts = new Map(loaded.concepts.map((c) => [c.id, c]));
  const items = hits.slice(0, req.limit ?? 6).map(({ c }) => {
    const full = conceptPath(concepts, fams, c.id);
    const cut = full.lastIndexOf(' › ');
    return { conceptId: c.id, label: conceptLabel(c, lang), path: cut < 0 ? full : full.slice(0, cut), family: fams.get(c.family)?.label ?? c.family };
  });
  return { items };
}

export async function materialize(s: MainServices, req: { conceptId: string; docIds?: string[] | undefined }): Promise<{ nodeId: string; created: string[]; changeId: string }> {
  const rt = await s.runtime.require();
  const st = await readState(rt.store.dataDir);
  if (st.packId === '') throw invalid('No field vocabulary is in use', { reason: 'no-pack' });
  const loaded = await loadPack(st.packId);
  if (!loaded.byId.has(req.conceptId)) throw new AppError('NOT_FOUND', 'Unknown concept', { conceptId: req.conceptId });
  const tax = await rt.store.readTaxonomy();
  const m = materialization(tax, st, loaded, req.conceptId, await languageOf(s));
  if ('depth' in m) throw invalid('This concept would go deeper than the tags allow', { reason: 'depth' });
  if (m.ops.length === 0 && (req.docIds?.length ?? 0) === 0) return { nodeId: m.nodeId, created: [], changeId: '' };
  const r = await rt.organizer.applyTaxonomy(m.ops, tax.revision, {
    docEdits: (req.docIds ?? []).map((docId) => ({ docId, addTags: [m.nodeId] })),
    summary: `Field vocabulary: ${loaded.byId.get(req.conceptId)?.label ?? req.conceptId}`,
  });
  await settle(s, rt, r, [{ kind: 'taxonomy' }, ...(r.reindex.length > 0 ? [{ kind: 'documents' as const, ids: r.reindex.length <= 500 ? r.reindex : undefined }] : [])]);
  if (m.root) await writeState(rt.store.dataDir, { ...st, families: { ...st.families, [m.root.family]: m.root.id } });
  return { nodeId: m.nodeId, created: m.created, changeId: r.changeId };
}

/** Remembers a family root made outside this chunk (the review of an AI proposal creates it with the tags). */
export async function recordRoot(dataDir: string, family: string, id: string): Promise<void> {
  const st = await readState(dataDir);
  if (st.packId !== '') await writeState(dataDir, { ...st, families: { ...st.families, [family]: id } });
}
