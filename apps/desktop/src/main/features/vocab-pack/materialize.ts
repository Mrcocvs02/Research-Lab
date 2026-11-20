import { itemIdSchema, type TaxonomyFile, type TaxonomyOp } from '@rl/core';
import type { VocabPackState } from '@rl/core/vocab';
import { slugify } from '@rl/data';
import { packRef, type PackConceptIn } from '@rl/data/pack-match';
import type { LoadedPack } from './packs.js';

/** The longest chain under a family root (the library's own limit, D-493). */
export const MAX_LEVELS = 3;

/** The name a concept gets as a tag, in the language of the interface. */
export const conceptLabel = (c: Pick<PackConceptIn, 'label' | 'labelIt'>, lang: 'it' | 'en'): string => (lang === 'it' && c.labelIt ? c.labelIt : c.label);

/** An id for a new node: the slug of its name, made valid and unique among `taken` (which it joins). */
export function freshNodeId(label: string, taken: Set<string>): string {
  let base = slugify(label);
  if (!itemIdSchema.safeParse(base).success) base = `n-${base}`;
  let id = base;
  for (let i = 2; taken.has(id) || !itemIdSchema.safeParse(id).success; i++) id = `${base.slice(0, 120)}-${i}`;
  taken.add(id);
  return id;
}

/** The concept ids of this pack that tags are linked to, with the tag. */
export function linkedConcepts(tax: Pick<TaxonomyFile, 'nodes'>, packId: string): Map<string, string> {
  const out = new Map<string, string>();
  const prefix = `${packId}/`;
  for (const n of tax.nodes) if (n.pack?.startsWith(prefix) === true && n.status !== 'deprecated' && !out.has(n.pack.slice(prefix.length))) out.set(n.pack.slice(prefix.length), n.id);
  return out;
}

/** The root of the library a pack family is paired with, when it exists (`later` or a root that is gone: none). */
export function familyRoot(tax: Pick<TaxonomyFile, 'nodes'>, state: Pick<VocabPackState, 'families'>, family: string): string | null {
  const id = state.families[family];
  return id !== undefined && id !== 'later' && tax.nodes.some((n) => n.id === id && n.parents.length === 0 && n.status !== 'deprecated') ? id : null;
}

/** The nearest tag above a concept that already exists (its first linked ancestor, else the family root); null when only the root is missing. */
export function nearestParent(tax: Pick<TaxonomyFile, 'nodes'>, state: Pick<VocabPackState, 'families' | 'packId'>, loaded: LoadedPack, concept: PackConceptIn): string | null {
  const linked = linkedConcepts(tax, state.packId);
  for (let c = concept.parent ? loaded.byId.get(concept.parent) : undefined, i = 0; c && i < 8; c = c.parent ? loaded.byId.get(c.parent) : undefined, i++) {
    const node = linked.get(c.id);
    if (node !== undefined) return node;
  }
  return familyRoot(tax, state, concept.family);
}

export interface Materialization {
  ops: TaxonomyOp[];
  /** The tag of the concept. */
  nodeId: string;
  /** New tags, ancestors first, the concept last (empty when the concept already was one). */
  created: string[];
  /** A family root made for the first concept of its family. */
  root?: { family: string; id: string };
}

const levelsOf = (tax: Pick<TaxonomyFile, 'nodes'>, id: string): number => {
  const byId = new Map(tax.nodes.map((n) => [n.id, n]));
  let d = 0;
  for (let cur = id; d < 20; d++) {
    const p = byId.get(cur)?.parents.find((x) => byId.has(x));
    if (p === undefined) break;
    cur = p;
  }
  return d;
};

/**
 * What turns a concept into a tag: the missing ancestors (down from level 1 of the family) and the concept itself, each linked with
 * `setPack`; the family root too when it does not exist yet. Pure. `own` is the user's choice of label and parent for the concept itself
 * (the review of an AI proposal lets them change both): a different parent means the concept alone, under it. Returns null when the chain
 * would go deeper than the library allows (`reason: depth`).
 */
export function materialization(
  tax: TaxonomyFile,
  state: Pick<VocabPackState, 'families' | 'packId'>,
  loaded: LoadedPack,
  conceptId: string,
  lang: 'it' | 'en',
  own: { label?: string | undefined; parentId?: string | null | undefined } = {},
): Materialization | { depth: true } {
  const concept = loaded.byId.get(conceptId);
  if (!concept) throw new Error(`unknown concept ${conceptId}`);
  const linked = linkedConcepts(tax, state.packId);
  const existing = linked.get(conceptId);
  if (existing !== undefined) return { ops: [], nodeId: existing, created: [] };
  const taken = new Set(tax.nodes.map((n) => n.id));
  const ops: TaxonomyOp[] = [];
  const created: string[] = [];
  const family = loaded.families.find((f) => f.id === concept.family);
  let root = familyRoot(tax, state, concept.family);
  let madeRoot: Materialization['root'];
  const base = nearestParent(tax, state, loaded, concept);
  const alone = own.parentId !== undefined && own.parentId !== base;
  // The chain from the first missing ancestor down to the concept.
  const chain: PackConceptIn[] = [concept];
  if (!alone) for (let c = concept.parent ? loaded.byId.get(concept.parent) : undefined, i = 0; c && !linked.has(c.id) && i < 8; c = c.parent ? loaded.byId.get(c.parent) : undefined, i++) chain.unshift(c);
  let parent: string | null = alone ? (own.parentId ?? null) : base;
  if (!alone && parent === null && root === null) {
    // The root of the family is made now: a library with a root of that name (and kind) uses it.
    const name = family?.label ?? concept.family;
    const kind = family?.singleValue ? 'one' : 'many';
    const same = tax.nodes.find((n) => n.parents.length === 0 && n.family === kind && n.label.trim().toLowerCase() === name.trim().toLowerCase());
    if (same) root = same.id;
    else {
      const id = freshNodeId(name, taken);
      ops.push({ op: 'create', id, label: name }, { op: 'setFamily', id, family: kind });
      root = id;
      madeRoot = { family: concept.family, id };
    }
    parent = root;
  }
  const baseLevels = parent === null ? 0 : (madeRoot && parent === madeRoot.id ? 0 : levelsOf(tax, parent)) + 1;
  if (!alone && baseLevels + chain.length - 1 > MAX_LEVELS) return { depth: true };
  let nodeId = '';
  chain.forEach((c, i) => {
    const id = freshNodeId(i === chain.length - 1 && own.label ? own.label : conceptLabel(c, lang), taken);
    ops.push({ op: 'create', id, label: i === chain.length - 1 && own.label ? own.label : conceptLabel(c, lang), ...(parent ? { parents: [parent] } : {}) }, { op: 'setPack', id, pack: packRef(state.packId, c.id) });
    created.push(id);
    parent = id;
    nodeId = id;
  });
  return { ops, nodeId, created, ...(madeRoot ? { root: madeRoot } : {}) };
}
