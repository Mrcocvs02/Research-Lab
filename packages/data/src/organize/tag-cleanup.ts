import type { TaxonomyFile, TaxonomyNode, TaxonomyOp } from '@rl/core';
import { normalizeName, slugify } from '../normalize.js';
import { applyTaxonomyOps } from './taxonomy-ops.js';
import { applyDocEdit, opsExt, retagWithOrigin, type DocEdit } from './taxonomy-ops-ext.js';

export { applyDocEdit, mergeOps, type DocEdit };
import { GENERIC_MIN_DOCS } from './tag-health.js';
import { buildIndex, conventionName, mergeOps, reviewTags, type Proposal, type ReviewDoc, type ReviewInput, type ReviewResult } from './tag-review.js';

/**
 * The guided cleanup (D-495, section 19.1.5): the proposals of each step, as rows that carry the taxonomy operations (and the
 * document edits) that apply them. Pure: nothing is written here. Steps 1-2 (duplicates) and 3 (twins) come from the
 * detector; 4 (families, hierarchy) and 5 (names, metadata) are built here. Every row disappears once applied.
 */

export interface CleanupDoc extends ReviewDoc {
  type?: string | null | undefined;
  venueId?: string | null | undefined;
  /** Publication status of the document (`unknown` when not set). */
  status?: string | undefined;
}
export interface CleanupInput extends ReviewInput {
  nodes: ReadonlyArray<TaxonomyNode>;
  docs: readonly CleanupDoc[];
  documentTypes?: ReadonlyArray<{ id: string; label: string }> | undefined;
}

export interface Variant {
  ops: TaxonomyOp[];
  docEdits: DocEdit[];
}
export interface CleanupRow {
  id: string;
  step: 1 | 2 | 3 | 4 | 5;
  kind: string;
  tags: string[];
  confidence?: Proposal['confidence'] | undefined;
  /** Ticked by default. */
  checked: boolean;
  /** A placement the user should look at (micro under Topic with no macro, a tag with no suggestion). */
  marked?: boolean | undefined;
  /** The alternatives of the row (`default` or the named ones); twins: `merge`, `keywords`, `leave`; one-value families: `pick`, `many`. */
  variants: Record<string, Variant>;
  variant: string;
  /** For `metadata` rows: some documents keep the tag because their field holds another value. */
  remains?: boolean | undefined;
}
export interface CleanupPlan {
  /** Roots to create first (Topic, Keywords) when a row needs them; applied together with the rows ticked. */
  prelude: TaxonomyOp[];
  rows: CleanupRow[];
}

const none: Variant = { ops: [], docEdits: [] };
const TOPIC = 'Topic';
const KEYWORDS = 'Keywords';
const PAPER_TYPE = 'Paper type';

