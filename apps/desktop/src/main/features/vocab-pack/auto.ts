import type { TaxonomyFile, TaxonomyOp } from '@rl/core';
import { applyTaxonomyOps } from '@rl/data';
import { matchPack, packRef, type PackConceptIn, type PackMatchResult } from '@rl/data/pack-match';
import { settle } from '../../ipc/handlers/organize-handlers.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { inputOf, languageOf } from './index.js';
import { conceptLabel, freshNodeId, linkedConcepts, MAX_LEVELS } from './materialize.js';
import { loadPack, readIndex, type LoadedPack } from './packs.js';
import { readState, writeState } from './state.js';

/**
 * The field vocabulary applied by itself (D-565, section 20.1.6): when a library is clearly in the field of a pack, the sure matches are
 * linked, merged when two tags are the same concept, and placed under the hierarchy of the pack, as ONE undoable change. The likely and
 * the maybe stay proposals (the review of the pack dialog). Local: no AI, no tokens.
 */

/** At least this many tags, and this share of the tags of the library, must sure-match the pack. */
export const AUTO_MIN = 8;
export const AUTO_SHARE = 0.1;

type Node = TaxonomyFile['nodes'][number];

export interface AutoPlan {
  ops: TaxonomyOp[];
  /** Tags recognised: linked or merged into the tag that is linked. */
  linked: number;
  /** Pack family id -> root of the library, or `later`. */
  families: Record<string, string>;
}

