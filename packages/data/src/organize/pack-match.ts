import type { PackFamilyMatch, PackMatch } from '@rl/core';
import { buildIndex, formKey, namePairs, type Confidence, type ReviewNode } from './tag-review.js';

/**
 * Pairing of a field vocabulary pack with the vocabulary of the library (D-517, section 20.1.2): which root of the library each pack family
 * is, which tags are which concepts (the sure rules of the duplicate detector applied to the labels, Italian labels and aliases of the
 * concepts), which tags the field tells apart from a concept, and where linked tags would sit. Pure: nothing is read or written.
 */

export interface PackNodeIn {
  id: string;
  label: string;
  aliases: readonly string[];
  parents: readonly string[];
  status: string;
  family?: 'one' | 'many' | 'keywords' | undefined;
  /** `<packId>/<conceptId>` when already linked. */
  pack?: string | undefined;
}
export interface PackConceptIn {
  id: string;
  family: string;
  label: string;
  labelIt?: string | undefined;
  aliases: readonly string[];
  parent?: string | undefined;
  distinctFrom?: readonly string[] | undefined;
}
export interface PackFamilyIn {
  id: string;
  label: string;
  singleValue: boolean;
}
export interface PackMatchInput {
  packId: string;
  nodes: readonly PackNodeIn[];
  docs: ReadonlyArray<{ id: string; tags: readonly string[] }>;
  families: readonly PackFamilyIn[];
  concepts: readonly PackConceptIn[];
  /** Pairs the user said are not the same: never proposed again. */
  rejected?: ReadonlyArray<readonly string[]> | undefined;
  /** Family pairing already chosen (pack family id -> root id or `later`): the placement follows it instead of the detected one. */
  chosenFamilies?: Readonly<Record<string, string>> | undefined;
}
export interface PackMatchResult {
  recognized: number;
  tags: number;
  papersWithTopic: number;
  papers: number;
  conflicts: number;
  families: PackFamilyMatch[];
  matches: PackMatch[];
  distinct: Array<{ nodeId: string; conceptId: string }>;
  place: Array<{ nodeId: string; parentId: string | null }>;
}

export { formKey };

/** The pack family that stands for the main subject: its root is the biggest many-value family of the library (the Map's Topic). */
export const PACK_TOPIC_FAMILY = 'topic';
export const MAX_ROWS = 2000;
/** Deepest level under a family root (the library's own limit, D-493). */
const MAX_DEPTH = 3;
const CONCEPT = '\u0001';
const RANK: Record<Confidence, number> = { sure: 0, likely: 1, maybe: 2 };

export const packRef = (packId: string, conceptId: string): string => `${packId}/${conceptId}`;
const pairKey = (a: string, b: string): string => `${a}\u0000${b}`;

/** Path of a concept in its pack, `Family › Area › Concept`. */
export function conceptPath(concepts: ReadonlyMap<string, PackConceptIn>, families: ReadonlyMap<string, PackFamilyIn>, id: string): string {
  const parts: string[] = [];
  for (let cur = concepts.get(id), i = 0; cur && i < 8; cur = cur.parent ? concepts.get(cur.parent) : undefined, i++) parts.unshift(cur.label);
  const fam = families.get(concepts.get(id)?.family ?? '')?.label;
  return [...(fam ? [fam] : []), ...parts].join(' › ');
}