function freshId(name: string, taken: Set<string>): string {
  const base = slugify(name);
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

export function cleanupPlan(input: CleanupInput, step: 1 | 2 | 3 | 4 | 5, review: ReviewResult = reviewTags(input)): CleanupPlan {
  if (step === 1 || step === 2) {
    const rows = review.proposals
      .filter((p) => p.kind === 'merge' && (step === 1 ? p.confidence === 'sure' : p.confidence !== 'sure'))
      .map<CleanupRow>((p) => ({ id: p.id, step, kind: 'merge', tags: p.tags, confidence: p.confidence, checked: p.confidence !== 'maybe', variants: { default: { ops: mergeOps(input.nodes, p.tags, p.keep as string, p.label), docEdits: [] } }, variant: 'default' }));
    return { prelude: [], rows };
  }
  if (step === 3) return { prelude: [], rows: review.proposals.filter((p) => p.kind === 'twins').map((p) => twinRow(input, p)) };
  if (step === 4) return familiesPlan(input, review.proposals);
  return { prelude: [], rows: namesAndMetadata(input, review.proposals) };
}

function twinRow(input: CleanupInput, p: Proposal): CleanupRow {
  const hasChild = new Set(input.nodes.flatMap((n) => n.parents));
  const by = new Map(input.nodes.map((n) => [n.id, n]));
  // A topic of the old index (macro / micro hint) or a tag already in a family is never sent to Keywords with its twins: it is a
  // value of the Map, the twins are its keywords (D-505).
  const rootOf = (id: string): TaxonomyNode | undefined => {
    let cur = by.get(id);
    for (let i = 0; cur && cur.parents.length > 0 && i < 50; i++) cur = by.get(cur.parents[0] as string);
    return cur;
  };
  const isTopic = (t: string): boolean => {
    const n = by.get(t);
    const r = rootOf(t);
    return n?.group === 'macro' || n?.group === 'micro' || (r !== undefined && r.id !== t && r.family !== undefined && r.family !== 'keywords');
  };
  const leaves = p.tags.filter((t) => !hasChild.has(t) && !isTopic(t));
  const kw = input.nodes.find((n) => n.family === 'keywords');
  const taken = new Set(input.nodes.map((n) => n.id));
  const kwId = kw?.id ?? freshId(KEYWORDS, taken);
  const create: TaxonomyOp[] = kw ? [] : [{ op: 'create', id: kwId, label: KEYWORDS }, { op: 'setFamily', id: kwId, family: 'keywords' }];
  const toKeywords: Variant = leaves.length === 0 ? none : { ops: [...create, ...leaves.map<TaxonomyOp>((t) => ({ op: 'move', id: t, parents: [kwId] }))], docEdits: [] };
  const merge: Variant = { ops: mergeOps(input.nodes, p.tags, p.keep as string, p.label), docEdits: [] };
  // Only topics in the group (nothing to send to Keywords, and merging distinct topics is not a default): leave it.
  const variant = p.action === 'keywords' ? (leaves.length > 0 ? 'keywords' : 'leave') : 'merge';
  return { id: p.id, step: 3, kind: 'twins', tags: p.tags, confidence: p.confidence, checked: variant !== 'leave', variants: { merge, keywords: toKeywords, leave: none }, variant };
}

function familiesPlan(input: CleanupInput, proposals: readonly Proposal[]): CleanupPlan {
  const ix = buildIndex(input);
  const nodes = input.nodes.filter((n) => n.status !== 'deprecated' && !n.id.startsWith('grp:'));
  const taken = new Set(input.nodes.map((n) => n.id));
  const rows: CleanupRow[] = [];
  const prelude: TaxonomyOp[] = [];
  const docsOf = (id: string): Set<number> => ix.docsOf.get(id) ?? new Set<number>();
  const common = (a: string, b: string): number => {
    const sa = docsOf(a);
    let n = 0;
    for (const d of docsOf(b)) if (sa.has(d)) n++;
    return n;
  };
  const hasChild = new Set(input.nodes.flatMap((n) => n.parents));
  const nDocs = input.docs.length;
  // A value on more than half of the papers says nothing about any of them (the "generic" health check): as a macro it would swallow
  // the Topic blocks of the Map, so it is offered as a family of its own (or Keywords) rather than as a Topic value (D-508, W11).
  const generic = (id: string): boolean => nDocs >= GENERIC_MIN_DOCS && docsOf(id).size / nDocs > 0.5;

  let topicId: string | undefined = input.nodes.find((n) => n.family === 'many' && n.parents.length === 0 && normalizeName(n.label) === normalizeName(TOPIC))?.id;
  let kwId: string | undefined = input.nodes.find((n) => n.family === 'keywords')?.id;
  const needTopic = (): string => {
    if (topicId === undefined) {
      topicId = freshId(TOPIC, taken);
      prelude.push({ op: 'create', id: topicId, label: TOPIC }, { op: 'setFamily', id: topicId, family: 'many' });
    }
    return topicId;
  };
  const needKeywords = (): string => {
    if (kwId === undefined) {
      kwId = freshId(KEYWORDS, taken);
      prelude.push({ op: 'create', id: kwId, label: KEYWORDS }, { op: 'setFamily', id: kwId, family: 'keywords' });
    }
    return kwId;
  };
  const push = (id: string, kind: string, tags: string[], ops: TaxonomyOp[], extra: Partial<CleanupRow> = {}): void => {
    rows.push({ id: `${kind}:${id}`, step: 4, kind, tags, checked: true, variants: { default: { ops, docEdits: [] } }, variant: 'default', ...extra });
  };

  // Tags outside every family: roots without `family` (their descendants follow the root).
  const roots = nodes.filter((n) => n.parents.length === 0 && n.family === undefined);
  // (a) the families of the old index ("extra:<Name>") become roots with their members as values.
  const extraFamilies = new Map<string, TaxonomyNode[]>();
  for (const n of roots) {
    if (!n.group?.startsWith('extra:')) continue;
    const name = n.group.slice(6);
    (extraFamilies.get(name) ?? extraFamilies.set(name, []).get(name) ?? []).push(n);
  }
  // A group of the old index with more values than a family can show (§19.2.2: at most 12) and several per paper is a keyword
  // list, not a family: its tags are placed one by one like the "extra" hint (Keywords, or a detail under a topic) (D-505).
  const keywordLike = new Set<string>();
  for (const [name, members] of extraFamilies) {
    const existing = input.nodes.find((n) => n.parents.length === 0 && n.family !== undefined && normalizeName(n.label) === normalizeName(name));
    const withDoc = new Set<number>();
    for (const m of members) for (const d of docsOf(m.id)) withDoc.add(d);
    let single = 0;
    for (const d of withDoc) if (members.filter((m) => docsOf(m.id).has(d)).length === 1) single++;
    const kind: 'one' | 'many' = withDoc.size > 0 && single / withDoc.size >= 0.8 ? 'one' : 'many';
    if (!existing && kind === 'many' && members.length > 12) {
      for (const m of members) keywordLike.add(m.id);
      continue;
    }
    const rootId = existing?.id ?? freshId(name, taken);
    const body = (fam: 'one' | 'many'): TaxonomyOp[] => [
      ...(existing ? [] : ([{ op: 'create', id: rootId, label: conventionName(name) }] as TaxonomyOp[])),
      { op: 'setFamily', id: rootId, family: fam },
      ...members.flatMap<TaxonomyOp>((m) => [{ op: 'move', id: m.id, parents: [rootId] }, { op: 'setGroup', id: m.id, group: null }]),
    ];
    const other = kind === 'one' ? 'many' : 'one';
    push(rootId, 'family', members.map((m) => m.id), body(kind), { variants: { default: { ops: body(kind), docEdits: [] }, [other]: { ops: body(other), docEdits: [] } } });
  }
  // (b) macro / micro / extra hints and (c) tags with no hint at all.
  const macros = roots.filter((n) => n.group === 'macro');
  const parentProposals = proposals.filter((p) => p.kind === 'parent');
  for (const n of roots) {
    if (n.group?.startsWith('extra:') && !keywordLike.has(n.id)) continue;
    if (n.group === 'macro' && generic(n.id)) {
      const own: TaxonomyOp[] = [{ op: 'setFamily', id: n.id, family: 'many' }];
      push(n.id, 'generic', [n.id], own, {
        marked: true,
        variants: {
          default: { ops: own, docEdits: [] },
          topic: { ops: [{ op: 'move', id: n.id, parents: [needTopic()] }], docEdits: [] },
          keywords: { ops: [{ op: 'move', id: n.id, parents: [needKeywords()] }], docEdits: [] },
        },
      });
    } else if (n.group === 'macro') push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [needTopic()] }]);
    else if (n.group === 'micro') {
      // Among the macros that hold at least half of its papers, the one with the highest lift P(macro | micro) / P(macro): the most
      // specific, not the biggest (a big macro holds everything); on a tie the smaller macro, then the id (D-508, W16).
      let best: { id: string; p: number; lift: number; size: number } | undefined;
      const mine = docsOf(n.id).size;
      for (const m of macros) {
        const p = mine === 0 ? 0 : common(n.id, m.id) / mine;
        const size = docsOf(m.id).size;
        if (p < 0.5 || size === 0) continue;
        const lift = p / (size / Math.max(1, nDocs));
        if (!best || lift > best.lift || (lift === best.lift && (size < best.size || (size === best.size && m.id < best.id)))) best = { id: m.id, p, lift, size };
      }
      if (best) push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [best.id] }]);
      else push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [needTopic()] }], { marked: true });
    } else if (n.group === 'extra' || keywordLike.has(n.id)) {
      // Only an inclusion found by name and by papers (R8 likely) makes a keyword a detail of a topic.
      const hint = parentProposals.find((p) => p.tags[1] === n.id && p.confidence !== 'maybe' && ['macro', 'micro'].includes(ix.byId.get(p.keep as string)?.group ?? ''));
      if (docsOf(n.id).size >= 3 && hint) push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [hint.keep as string] }]);
      else push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [needKeywords()] }]);
    } else if (hasChild.has(n.id)) {
      push(n.id, 'family', [n.id], [{ op: 'setFamily', id: n.id, family: 'many' }]);
    } else if (docsOf(n.id).size >= Math.max(3, Math.ceil(nDocs * 0.1))) {
      push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [needTopic()] }], { marked: true });
    } else push(n.id, 'place', [n.id], [{ op: 'move', id: n.id, parents: [needKeywords()] }]);
  }
  // (d) one parent only.
  for (const n of nodes) {
    const ps = n.parents.filter((p) => ix.byId.has(p));
    if (ps.length < 2) continue;
    const keep = [...ps].sort((a, b) => common(n.id, b) - common(n.id, a) || (a < b ? -1 : 1))[0] as string;
    push(n.id, 'parent', [n.id, ...ps], [{ op: 'move', id: n.id, parents: [keep] }]);
  }
  // (e) a family that takes one value, with documents holding two or more.
  for (const r of nodes.filter((n) => n.family === 'one')) {
    const memberSet = new Set(nodes.filter((n) => ix.rootOf.get(n.id) === r.id && n.id !== r.id).map((n) => n.id));
    const depth = (id: string): number => {
      let d = 0;
      for (let cur = id; d < 20; d++) {
        const p = ix.byId.get(cur)?.parents.find((x) => ix.byId.has(x));
        if (p === undefined) break;
        cur = p;
      }
      return d;
    };
    const valueOf = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 20; i++) {
        const p = ix.byId.get(cur)?.parents.find((x) => ix.byId.has(x));
        if (p === undefined || p === r.id) return cur;
        cur = p;
      }
      return cur;
    };
    const edits: DocEdit[] = [];
    for (const d of input.docs) {
      const mine = d.tags.filter((t) => memberSet.has(t));
      const values = new Set(mine.map(valueOf));
      if (values.size < 2) continue;
      const deepest = (v: string): number => Math.max(...mine.filter((t) => valueOf(t) === v).map(depth));
      const win = [...values].sort((a, b) => deepest(b) - deepest(a) || docsOf(b).size - docsOf(a).size || (a < b ? -1 : 1))[0];
      edits.push({ docId: d.id, removeTags: mine.filter((t) => valueOf(t) !== win) });
    }
    if (edits.length > 0) push(r.id, 'onevalue', [r.id], [], { variants: { pick: { ops: [], docEdits: edits }, many: { ops: [{ op: 'setFamily', id: r.id, family: 'many' }], docEdits: [] } }, variant: 'pick' });
  }
  // (f) the paper type as a family of its own (off by default).
  const types = (input.documentTypes ?? []).filter((t) => input.docs.some((d) => d.type === t.id));
  if (types.length > 0 && !input.nodes.some((n) => n.parents.length === 0 && normalizeName(n.label) === normalizeName(PAPER_TYPE))) {
    const rootId = freshId(PAPER_TYPE, taken);
    const ids = new Map(types.map((t) => [t.id, freshId(t.label, taken)]));
    const ops: TaxonomyOp[] = [{ op: 'create', id: rootId, label: PAPER_TYPE }, { op: 'setFamily', id: rootId, family: 'one' }, ...types.map<TaxonomyOp>((t) => ({ op: 'create', id: ids.get(t.id) as string, label: conventionName(t.label), parents: [rootId] }))];
    const docEdits = input.docs.filter((d) => d.type && ids.has(d.type)).map<DocEdit>((d) => ({ docId: d.id, addTags: [ids.get(d.type as string) as string] }));
    push(rootId, 'paper-type', [], ops, { checked: false, variants: { default: { ops, docEdits } } });
  }
  return { prelude, rows };
}