/** The operations the sure matches ask for. Pure: it applies them to a copy as it goes, and drops a group that does not hold (a cycle, too deep). */
export function planAuto(i: { tax: TaxonomyFile; loaded: LoadedPack; match: PackMatchResult; docs: ReadonlyArray<{ tags: readonly string[] }>; lang: 'it' | 'en'; now: string }): AutoPlan {
  const { loaded, match, lang } = i;
  const packId = loaded.pack.id;
  const ops: TaxonomyOp[] = [];
  let work = i.tax;
  const taken = new Set(work.nodes.map((n) => n.id));

  // `setFamily` needs the lazy extension of the organizer: here it is applied by hand, to the copy only.
  const attempt = (group: TaxonomyOp[], fits?: (t: TaxonomyFile) => boolean): boolean => {
    try {
      const next = applyTaxonomyOps(work, group.filter((o) => o.op !== 'setFamily'), new Map(), i.now).taxonomy;
      for (const o of group) {
        if (o.op !== 'setFamily') continue;
        const n = next.nodes.find((x) => x.id === o.id);
        if (!n) continue;
        if (o.family === null) delete n.family;
        else n.family = o.family;
      }
      if (fits && !fits(next)) return false;
      work = next;
      ops.push(...group);
      return true;
    } catch {
      return false;
    }
  };

  const kidsOf = (t: TaxonomyFile): Map<string, string[]> => {
    const kids = new Map<string, string[]>();
    for (const n of t.nodes) for (const p of n.parents) (kids.get(p) ?? kids.set(p, []).get(p) ?? []).push(n.id);
    return kids;
  };
  const levelOf = (t: TaxonomyFile, id: string): number => {
    const byId = new Map(t.nodes.map((n) => [n.id, n]));
    let d = 0;
    for (let cur = id; d < 20; d++) {
      const p = byId.get(cur)?.parents.find((x) => byId.has(x));
      if (p === undefined) break;
      cur = p;
    }
    return d;
  };
  const heightOf = (kids: Map<string, string[]>, id: string, depth = 0): number => (depth > 6 ? 0 : Math.max(0, ...(kids.get(id) ?? []).map((k) => 1 + heightOf(kids, k, depth + 1))));
  const fits = (t: TaxonomyFile, id: string): boolean => levelOf(t, id) + heightOf(kidsOf(t), id) <= MAX_LEVELS;

  const direct = new Map<string, number>();
  for (const d of i.docs) for (const t of new Set(d.tags)) direct.set(t, (direct.get(t) ?? 0) + 1);
  /** Some paper uses the tag or one under it: the macro-areas above it are then worth showing. */
  const used = (id: string): boolean => {
    const kids = kidsOf(work);
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      if ((direct.get(x) ?? 0) > 0) return true;
      stack.push(...(kids.get(x) ?? []));
    }
    return false;
  };
  const distinct = (a: string, b: string): boolean => (i.tax.distinct ?? []).some((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a));
  const depthOfConcept = (id: string): number => {
    let d = 0;
    for (let c = loaded.byId.get(id); c?.parent !== undefined && d < 8; c = loaded.byId.get(c.parent)) d++;
    return d;
  };

  // The root each pack family goes under: the one found, one made at first use (`later`), or none when the kinds differ (the type is never changed).
  const pick = new Map<string, string>(match.families.map((f) => [f.packFamily, f.reason === 'kind' ? 'skip' : f.root]));
  const roots = new Map<string, string>();
  const nodeOf = linkedConcepts(work, packId);

  const sure = new Map<string, string[]>();
  for (const m of match.matches) if (m.confidence === 'sure') (sure.get(m.conceptId) ?? sure.set(m.conceptId, []).get(m.conceptId) ?? []).push(m.nodeId);
  let linked = 0;
  const order = [...sure.keys()].filter((c) => loaded.byId.has(c)).sort((a, b) => depthOfConcept(a) - depthOfConcept(b) || (a < b ? -1 : 1));
  for (const conceptId of order) {
    const concept = loaded.byId.get(conceptId) as PackConceptIn;
    const byId = new Map(work.nodes.map((n) => [n.id, n]));
    // Of the tags that are the same concept the most used stays; the others are merged into it, unless the user said they differ.
    const group = (sure.get(conceptId) as string[]).filter((id) => byId.has(id) && byId.get(id)?.pack === undefined).sort((a, b) => (direct.get(b) ?? 0) - (direct.get(a) ?? 0) || (byId.get(a) as Node).label.length - (byId.get(b) as Node).label.length || (a < b ? -1 : 1));
    const keeper = group[0];
    const node = keeper === undefined ? undefined : byId.get(keeper);
    if (keeper === undefined || !node) continue;
    const variants = [concept.label, ...(concept.labelIt ? [concept.labelIt] : [])];
    if (!attempt([{ op: 'setPack', id: keeper, pack: packRef(packId, conceptId) }, { op: 'setAliases', id: keeper, aliases: [...node.aliases, ...variants] }])) continue;
    nodeOf.set(conceptId, keeper);
    linked++;
    for (const other of group.slice(1)) {
      if (distinct(keeper, other) || !attempt([{ op: 'merge', from: other, into: keeper }])) continue;
      direct.set(keeper, (direct.get(keeper) ?? 0) + (direct.get(other) ?? 0));
      linked++;
    }
    place(keeper, concept);
  }

  /** The tag goes under the nearest ancestor of its concept that is a tag, with the missing ancestors made (when a paper uses it), else under the family root. */
  function place(id: string, concept: PackConceptIn): void {
    const target = pick.get(concept.family);
    if (target === undefined || target === 'skip') return;
    const missing: PackConceptIn[] = [];
    let base: string | null = null;
    for (let c = concept.parent ? loaded.byId.get(concept.parent) : undefined, k = 0; c && k < 8; c = c.parent ? loaded.byId.get(c.parent) : undefined, k++) {
      const n = nodeOf.get(c.id);
      if (n !== undefined && work.nodes.some((x) => x.id === n)) {
        base = n;
        break;
      }
      missing.unshift(c);
    }
    // A macro-area is never imposed: with no paper under the tag, it stays where it is.
    if (missing.length > 0 && !used(id)) return;
    const go = (chain: PackConceptIn[]): boolean => {
      const group: TaxonomyOp[] = [];
      let parent: string;
      let madeRoot: string | undefined;
      if (base !== null) parent = base;
      else if (target !== 'later') parent = target;
      else if (roots.has(concept.family)) parent = roots.get(concept.family) as string;
      else {
        const fam = loaded.families.find((f) => f.id === concept.family);
        madeRoot = freshNodeId(fam?.label ?? concept.family, taken);
        group.push({ op: 'create', id: madeRoot, label: fam?.label ?? concept.family }, { op: 'setFamily', id: madeRoot, family: fam?.singleValue ? 'one' : 'many' });
        parent = madeRoot;
      }
      const made: Array<[string, string]> = [];
      for (const c of chain) {
        const nid = freshNodeId(conceptLabel(c, lang), taken);
        group.push({ op: 'create', id: nid, label: conceptLabel(c, lang), parents: [parent] }, { op: 'setPack', id: nid, pack: packRef(packId, c.id) });
        made.push([c.id, nid]);
        parent = nid;
      }
      group.push({ op: 'move', id, parents: [parent] });
      if (!attempt(group, (t) => fits(t, id))) return false;
      for (const [c, nid] of made) nodeOf.set(c, nid);
      if (madeRoot !== undefined) roots.set(concept.family, madeRoot);
      return true;
    };
    if (!go(missing) && missing.length > 0) go([]);
  }

  const families: Record<string, string> = {};
  for (const f of loaded.families) {
    const p = pick.get(f.id);
    families[f.id] = roots.get(f.id) ?? (p === undefined || p === 'skip' ? 'later' : p);
  }
  return { ops, linked, families };
}