export function matchPack(input: PackMatchInput): PackMatchResult {
  const concepts = new Map(input.concepts.map((c) => [c.id, c]));
  const families = new Map(input.families.map((f) => [f.id, f]));
  const live = input.nodes.filter((n) => n.status !== 'deprecated' && !n.id.startsWith('grp:'));
  const byId = new Map(live.map((n) => [n.id, n]));
  const prefix = `${input.packId}/`;

  // Tags already linked to a concept of this pack.
  const linkedConcept = new Map<string, string>();
  const linkedNode = new Map<string, string>();
  for (const n of live) {
    if (n.pack?.startsWith(prefix) !== true) continue;
    const c = n.pack.slice(prefix.length);
    if (!concepts.has(c) || linkedNode.has(c)) continue;
    linkedConcept.set(n.id, c);
    linkedNode.set(c, n.id);
  }

  // The first-parent chain of every node: its root, and the depth.
  const rootOf = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 1000; i++) {
      const p = byId.get(cur)?.parents.find((x) => byId.has(x));
      if (p === undefined) return cur;
      cur = p;
    }
    return cur;
  };
  const kids = new Map<string, string[]>();
  for (const n of live) for (const p of n.parents) if (byId.has(p)) (kids.get(p) ?? kids.set(p, []).get(p) ?? []).push(n.id);
  const heightOf = (id: string, depth = 0): number => (depth > 6 ? 0 : Math.max(0, ...(kids.get(id) ?? []).map((k) => 1 + heightOf(k, depth + 1))));
  const depthOf = (id: string): number => {
    let d = 0;
    for (let cur = id; d < 20; d++) {
      const p = byId.get(cur)?.parents.find((x) => byId.has(x));
      if (p === undefined) break;
      cur = p;
    }
    return d;
  };
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (out.has(x)) continue;
      out.add(x);
      stack.push(...(kids.get(x) ?? []));
    }
    return out;
  };

  // The names of the user's tags against the names of the concepts, with the rules of the detector.
  const users = live.filter((n) => n.family === undefined && !linkedConcept.has(n.id));
  const free = input.concepts.filter((c) => !linkedNode.has(c.id));
  const reviewNode = (id: string, label: string, aliases: readonly string[]): ReviewNode => ({ id, label, aliases, parents: [], status: 'active' });
  const nodes: ReviewNode[] = [
    ...users.map((n) => reviewNode(n.id, n.label, n.aliases)),
    ...free.map((c) => reviewNode(CONCEPT + c.id, c.label, [...(c.labelIt ? [c.labelIt] : []), ...c.aliases])),
  ];
  const ix = buildIndex({ nodes, docs: [] });
  const rejected = new Set((input.rejected ?? []).map(([n, c]) => pairKey(n ?? '', CONCEPT + (c ?? ''))));
  const isConcept = (id: string): boolean => id.startsWith(CONCEPT);
  const pairs = namePairs(ix, nodes, (a, b) => {
    if (isConcept(a) === isConcept(b)) return true;
    return rejected.has(isConcept(a) ? pairKey(b, a) : pairKey(a, b));
  });

  // What the field tells apart: a tag named like a term the concept must not be merged with.
  const distinctTerms = new Map<string, string[]>();
  for (const c of free) for (const t of c.distinctFrom ?? []) (distinctTerms.get(formKey(t)) ?? distinctTerms.set(formKey(t), []).get(formKey(t)) ?? []).push(c.id);
  const distinct: PackMatchResult['distinct'] = [];
  const apart = new Set<string>();
  for (const n of users) {
    for (const f of [n.label, ...n.aliases]) {
      for (const c of distinctTerms.get(formKey(f)) ?? []) {
        if (apart.has(pairKey(n.id, c))) continue;
        apart.add(pairKey(n.id, c));
        distinct.push({ nodeId: n.id, conceptId: c });
      }
    }
  }

  type Cand = { nodeId: string; conceptId: string; rule: string; confidence: Confidence };
  const cands = new Map<string, Cand>();
  for (const p of pairs) {
    const [nodeId, concept] = isConcept(p.a) ? [p.b, p.a] : [p.a, p.b];
    const conceptId = concept.slice(1);
    if (apart.has(pairKey(nodeId, conceptId))) continue;
    // Spelling slips are probable matches; the other sure rules stay sure, an ambiguous sigla stays a maybe.
    const confidence: Confidence = p.confidence === 'sure' ? 'sure' : p.rule === 'spelling' ? 'likely' : p.confidence;
    const k = pairKey(nodeId, conceptId);
    const old = cands.get(k);
    if (!old || RANK[confidence] < RANK[old.confidence]) cands.set(k, { nodeId, conceptId, rule: p.rule, confidence });
  }
  // A tag that fits two concepts, or a concept that two tags claim: the choice is the user's ("maybe").
  const perNode = new Map<string, number>();
  const perConcept = new Map<string, number>();
  for (const c of cands.values()) {
    perNode.set(c.nodeId, (perNode.get(c.nodeId) ?? 0) + 1);
    perConcept.set(c.conceptId, (perConcept.get(c.conceptId) ?? 0) + 1);
  }
  const conflicts = [...perNode.values()].filter((n) => n > 1).length + [...perConcept.values()].filter((n) => n > 1).length;
  const list = [...cands.values()].map((c) => ((perNode.get(c.nodeId) ?? 0) > 1 || (perConcept.get(c.conceptId) ?? 0) > 1 ? { ...c, confidence: 'maybe' as Confidence } : c));
  list.sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : a.conceptId < b.conceptId ? -1 : 1));
  const shown = list.slice(0, MAX_ROWS);
  const matches: PackMatch[] = shown.map((c) => ({ ...c, path: conceptPath(concepts, families, c.conceptId) }));

  // Tags the pack stands for, linked or probably the same: drive the numbers and the pairing of the families.
  const standsFor = new Map<string, string>(linkedConcept);
  for (const c of list) if (c.confidence !== 'maybe' && !standsFor.has(c.nodeId)) standsFor.set(c.nodeId, c.conceptId);

  const tags = live.filter((n) => n.family === undefined).length;
  const withTopic = new Set<string>();
  for (const d of input.docs) if (d.tags.some((t) => concepts.get(standsFor.get(t) ?? '')?.family === PACK_TOPIC_FAMILY)) withTopic.add(d.id);

  // Families: which root of the library each pack family is.
  const roots = live.filter((n) => n.parents.length === 0 && (n.family === 'one' || n.family === 'many'));
  const size = new Map<string, number>();
  for (const n of live) {
    const r = rootOf(n.id);
    if (r !== n.id) size.set(r, (size.get(r) ?? 0) + 1);
  }
  const famOut: PackFamilyMatch[] = [];
  for (const f of input.families) {
    const mine = [...standsFor].filter(([, c]) => concepts.get(c)?.family === f.id);
    const countIn = (root: string): number => mine.filter(([n]) => rootOf(n) === root).length;
    let pick: { id: string; reason: PackFamilyMatch['reason'] } | undefined;
    if (f.id === PACK_TOPIC_FAMILY) {
      const big = roots.filter((r) => r.family === 'many').sort((a, b) => (size.get(b.id) ?? 0) - (size.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1))[0];
      if (big) pick = { id: big.id, reason: 'largest' };
    } else {
      const byName = roots.find((r) => formKey(r.label) === formKey(f.label));
      if (byName) pick = { id: byName.id, reason: 'name' };
      else if (mine.length > 0) {
        const best = [...roots].sort((a, b) => countIn(b.id) - countIn(a.id) || (a.id < b.id ? -1 : 1))[0];
        if (best && countIn(best.id) / mine.length >= 0.5) pick = { id: best.id, reason: 'overlap' };
      }
    }
    if (pick && (byId.get(pick.id)?.family === 'one') !== f.singleValue) pick = { id: pick.id, reason: 'kind' };
    famOut.push({ packFamily: f.id, root: pick?.id ?? 'later', reason: pick?.reason ?? 'later' });
  }

  // Place: tags the pack stands for that sit in "Da sistemare" (a root with no family) or in Keywords go into the paired family, under
  // the parent the pack names when that parent is already a tag of the family (or is placed too), else at level 1.
  const chosen = new Map(famOut.map((f) => [f.packFamily, input.chosenFamilies?.[f.packFamily] ?? f.root]));
  const loose = (id: string): boolean => {
    const r = byId.get(rootOf(id));
    return r !== undefined && (r.family === undefined || r.family === 'keywords') && byId.get(id)?.family === undefined;
  };
  const stands = new Map<string, string>();
  for (const c of list) if (c.confidence !== 'maybe') stands.set(c.nodeId, c.conceptId);
  const toPlace = [...stands.keys()].filter(loose);
  const conceptDepth = (id: string): number => {
    let d = 0;
    for (let c = concepts.get(id); c?.parent !== undefined && d < 8; c = concepts.get(c.parent)) d++;
    return d;
  };
  // Shallow concepts first, so that a parent that is placed is known when its children are.
  toPlace.sort((a, b) => conceptDepth(stands.get(a) as string) - conceptDepth(stands.get(b) as string) || (a < b ? -1 : 1));
  const placed = new Map<string, number>();
  const place: PackMatchResult['place'] = [];
  for (const nodeId of toPlace) {
    const concept = concepts.get(stands.get(nodeId) as string);
    if (!concept) continue;
    const rootId = chosen.get(concept.family) ?? 'later';
    if (rootId !== 'later' && !byId.has(rootId)) continue;
    const top: string | null = rootId === 'later' ? null : rootId;
    const parentConcept = concept.parent;
    const parentNode = parentConcept === undefined ? undefined : (linkedNode.get(parentConcept) ?? [...stands].find(([, c]) => c === parentConcept)?.[0]);
    const inFamily = (id: string): boolean => placed.has(id) || (rootId !== 'later' && rootOf(id) === rootId && id !== rootId);
    let parentId = top;
    if (parentNode !== undefined && parentNode !== nodeId && inFamily(parentNode) && !descendants(nodeId).has(parentNode)) parentId = parentNode;
    const height = heightOf(nodeId);
    const levelOf = (p: string | null): number => (p === null || p === rootId ? 1 : (placed.get(p) ?? depthOf(p)) + 1);
    // Depth: this tag and what hangs under it must stay within the limit; otherwise level 1, or nowhere.
    if (levelOf(parentId) + height > MAX_DEPTH) parentId = top;
    if (levelOf(parentId) + height > MAX_DEPTH) continue;
    placed.set(nodeId, levelOf(parentId));
    place.push({ nodeId, parentId });
  }

  return {
    recognized: standsFor.size,
    tags,
    papersWithTopic: withTopic.size,
    papers: input.docs.length,
    conflicts,
    families: famOut,
    matches,
    distinct: distinct.slice(0, MAX_ROWS),
    place: place.slice(0, MAX_ROWS),
  };
}