function namesAndMetadata(input: CleanupInput, proposals: readonly Proposal[]): CleanupRow[] {
  const rows: CleanupRow[] = [];
  const by = new Map(input.nodes.map((n) => [n.id, n]));
  const hasChild = new Set(input.nodes.flatMap((n) => n.parents));
  for (const p of proposals) {
    const id = p.tags[0] as string;
    const n = by.get(id);
    if (!n) continue;
    if (p.kind === 'name' && p.label) {
      const label = p.label;
      const aliases = [...new Set([...n.aliases, n.label])].filter((a) => normalizeName(a) !== normalizeName(label) || a === n.label).slice(0, 200);
      rows.push({ id: p.id, step: 5, kind: 'name', tags: [id], checked: true, variants: { default: { ops: [{ op: 'rename', id, label }, { op: 'setAliases', id, aliases }], docEdits: [] } }, variant: 'default' });
    } else if (p.kind === 'metadata' && p.meta) {
      const edits: DocEdit[] = [];
      let remains = false;
      for (const d of input.docs) {
        if (!d.tags.includes(id)) continue;
        // An author name: the document already lists its authors, the tag only goes away.
        if (p.meta.field === 'author') {
          edits.push({ docId: d.id, removeTags: [id] });
          continue;
        }
        const cur = p.meta.field === 'venue' ? (d.venueId ?? null) : d.status && d.status !== 'unknown' ? d.status : null;
        if (cur === null) edits.push({ docId: d.id, removeTags: [id], ...(p.meta.field === 'venue' ? { venueId: p.meta.value } : { status: p.meta.value }) });
        else if (cur === p.meta.value) edits.push({ docId: d.id, removeTags: [id] });
        else remains = true;
      }
      const ops: TaxonomyOp[] = remains ? [] : [{ op: hasChild.has(id) ? 'deprecate' : 'delete', id }];
      rows.push({ id: p.id, step: 5, kind: 'metadata', tags: [id], checked: true, remains, variants: { default: { ops, docEdits: edits } }, variant: 'default' });
    }
  }
  return rows;
}