/** Libraries already looked at, with the revision of their taxonomy: the same taxonomy is not matched twice. */
const checked = new Map<string, number>();

/**
 * Applies the pack that fits the library, if there is one and the user never decided about it: no pack in use, the suggestion not
 * dismissed, never turned off. Returns what it did, or null when nothing was applied. Tells the window with `vocabPack:autoApplied`.
 */
export async function autoApply(s: MainServices): Promise<{ n: number; changeId: string; packId: string } | null> {
  const rt = await s.runtime.require();
  const dataDir = rt.store.dataDir;
  const before = await readState(dataDir);
  if (before.packId !== '' || before.suggested === true || before.dismissed === true) return null;
  const tax = await rt.store.readTaxonomy();
  if (tax.nodes.length < AUTO_MIN || checked.get(dataDir) === tax.revision) return null;
  checked.set(dataDir, tax.revision);
  let best: { loaded: LoadedPack; match: PackMatchResult; sure: number; docs: Awaited<ReturnType<typeof inputOf>>['docs'] } | null = null;
  for (const p of await readIndex()) {
    const loaded = await loadPack(p.id).catch(() => null);
    if (!loaded) continue;
    const input = await inputOf(rt, loaded, before);
    const match = matchPack(input);
    const sure = match.matches.filter((m) => m.confidence === 'sure').length;
    if (sure >= Math.max(AUTO_MIN, Math.ceil(match.tags * AUTO_SHARE)) && (best === null || sure > best.sure)) best = { loaded, match, sure, docs: input.docs };
  }
  if (best === null) return null;
  const now = new Date().toISOString();
  const plan = planAuto({ tax, loaded: best.loaded, match: best.match, docs: best.docs, lang: await languageOf(s), now });
  if (plan.ops.length === 0) return null;
  const r = await rt.organizer.applyTaxonomy(plan.ops, tax.revision, { summary: `Field vocabulary applied automatically: ${plan.linked} tags` });
  await settle(s, rt, r, [{ kind: 'taxonomy' }, ...(r.reindex.length > 0 ? [{ kind: 'documents' as const, ids: r.reindex.length <= 500 ? r.reindex : undefined }] : [])]);
  const packId = best.loaded.pack.id;
  await writeState(dataDir, { ...before, packId, packVersion: best.loaded.pack.version, enabledAt: now, families: plan.families, changeIds: [r.changeId], auto: { n: plan.linked, at: now, changeId: r.changeId } });
  s.emit('vocabPack:autoApplied', { n: plan.linked, changeId: r.changeId, at: now });
  return { n: plan.linked, changeId: r.changeId, packId };
}