/** The input of the detector and of the cleanup from a taxonomy file and the documents' tags. */
export function toCleanupInput(tax: Pick<TaxonomyFile, 'nodes' | 'distinct' | 'venues' | 'documentTypes'>, docs: readonly CleanupDoc[]): CleanupInput {
  return { nodes: tax.nodes, docs, distinct: tax.distinct, venues: tax.venues, documentTypes: tax.documentTypes };
}

/** What the ops and edits would leave (pure; the before/after of a step, and the tests). Throws like `applyTaxonomyOps`. */
export function simulateCleanup(tax: TaxonomyFile, docs: readonly CleanupDoc[], ops: readonly TaxonomyOp[], edits: readonly DocEdit[], now = '1970-01-01T00:00:00.000Z'): { taxonomy: TaxonomyFile; docs: CleanupDoc[] } {
  const editBy = new Map<string, DocEdit[]>();
  for (const e of edits) (editBy.get(e.docId) ?? editBy.set(e.docId, []).get(e.docId) ?? []).push(e);
  let next = docs.map((d) => (editBy.get(d.id) ?? []).reduce(applyDocEdit, d));
  const usage = new Map<string, number>();
  for (const d of next) for (const t of new Set(d.tags)) usage.set(t, (usage.get(t) ?? 0) + 1);
  const { taxonomy, redirects } = applyTaxonomyOps(tax, ops, usage, now, opsExt);
  const resolve = (t: string): string => {
    let x = t;
    for (let i = 0; i < 1000 && redirects.has(x); i++) x = redirects.get(x) as string;
    return x;
  };
  next = next.map((d) => ({ ...d, tags: retagWithOrigin(d.tags, undefined, resolve).tags }));
  return { taxonomy, docs: next };
}

/**
 * The operations and document edits of the chosen rows of a plan (`chosen`: row id -> variant, `undefined` = the row's own),
 * with the roots of the prelude they need and without a second copy of the same `create` / `setFamily`.
 */
export function planOps(plan: CleanupPlan, chosen: ReadonlyMap<string, string | undefined>): { ops: TaxonomyOp[]; docEdits: DocEdit[]; picked: CleanupRow[] } {
  const picked = plan.rows.filter((r) => chosen.has(r.id));
  const body: TaxonomyOp[] = [];
  const docEdits: DocEdit[] = [];
  for (const r of picked) {
    const v = r.variants[chosen.get(r.id) ?? r.variant] ?? r.variants['default'];
    if (!v) continue;
    body.push(...v.ops);
    docEdits.push(...v.docEdits);
  }
  const text = JSON.stringify(body);
  const prelude: TaxonomyOp[] = [];
  for (let i = 0; i + 1 < plan.prelude.length; i += 2) {
    const root = plan.prelude[i] as TaxonomyOp & { id?: string };
    if (text.includes(`"${root.id}"`)) prelude.push(plan.prelude[i] as TaxonomyOp, plan.prelude[i + 1] as TaxonomyOp);
  }
  const seen = new Set<string>();
  const ops = [...prelude, ...body].filter((o) => {
    if (o.op !== 'create' && o.op !== 'setFamily') return true;
    const k = `${o.op}:${o.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ops, docEdits, picked };
}
